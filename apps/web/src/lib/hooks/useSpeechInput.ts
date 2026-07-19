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
 * 是否以主屏幕 PWA（standalone）形态运行。
 *
 * iOS 切走 app 时会给页面的系统音频会话打上 interruption（挂起）标记；切回前台时
 * Safari 标签页会自动结束 interruption，而 standalone Web App 不会（WebKit 缺陷）。
 * 于是 PWA 里切回后开始录音：采集管线"在跑"（系统显示正在录音），但麦克风轨道
 * 一直处于 muted，识别器收到的全是静音——不出结果也不报错。
 * 唤醒逻辑只在该形态启用；Safari 标签页本来就正常，不去打扰。
 */
function isStandalonePwa(): boolean {
  if (typeof window === "undefined") return false;
  if ((navigator as unknown as { standalone?: boolean }).standalone === true) return true;
  return window.matchMedia?.("(display-mode: standalone)").matches ?? false;
}

// 懒建单例：播放静音样本以结束音频会话的 interruption（仅 PWA 唤醒路径使用）。
let wakeAudioContext: AudioContext | null = null;

/**
 * 必须在用户手势内同步调用：resume AudioContext 并播放一帧静音。
 * 播放行为会迫使 WebKit 重新激活（setActive）系统音频会话、结束挂起，
 * 是社区（各 WebRTC 客户端）对上述 standalone 挂起 bug 验证过的解法。
 */
function kickAudioSession(): void {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    wakeAudioContext ??= new Ctor();
    void wakeAudioContext.resume().catch(() => {});
    const source = wakeAudioContext.createBufferSource();
    source.buffer = wakeAudioContext.createBuffer(1, 1, wakeAudioContext.sampleRate);
    source.connect(wakeAudioContext.destination);
    source.start(0);
  } catch {
    // 播不了就算了，下一步的 getUserMedia 仍是一次独立的唤醒机会。
  }
}

/** 等待轨道解除静音的上限：unmute 事件通常在会话激活后立刻到，超时则带着现状继续。 */
const UNMUTE_TIMEOUT_MS = 1500;

/**
 * 申请麦克风并等待轨道解除静音（muted 正是会话被挂起的直接表现），返回持有的流。
 *
 * 关键：调用方必须在识别会话结束前一直持有该流。上一版"拿到就立刻 stop"之所以无效，
 * 一是拿到的轨道本身就是 muted 的（没等它恢复），二是立刻释放会让刚激活的会话
 * 在识别启动前又被系统放掉。
 */
async function acquireLiveMicStream(): Promise<MediaStream | null> {
  const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  if (!media?.getUserMedia) return null;
  try {
    const stream = await media.getUserMedia({ audio: true });
    const track = stream.getAudioTracks()[0];
    if (track?.muted) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, UNMUTE_TIMEOUT_MS);
        track.addEventListener(
          "unmute",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }
    return stream;
  } catch {
    // 权限/设备问题由 recognition.onerror 统一提示。
    return null;
  }
}

/**
 * 启动看门狗时长：recognition.start() 后多久没有任何识别结果就判定会话失效。
 * iOS PWA 从后台切回后 start() 常会"成功"但底层 audio session 已死，
 * 之后不再触发 onresult/onerror/onend，listening 会永久卡在 true。
 */
