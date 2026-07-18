"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * lib.dom.d.ts 未收录 Web Speech API，这里声明用到的最小子集。
 * Safari（含 iOS）只暴露带 webkit 前缀的构造器。
 */
interface MinimalSpeechRecognitionEvent {
  resultIndex: number;
  results: ArrayLike<
    ArrayLike<{ transcript: string }> & {
      isFinal: boolean;
    }
  >;
}

interface MinimalSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  /** 规范新增的热词列表（contextual biasing），老浏览器上不存在。 */
  phrases?: unknown;
  /** true 时强制本地（on-device）识别；热词只在本地识别模式下生效。 */
  processLocally?: boolean;
  onresult: ((event: MinimalSpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionCtor = (new () => MinimalSpeechRecognition) & {
  /** 静态方法：查询本地识别语言包状态（available/downloadable/downloading/unavailable）。 */
  available?: (options: { langs: string[]; processLocally: boolean }) => Promise<string>;
  install?: (options: { langs: string[]; processLocally: boolean }) => Promise<boolean>;
};
type SpeechRecognitionPhraseCtor = new (phrase: string, boost?: number) => unknown;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function getSpeechRecognitionPhraseCtor(): SpeechRecognitionPhraseCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognitionPhrase?: SpeechRecognitionPhraseCtor;
    webkitSpeechRecognitionPhrase?: SpeechRecognitionPhraseCtor;
  };
  return w.SpeechRecognitionPhrase ?? w.webkitSpeechRecognitionPhrase ?? null;
}

/** 热词权重（规范范围 0–10，默认 1）：人名等短专有名词适度加权，过高易误召回。 */
const PHRASE_BOOST = 10;
const MAX_PHRASES = 100;

/**
 * 把热词写入 recognition.phrases（Web Speech API contextual biasing）。
 * 浏览器不支持该接口或写入失败时静默放弃，不影响识别本身。
 */
function applyPhrases(recognition: MinimalSpeechRecognition, phrases: readonly string[]) {
  const PhraseCtor = getSpeechRecognitionPhraseCtor();
  if (!PhraseCtor) return;
  const unique = [...new Set(phrases.map((p) => p.trim()).filter(Boolean))].slice(0, MAX_PHRASES);
  if (unique.length === 0) return;
  try {
    const list = unique.map((phrase) => new PhraseCtor(phrase, PHRASE_BOOST));
    try {
      recognition.phrases = list;
    } catch {
      // 部分实现的 phrases 是只读 ObservableArray，退化为逐项 push。
      (recognition.phrases as { push?: (...items: unknown[]) => void } | undefined)?.push?.(
        ...list,
      );
    }
  } catch {
    // 忽略实现差异导致的构造/写入异常
  }
}

export interface UseSpeechInputOptions {
  lang?: string;
  /** 热词（如人员名）：提示识别引擎优先匹配，仅在支持 contextual biasing 的浏览器生效。 */
  phrases?: readonly string[];
  /** 本次录音会话的完整转写（已确定 + 临时片段），每次识别更新都会回调。 */
  onTranscript: (transcript: string) => void;
  onError?: (message: string) => void;
}

/**
 * 浏览器原生实时语音转文字（Web Speech API），不经过任何大模型服务。
 *
 * Safari 兼容要点：
 * - 只提供 `webkitSpeechRecognition` 前缀版本；需 HTTPS（或 localhost）且由用户手势触发 start。
 * - iOS Safari 在静音一段时间后会自行结束识别且可能不触发 onerror，
 *   统一在 onend 里复位 listening，已转写文本保留在输入框中。
 * - Safari 的 results 可能是单条 transcript 持续增长、结束才 isFinal；
 *   Chrome 则是多条累积。onresult 里「已确定段落累加 + 临时段落拼接」两者都正确。
 */
