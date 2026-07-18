import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSpeechInput } from "./useSpeechInput";

type FakeResult = Array<{ transcript: string }> & { isFinal: boolean };

function result(transcript: string, isFinal: boolean): FakeResult {
  return Object.assign([{ transcript }], { isFinal });
}

class FakePhrase {
  constructor(
    public phrase: string,
    public boost?: number,
  ) {}
}

/** 模拟 Safari：只暴露 webkitSpeechRecognition 前缀构造器。 */
class FakeRecognition {
  static instances: FakeRecognition[] = [];
  static available?: (options: unknown) => Promise<string>;
  static install?: (options: unknown) => Promise<boolean>;
  lang = "";
  continuous = false;
  interimResults = false;
  phrases: unknown;
  processLocally?: boolean;
  onresult: ((event: { resultIndex: number; results: FakeResult[] }) => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    this.started = true;
  }
  stop() {
    this.onend?.();
  }
  abort() {
    this.onend?.();
  }
  emitResult(resultIndex: number, results: FakeResult[]) {
    this.onresult?.({ resultIndex, results });
  }
}

describe("useSpeechInput", () => {
  beforeEach(() => {
    FakeRecognition.instances = [];
    delete FakeRecognition.available;
    delete FakeRecognition.install;
    (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition =
      FakeRecognition;
  });

  afterEach(() => {
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    delete (window as unknown as { SpeechRecognitionPhrase?: unknown }).SpeechRecognitionPhrase;
  });

  function setup(phrases?: readonly string[]) {
    const onTranscript = vi.fn();
    const onError = vi.fn();
    const hook = renderHook(() => useSpeechInput({ phrases, onTranscript, onError }));
    return { ...hook, onTranscript, onError };
  }

  it("detects the webkit-prefixed constructor (Safari)", async () => {
    const { result: hook } = setup();
    await waitFor(() => expect(hook.current.supported).toBe(true));
  });

  it("reports unsupported when no constructor exists", async () => {
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    const { result: hook } = setup();
    expect(hook.current.supported).toBe(false);
    act(() => hook.current.start());
    expect(FakeRecognition.instances).toHaveLength(0);
  });

  it("accumulates Chrome-style incremental results (final + interim)", () => {
    const { result: hook, onTranscript } = setup();
    act(() => hook.current.start());
    expect(hook.current.listening).toBe(true);
    const recognition = FakeRecognition.instances[0]!;
    expect(recognition.lang).toBe("zh-CN");
    expect(recognition.interimResults).toBe(true);

    act(() => recognition.emitResult(0, [result("昨天", false)]));
    expect(onTranscript).toHaveBeenLastCalledWith("昨天");

    act(() => recognition.emitResult(0, [result("昨天打车", true)]));
    expect(onTranscript).toHaveBeenLastCalledWith("昨天打车");

    // 第二句：resultIndex 指向新增结果，已定稿部分不重复累加。
    act(() =>
      recognition.emitResult(1, [result("昨天打车", true), result("三十二块", false)]),
    );
    expect(onTranscript).toHaveBeenLastCalledWith("昨天打车三十二块");
  });

  it("handles Safari-style single growing result finalized at the end", () => {
    const { result: hook, onTranscript } = setup();
    act(() => hook.current.start());
    const recognition = FakeRecognition.instances[0]!;

    act(() => recognition.emitResult(0, [result("昨天", false)]));
    act(() => recognition.emitResult(0, [result("昨天打车三十二块", false)]));
    expect(onTranscript).toHaveBeenLastCalledWith("昨天打车三十二块");

    act(() => recognition.emitResult(0, [result("昨天打车三十二块", true)]));
    expect(onTranscript).toHaveBeenLastCalledWith("昨天打车三十二块");
  });

  it("resets listening when recognition ends on its own (iOS silence timeout)", () => {
    const { result: hook } = setup();
    act(() => hook.current.start());
    const recognition = FakeRecognition.instances[0]!;
    act(() => recognition.onend?.());
    expect(hook.current.listening).toBe(false);
    // 结束后可再次开始新会话，转写从空开始。
    act(() => hook.current.start());
    expect(FakeRecognition.instances).toHaveLength(2);
  });

  it("surfaces permission errors but ignores no-speech/aborted", () => {
    const { result: hook, onError } = setup();
    act(() => hook.current.start());
    const recognition = FakeRecognition.instances[0]!;

    act(() => recognition.onerror?.({ error: "no-speech" }));
    act(() => recognition.onerror?.({ error: "aborted" }));
    expect(onError).not.toHaveBeenCalled();

    act(() => recognition.onerror?.({ error: "not-allowed" }));
    expect(onError).toHaveBeenCalledWith(
      "麦克风权限被拒绝，请在浏览器设置中允许使用麦克风",
    );
  });

  it("does not start a second session while one is active", () => {
    const { result: hook } = setup();
    act(() => hook.current.start());
    act(() => hook.current.start());
    expect(FakeRecognition.instances).toHaveLength(1);
  });

  it("ignores late transcript results after cancelling an active session", () => {
    const { result: hook, onTranscript } = setup();
    act(() => hook.current.start());
    const recognition = FakeRecognition.instances[0]!;

    act(() => recognition.emitResult(0, [result("昨天午饭", false)]));
    expect(onTranscript).toHaveBeenCalledTimes(1);

    act(() => hook.current.cancel());
    expect(hook.current.listening).toBe(false);
    act(() => recognition.emitResult(0, [result("昨天午饭四十五元", true)]));
    expect(onTranscript).toHaveBeenCalledTimes(1);
  });

  describe("热词（contextual biasing）", () => {
    function enablePhraseApi(availability = "available") {
      (window as unknown as { SpeechRecognitionPhrase?: unknown }).SpeechRecognitionPhrase =
        FakePhrase;
      FakeRecognition.available = vi.fn().mockResolvedValue(availability);
    }

    it("enables on-device recognition with deduplicated phrases when the language pack is ready", async () => {
      enablePhraseApi();
      const { result: hook } = setup(["爸爸", "妈妈", " 爸爸 ", ""]);
      // 等待 available() 探测完成
      await act(async () => {});
      act(() => hook.current.start());
      const recognition = FakeRecognition.instances[0]!;
      expect(recognition.processLocally).toBe(true);
      const phrases = recognition.phrases as FakePhrase[];
      expect(phrases.map((p) => p.phrase)).toEqual(["爸爸", "妈妈"]);
      expect(phrases.every((p) => typeof p.boost === "number" && p.boost > 0)).toBe(true);
      expect(FakeRecognition.available).toHaveBeenCalledWith({
        langs: ["zh-CN"],
        processLocally: true,
      });
    });

    it("skips phrases silently when the browser lacks the phrase API", () => {
      const { result: hook } = setup(["爸爸"]);
      act(() => hook.current.start());
      const recognition = FakeRecognition.instances[0]!;
      expect(recognition.phrases).toBeUndefined();
      expect(recognition.processLocally).toBeUndefined();
      expect(hook.current.listening).toBe(true);
    });

    it("keeps cloud recognition without phrases when no local language pack exists", async () => {
      enablePhraseApi("unavailable");
      const { result: hook } = setup(["爸爸"]);
      await act(async () => {});
      act(() => hook.current.start());
      const recognition = FakeRecognition.instances[0]!;
      expect(recognition.phrases).toBeUndefined();
      expect(recognition.processLocally).toBeUndefined();
      expect(hook.current.listening).toBe(true);
    });

    it("installs a downloadable language pack, then uses phrases", async () => {
      enablePhraseApi("downloadable");
      FakeRecognition.install = vi.fn().mockResolvedValue(true);
      const { result: hook } = setup(["爸爸"]);
      await act(async () => {});
      expect(FakeRecognition.install).toHaveBeenCalledWith({
        langs: ["zh-CN"],
        processLocally: true,
      });
      act(() => hook.current.start());
      expect(FakeRecognition.instances[0]!.processLocally).toBe(true);
      expect(FakeRecognition.instances[0]!.phrases).toBeDefined();
    });

    it("restarts without phrases after phrases-not-supported error", async () => {
      enablePhraseApi();
      const { result: hook, onError } = setup(["爸爸"]);
      await act(async () => {});
      act(() => hook.current.start());
      const first = FakeRecognition.instances[0]!;
      expect(first.phrases).toBeDefined();

      // 识别模式不接受热词：报错并结束本次识别。
      act(() => {
        first.onerror?.({ error: "phrases-not-supported" });
        first.onend?.();
      });

      expect(onError).not.toHaveBeenCalled();
      expect(hook.current.listening).toBe(true);
      const second = FakeRecognition.instances[1]!;
      expect(second.phrases).toBeUndefined();
      expect(second.started).toBe(true);
    });

    it("falls back to cloud recognition when local mode rejects the language", async () => {
      enablePhraseApi();
      const { result: hook, onError } = setup(["爸爸"]);
      await act(async () => {});
      act(() => hook.current.start());
      const first = FakeRecognition.instances[0]!;
      expect(first.processLocally).toBe(true);

      act(() => {
        first.onerror?.({ error: "language-not-supported" });
        first.onend?.();
      });

      expect(onError).not.toHaveBeenCalled();
      expect(hook.current.listening).toBe(true);
      const second = FakeRecognition.instances[1]!;
      expect(second.processLocally).toBeUndefined();
      expect(second.phrases).toBeUndefined();
    });
  });
});