const STARTUP_TIMEOUT_MS = 5000;

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
  // 启动看门狗计时器与"是否已收到首个结果"标记（见 STARTUP_TIMEOUT_MS）。
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gotResultRef = useRef(false);
  // 看门狗触发后先静默重启一次（可能恢复失效会话），仍无果才提示；onend 里凭此重启。
  const startupRetryRef = useRef(false);
  const restartOnEndRef = useRef(false);
  // 启动代次：唤醒音频会话（primeAudioSession）是异步的，其间用户若 stop/cancel/再次 start，
  // 代次会改变，等待结束后据此丢弃过期的启动，避免误起一段用户已放弃的录音。
  const startGenRef = useRef(0);
  // onend 内的恢复重启需要调用 primeThenStart，但后者依赖 startInternal，直接引用会形成
  // useCallback 循环依赖；用 ref 转发打破环。
  const primeThenStartRef = useRef<((isRestart: boolean) => void) | null>(null);
  // 页面曾被切到后台（切走过 app / 锁屏）：PWA 下次录音前需先唤醒音频会话；
  // 收到首个识别结果（证明会话真正恢复）后才清除。
  const wasBackgroundedRef = useRef(false);
  // 唤醒路径持有的麦克风流：识别期间不释放（见 acquireLiveMicStream），会话结束时停掉。
  const primeStreamRef = useRef<MediaStream | null>(null);

  const releasePrimeStream = useCallback(() => {
    const stream = primeStreamRef.current;
    primeStreamRef.current = null;
    if (stream) for (const track of stream.getTracks()) track.stop();
  }, []);

  const phrasesRef = useRef(phrases);
  phrasesRef.current = phrases;
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current !== null) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  // 彻底拆除当前识别会话并同步复位状态：解绑回调后再 abort，
  // 避免 onend 触发自动重启逻辑，也不依赖 iOS 可能不发的 onend 来复位 listening。
  const teardown = useCallback(() => {
    clearWatchdog();
    // 作废任何进行中的异步启动（唤醒会话等待期间的这一代不再落地）。
    startGenRef.current += 1;
    releasePrimeStream();
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    retryWithoutPhrasesRef.current = false;
    restartOnEndRef.current = false;
    startupRetryRef.current = false;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
    }
    setListening(false);
  }, [clearWatchdog, releasePrimeStream]);

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
      if (watchdogRef.current !== null) clearTimeout(watchdogRef.current);
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      const stream = primeStreamRef.current;
      primeStreamRef.current = null;
      if (stream) for (const track of stream.getTracks()) track.stop();
    },
    [],
  );

  // iOS PWA 切到后台会挂起语音识别的 audio session，切回来后旧会话已失效却不发 onend，
  // 再次录音就会卡在假"正在录音"。进入后台时整体拆除，回前台由用户手势重新开始。
  useEffect(() => {
    const markBackgrounded = () => {
      // 记录曾进入后台：切回后首次录音走唤醒会话的路径，规避挂起的 audio session。
      wasBackgroundedRef.current = true;
      teardown();
    };
    const handleHidden = () => {
      if (document.visibilityState === "hidden") markBackgrounded();
    };
    document.addEventListener("visibilitychange", handleHidden);
    window.addEventListener("pagehide", markBackgrounded);
    return () => {
      document.removeEventListener("visibilitychange", handleHidden);
      window.removeEventListener("pagehide", markBackgrounded);
    };
  }, [teardown]);

  const stop = useCallback(() => {
    // 用户主动停止：先撤下看门狗，避免 stop 后 onend 迟到期间看门狗误判并重启录音。
    clearWatchdog();
    // 作废进行中的异步启动，防止唤醒会话结束后又起一段用户已停止的录音。
    startGenRef.current += 1;
    const recognition = recognitionRef.current;
    if (recognition) {
      // stop 而非 abort：让浏览器把最后一段临时结果定稿后再触发 onend。
      recognition.stop();
    } else {
      // 正处于唤醒会话的异步等待中（尚无 recognition 实例）：直接复位录音态。
      setListening(false);
    }
  }, [clearWatchdog]);

  // 发送等已消费当前文本的场景：整体拆除，丢弃迟到定稿，避免覆盖已清空的输入框。
  const cancel = teardown;

  const startInternal = useCallback(
    (isRestart: boolean) => {
      if (recognitionRef.current) return;
      const Ctor = getSpeechRecognitionCtor();
      if (!Ctor) return;
      // 全新一次录音（非内部自动重启）：复位看门狗重试计数。
      if (!isRestart) startupRetryRef.current = false;

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
      gotResultRef.current = false;

      recognition.onresult = (event) => {
        // 收到首个结果即证明会话有效：撤下启动看门狗，清除"曾入后台"标记。
        gotResultRef.current = true;
        wasBackgroundedRef.current = false;
        clearWatchdog();
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
        clearWatchdog();
        if (retryWithoutPhrasesRef.current) {
          // 热词导致识别中止：立即无热词重启（unsupported 已置位，不会再传），保持录音状态。
          retryWithoutPhrasesRef.current = false;
          startInternal(true);
          return;
        }
        if (restartOnEndRef.current) {
          // 看门狗判定会话失效后的一次静默重启：先唤醒音频会话再重启，尝试恢复挂起的 audio session。
          restartOnEndRef.current = false;
          primeThenStartRef.current?.(true);
          return;
        }
        releasePrimeStream();
        setListening(false);
      };

      recognitionRef.current = recognition;
      try {
        recognition.start();
        setListening(true);
        clearWatchdog();
        watchdogRef.current = setTimeout(() => {
          watchdogRef.current = null;
          // 已出结果或会话已结束：一切正常，无需介入。
          if (gotResultRef.current || !recognitionRef.current) return;
          if (!startupRetryRef.current) {
            // 首次超时：静默中止并在 onend 里重启一次（restartOnEnd），保持录音状态。
            startupRetryRef.current = true;
            restartOnEndRef.current = true;
            recognitionRef.current.abort();
          } else {
            // 重启后仍无结果：判定确实起不来，提示用户重试。
            startupRetryRef.current = false;
            onErrorRef.current?.(
              isStandalonePwa()
                ? "录音未能启动：系统麦克风可能被挂起，请上滑关闭应用后重新打开"
                : "录音未能启动，请重试后再说话",
            );
            recognitionRef.current.abort();
          }
        }, STARTUP_TIMEOUT_MS);
      } catch {
        recognitionRef.current = null;
        clearWatchdog();
        setListening(false);
        onErrorRef.current?.("语音识别启动失败，请重试");
      }
    },
    [lang, clearWatchdog, releasePrimeStream],
  );

  // 唤醒音频会话后再启动识别（仅 standalone PWA 需要）：持流启动，异步等待期间用代次守卫防止过期启动落地。
  const primeThenStart = useCallback(
    async (isRestart: boolean) => {
      if (recognitionRef.current) return;
      const gen = (startGenRef.current += 1);
      releasePrimeStream();
      const stream = isStandalonePwa() ? await acquireLiveMicStream() : null;
      if (gen !== startGenRef.current || recognitionRef.current) {
        // 等待期间用户已停止/重新开始：这一代作废，释放刚拿到的流。
        if (stream) for (const track of stream.getTracks()) track.stop();
        return;
      }
      // 识别期间持有该流：立刻释放会让刚激活的音频会话在识别启动前又被系统放掉。
      primeStreamRef.current = stream;
      startInternal(isRestart);
    },
    [startInternal, releasePrimeStream],
  );
  primeThenStartRef.current = primeThenStart;

  const start = useCallback(() => {
    if (isStandalonePwa() && wasBackgroundedRef.current) {
      // 主屏幕 PWA 从后台切回：WebKit 不会自动恢复被挂起的音频会话（Safari 标签页会）。
      // 先在用户手势内播静音样本结束 interruption，再持流启动识别；
      // wasBackgrounded 不在此清除，等真正收到识别结果（onresult）才算恢复。
      kickAudioSession();
      void primeThenStart(false);
    } else {
      // 常规路径：保持在用户手势内同步启动，首次授权只弹一次语音识别权限、无额外麦克风弹窗。
      startInternal(false);
    }
  }, [primeThenStart, startInternal]);

  return { supported, listening, start, stop, cancel };
}