export function useSpeechInput({
  lang = "zh-CN",
  phrases,
  onTranscript,
  onError,
}: UseSpeechInputOptions) {
  // 通过 effect 置位避免 SSR/hydration 不一致（服务端恒 false）。
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<MinimalSpeechRecognition | null>(null);
  const finalTranscriptRef = useRef("");
  // 当前识别模式不接受热词（如报 phrases-not-supported）时置位，
  // 本页面后续会话不再传热词，避免反复失败重启。
  const phrasesUnsupportedRef = useRef(false);
  // 热词/本地识别导致本次识别中止：onend 里凭此标记自动降级重启一次。
  const retryWithoutPhrasesRef = useRef(false);
  // 热词只在本地（on-device）识别下生效：available() 确认语言包就绪后才置 true。
  const localPhrasesReadyRef = useRef(false);

  const phrasesRef = useRef(phrases);
  phrasesRef.current = phrases;
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    setSupported(getSpeechRecognitionCtor() !== null);
  }, []);

  // 探测本地识别语言包：热词（contextual biasing）只在 processLocally 模式下生效
  //（Chrome 142+；Safari 尚未实现 SpeechRecognitionPhrase，探测条件不满足自然跳过）。
  const wantsPhrases = (phrases?.length ?? 0) > 0;
  useEffect(() => {
    if (!wantsPhrases) return;
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor?.available || !getSpeechRecognitionPhraseCtor()) return;
    let cancelled = false;
    void (async () => {
      try {
        const state = await Ctor.available!({ langs: [lang], processLocally: true });
        if (cancelled) return;
        if (state === "available") {
          localPhrasesReadyRef.current = true;
        } else if (state === "downloadable" && Ctor.install) {
          // 后台安装语言包（仅桌面 Chrome 会走到这里），装好后热词即生效。
          const ok = await Ctor.install({ langs: [lang], processLocally: true });
          if (!cancelled && ok) localPhrasesReadyRef.current = true;
        }
      } catch {
        // 探测失败视为不支持本地识别，继续用云端识别（无热词）。
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lang, wantsPhrases]);

  useEffect(
    () => () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    },
    [],
  );

  const stop = useCallback(() => {
    // stop 而非 abort：让浏览器把最后一段临时结果定稿后再触发 onend。
    recognitionRef.current?.stop();
  }, []);

  const cancel = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    // 发送等已消费当前文本的场景不再接收最终定稿，否则迟到的 onresult 会把已清空的输入框写回。
    recognition.onresult = null;
    retryWithoutPhrasesRef.current = false;
    recognition.abort();
    setListening(false);
  }, []);

  const start = useCallback(() => {
    if (recognitionRef.current) return;
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.interimResults = true;
    recognition.continuous = true;
    const useLocalPhrases =
      !phrasesUnsupportedRef.current &&
      localPhrasesReadyRef.current &&
      (phrasesRef.current?.length ?? 0) > 0;
    if (useLocalPhrases) {
      recognition.processLocally = true;
      applyPhrases(recognition, phrasesRef.current!);
    }
    finalTranscriptRef.current = "";

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result?.[0]?.transcript ?? "";
        if (result?.isFinal) finalTranscriptRef.current += text;
        else interim += text;
      }
      onTranscriptRef.current(finalTranscriptRef.current + interim);
    };

    recognition.onerror = (event) => {
      // 静音结束（no-speech）与主动中止（aborted）不算错误，不打扰用户。
      const code = event.error;
      if (code === "no-speech" || code === "aborted") return;
      if (code === "phrases-not-supported") {
        phrasesUnsupportedRef.current = true;
        retryWithoutPhrasesRef.current = true;
        return;
      }
      // 本地识别实际不可用（语言包状态与 available() 结果不符等）：降级云端重启。
      if (code === "language-not-supported" && useLocalPhrases) {
        localPhrasesReadyRef.current = false;
        retryWithoutPhrasesRef.current = true;
        return;
      }
      onErrorRef.current?.(
        code === "not-allowed" || code === "service-not-allowed"
          ? "麦克风权限被拒绝，请在浏览器设置中允许使用麦克风"
          : "语音识别失败，请重试或改用键盘输入",
      );
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      if (retryWithoutPhrasesRef.current) {
        // 热词导致识别中止：立即无热词重启（unsupported 已置位，不会再传），保持录音状态。
        retryWithoutPhrasesRef.current = false;
        start();
        return;
      }
      setListening(false);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      recognitionRef.current = null;
      setListening(false);
      onErrorRef.current?.("语音识别启动失败，请重试");
    }
  }, [lang]);

  return { supported, listening, start, stop, cancel };
}
