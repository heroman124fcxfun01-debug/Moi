import type { GeminiVoiceName } from '../types/book';
import { cleanParagraphText, isJunkScrapedText } from './bookCleaner';

export interface OnDeviceVoiceProfile {
  description: string;
  stylePrompt: string;
  recommendedBaseVoice: GeminiVoiceName;
  pitchHint: number;
  rateHint: number;
  transcriptPreview?: string;
  estimatedF0Hz?: number;
  durationSec?: number;
}

export interface ClientExtractedWebChapter {
  url: string;
  title: string;
  paragraphs: string[];
  wordCount: number;
  nextUrl: string | null;
  nextLabel: string | null;
  interactiveLinks: Array<{ label: string; selector: string; href: string | null }>;
}

export interface DeviceHardwareSnapshot {
  cpuCores: number;
  hasSpeechSynthesis: boolean;
  installedSpeechVoices: number;
  hasWebAudio: boolean;
  hasWakeLock: boolean;
  hasVibration: boolean;
  hasTextDetector: boolean;
  hasOnDeviceTranslator: boolean;
  isStandalonePwa: boolean;
  storageUsedMb: number | null;
  storageQuotaMb: number | null;
  storagePersisted: boolean;
}

/**
 * Pure acoustic DSP analysis on raw mono PCM samples (runs 100% on-device with zero server).
 * Computes RMS loudness, speaking density, zero-crossing rate, and autocorrelation F0 pitch
 * to classify vocal timbre and suggest matching voice parameters.
 */
export function analyzePcmVoiceMetrics(
  samples: Float32Array,
  sampleRate: number,
  fileName = 'voice-sample'
): OnDeviceVoiceProfile {
  const totalSamples = samples.length;
  const durationSec = sampleRate > 0 ? Number((totalSamples / sampleRate).toFixed(1)) : 0;

  if (totalSamples < 256 || sampleRate <= 0) {
    return {
      description: `Mẫu âm thanh (${fileName}) đã nạp trực tiếp trên thiết bị — giọng đọc cân bằng tự nhiên.`,
      stylePrompt: 'Đọc tự nhiên, truyền cảm, rõ chữ và ổn định nhịp thở',
      recommendedBaseVoice: 'Kore',
      pitchHint: 1.0,
      rateHint: 1.0,
      durationSec,
    };
  }

  // Analyze up to first 6 seconds for fast, battery-friendly on-device DSP
  const maxAnalyze = Math.min(totalSamples, Math.floor(sampleRate * 6));
  let sumSq = 0;
  let zeroCrossings = 0;
  let activeFrames = 0;
  const frameSize = Math.max(256, Math.floor(sampleRate * 0.03));

  for (let i = 0; i < maxAnalyze; i++) {
    const v = samples[i];
    sumSq += v * v;
    if (i > 0 && ((samples[i - 1] >= 0 && v < 0) || (samples[i - 1] < 0 && v >= 0))) {
      zeroCrossings++;
    }
  }
  const rms = Math.sqrt(sumSq / maxAnalyze);
  const zcrPerSec = (zeroCrossings / maxAnalyze) * sampleRate;

  // Estimate active speech density across 30ms frames
  const totalFrames = Math.max(1, Math.floor(maxAnalyze / frameSize));
  const noiseFloor = Math.max(0.012, rms * 0.35);
  for (let f = 0; f < totalFrames; f++) {
    let fSq = 0;
    const start = f * frameSize;
    for (let j = 0; j < frameSize; j++) {
      const s = samples[start + j];
      fSq += s * s;
    }
    if (Math.sqrt(fSq / frameSize) >= noiseFloor) {
      activeFrames++;
    }
  }
  const speechDensity = activeFrames / totalFrames;

  // Fundamental pitch (F0) via bounded autocorrelation on a voiced 2048-sample window
  const minLag = Math.max(20, Math.floor(sampleRate / 340)); // ~340 Hz upper human speech
  const maxLag = Math.min(Math.floor(sampleRate / 75), 1024); // ~75 Hz lower human speech
  const winSize = Math.min(2048, maxAnalyze - maxLag - 1);
  let bestLag = 0;
  let bestCorr = -Infinity;

  if (winSize > 256 && maxLag > minLag) {
    // Pick the loudest window offset so we measure voiced speech instead of silence
    let bestOffset = 0;
    let maxWinEnergy = -1;
    const step = Math.max(winSize, Math.floor((maxAnalyze - winSize - maxLag) / 6));
    for (let off = 0; off + winSize + maxLag < maxAnalyze; off += step) {
      let e = 0;
      for (let k = 0; k < winSize; k += 4) {
        const v = samples[off + k];
        e += v * v;
      }
      if (e > maxWinEnergy) {
        maxWinEnergy = e;
        bestOffset = off;
      }
    }

    for (let lag = minLag; lag <= maxLag; lag++) {
      let corr = 0;
      for (let k = 0; k < winSize; k += 2) {
        corr += samples[bestOffset + k] * samples[bestOffset + k + lag];
      }
      if (corr > bestCorr) {
        bestCorr = corr;
        bestLag = lag;
      }
    }
  }

  const estimatedF0Hz = bestLag > 0 ? Math.round(sampleRate / bestLag) : 165;

  let recommendedBaseVoice: GeminiVoiceName = 'Kore';
  let pitchHint = 1.0;
  let timbreLabel = 'trung tính ấm áp';
  let stylePrompt = 'Đọc truyền cảm, nhịp thở tự nhiên và rõ nét từng câu chữ';

  if (estimatedF0Hz < 130) {
    recommendedBaseVoice = rms > 0.14 ? 'Fenrir' : 'Charon';
    pitchHint = 0.84;
    timbreLabel = rms > 0.14 ? 'nam trầm nội lực, mạnh mẽ' : 'nam trầm ấm, điềm đạm';
    stylePrompt =
      rms > 0.14
        ? 'Giọng nam trầm nội lực, dứt khoát và giàu chiều sâu kịch tính'
        : 'Giọng nam trầm ấm, chậm rãi, sâu lắng như người kể chuyện đêm khuya';
  } else if (estimatedF0Hz < 175) {
    recommendedBaseVoice = zcrPerSec > 1800 ? 'Puck' : 'Charon';
    pitchHint = 0.94;
    timbreLabel = 'nam trung linh hoạt, rõ chữ';
    stylePrompt = 'Giọng nam trung sáng rõ, nhịp kể linh hoạt, dễ nghe lâu dài';
  } else if (estimatedF0Hz < 225) {
    recommendedBaseVoice = 'Zephyr';
    pitchHint = 1.08;
    timbreLabel = 'nữ dịu dàng, thanh thoát';
    stylePrompt = 'Giọng nữ nhẹ nhàng, truyền cảm, giàu cảm xúc cho tiểu thuyết';
  } else {
    recommendedBaseVoice = 'Aoede';
    pitchHint = 1.18;
    timbreLabel = 'nữ trong trẻo, sắc sảo';
    stylePrompt = 'Giọng nữ sáng trong, biểu cảm tinh tế và rõ từng âm tiết';
  }

  const rateHint = Number(
    Math.max(0.86, Math.min(1.18, 0.92 + speechDensity * 0.22)).toFixed(2)
  );

  return {
    description: `Phân tích trực tiếp bằng DSP thiết bị (${durationSec}s · ~${estimatedF0Hz}Hz): chất giọng ${timbreLabel}.`,
    stylePrompt,
    recommendedBaseVoice,
    pitchHint,
    rateHint,
    estimatedF0Hz,
    durationSec,
  };
}

/**
 * Decodes an uploaded audio dataURL directly using the phone's Web Audio API hardware
 * and produces a complete voice dubbing profile 100% offline.
 */
export async function analyzeVoiceSampleOnDevice(
  dataUrl: string,
  fileName: string
): Promise<OnDeviceVoiceProfile> {
  if (typeof window === 'undefined') {
    return analyzePcmVoiceMetrics(new Float32Array(0), 16000, fileName);
  }
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    return analyzePcmVoiceMetrics(new Float32Array(0), 16000, fileName);
  }

  const ctx = new AudioCtx();
  try {
    const resp = await fetch(dataUrl);
    const arrayBuffer = await resp.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const channelData = audioBuffer.getChannelData(0);
    return analyzePcmVoiceMetrics(channelData, audioBuffer.sampleRate, fileName);
  } catch {
    return analyzePcmVoiceMetrics(new Float32Array(0), 16000, fileName);
  } finally {
    ctx.close().catch(() => {});
  }
}

/**
 * Pure client-side HTML / raw text chapter extractor so web-to-EPUB works 100% standalone
 * on the phone without relying on any backend scraper API.
 */
export function extractWebChapterClientSide(
  rawHtmlOrText: string,
  sourceUrl = ''
): ClientExtractedWebChapter {
  const trimmed = (rawHtmlOrText || '').trim();
  if (!trimmed) {
    return {
      url: sourceUrl,
      title: 'Chương chưa có tiêu đề',
      paragraphs: [],
      wordCount: 0,
      nextUrl: null,
      nextLabel: null,
      interactiveLinks: [],
    };
  }

  // If plain text (not HTML), split cleanly into paragraphs
  const looksLikeHtml = /<(html|body|div|p|article|h1|h2|section|br)\b/i.test(trimmed);
  if (!looksLikeHtml) {
    const lines = trimmed
      .split(/\n{1,}/)
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter((l) => l.length >= 2);
    const title = lines[0] && lines[0].length <= 120 ? lines[0] : 'Chương nhập trực tiếp';
    const body = lines.length > 1 && lines[0] === title ? lines.slice(1) : lines;
    const wordCount = body.join(' ').split(/\s+/).filter(Boolean).length;
    return {
      url: sourceUrl,
      title,
      paragraphs: body,
      wordCount,
      nextUrl: null,
      nextLabel: null,
      interactiveLinks: [],
    };
  }

  // Strip <head>, scripts/styles/navigation noise safely via regex (works in Node tests & browsers)
  const h1Match = trimmed.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const titleMatch = trimmed.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  const cleaned = trimmed
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<(meta|link|base)\b[^>]*\/?>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ');

  const stripTags = (s: string) => cleanParagraphText(s);

  const title = stripTags(h1Match?.[1] || titleMatch?.[1] || '') || 'Chương tải từ Web';

  // Extract <p> blocks first; fallback to <br>-separated text
  const paragraphs: string[] = [];
  const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = pRegex.exec(cleaned)) !== null) {
    const text = stripTags(m[1]);
    if (text.length >= 18 && !isJunkScrapedText(text)) {
      paragraphs.push(text);
    }
  }

  if (paragraphs.length < 2) {
    const fallbackBlocks = cleaned
      .replace(/<(br|\/div|\/p|\/li|\/h[1-6])[^>]*>/gi, '\n')
      .split('\n')
      .map(stripTags)
      .filter((line) => line.length >= 24 && !isJunkScrapedText(line));
    if (fallbackBlocks.length > paragraphs.length) {
      paragraphs.length = 0;
      paragraphs.push(...fallbackBlocks);
    }
  }

  // Detect next-chapter links
  const interactiveLinks: Array<{ label: string; selector: string; href: string | null }> = [];
  let nextUrl: string | null = null;
  let nextLabel: string | null = null;
  const linkRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const nextPattern = /(chương\s*(sau|tiếp|kế)|trang\s*(sau|tiếp)|next\s*(chapter|page)?|tiếp\s*theo|»|→)/i;

  while ((m = linkRegex.exec(trimmed)) !== null) {
    const rawHref = m[1].trim();
    const label = stripTags(m[2]);
    if (!label || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) continue;
    let absHref: string | null = rawHref;
    try {
      absHref = sourceUrl ? new URL(rawHref, sourceUrl).toString() : rawHref;
    } catch {
      absHref = rawHref;
    }
    if (interactiveLinks.length < 12) {
      interactiveLinks.push({ label: label.slice(0, 40), selector: `a[href="${rawHref}"]`, href: absHref });
    }
    if (!nextUrl && nextPattern.test(label)) {
      nextUrl = absHref;
      nextLabel = label;
    }
  }

  const wordCount = paragraphs.join(' ').split(/\s+/).filter(Boolean).length;
  return {
    url: sourceUrl,
    title,
    paragraphs,
    wordCount,
    nextUrl,
    nextLabel,
    interactiveLinks,
  };
}

/**
 * Triggers tactile haptic micro-vibration on mobile hardware (Android/supported devices).
 */
export function triggerDeviceHaptic(
  kind: 'tap' | 'page' | 'success' = 'tap',
  enabled = true
): boolean {
  if (!enabled || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
    return false;
  }
  try {
    const pattern = kind === 'success' ? [12, 35, 16] : kind === 'page' ? 10 : 6;
    return navigator.vibrate(pattern);
  } catch {
    return false;
  }
}

/**
 * Uses the phone's built-in Vision TextDetector hardware API (Android Chrome / WebView)
 * for 100% offline image-to-text OCR when available.
 */
export async function tryOnDeviceHardwareOcr(dataUrl: string): Promise<string[] | null> {
  if (typeof window === 'undefined' || typeof Image === 'undefined') return null;
  const g = window as unknown as {
    TextDetector?: new () => { detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string }>> };
  };
  if (!g.TextDetector) return null;

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Không thể giải mã ảnh trên thiết bị.'));
      el.src = dataUrl;
    });
    const detector = new g.TextDetector();
    const blocks = await detector.detect(img);
    const lines = blocks
      .map((b) => String(b.rawValue || '').replace(/\s+/g, ' ').trim())
      .filter((s) => s.length > 0);
    return lines.length > 0 ? lines : null;
  } catch {
    return null;
  }
}

/**
 * Requests persistent device storage so the phone OS never evicts the user's offline
 * EPUB library, custom fonts, voice samples, or wallpapers.
 */
export async function requestPersistentDeviceStorage(): Promise<{
  persisted: boolean;
  usedMb: number | null;
  quotaMb: number | null;
}> {
  if (typeof navigator === 'undefined' || !navigator.storage) {
    return { persisted: false, usedMb: null, quotaMb: null };
  }
  let persisted = false;
  try {
    if (typeof navigator.storage.persisted === 'function') {
      persisted = await navigator.storage.persisted();
    }
    if (!persisted && typeof navigator.storage.persist === 'function') {
      persisted = await navigator.storage.persist();
    }
  } catch {
    persisted = false;
  }

  let usedMb: number | null = null;
  let quotaMb: number | null = null;
  try {
    if (typeof navigator.storage.estimate === 'function') {
      const est = await navigator.storage.estimate();
      if (typeof est.usage === 'number') {
        usedMb = Number((est.usage / (1024 * 1024)).toFixed(1));
      }
      if (typeof est.quota === 'number') {
        quotaMb = Number((est.quota / (1024 * 1024)).toFixed(0));
      }
    }
  } catch {
    // ignore estimate failures
  }
  return { persisted, usedMb, quotaMb };
}

/**
 * Inspects real device hardware capabilities available to LaziRead on this phone/browser.
 */
export async function inspectDeviceHardwareCapabilities(): Promise<DeviceHardwareSnapshot> {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  const win = typeof window !== 'undefined' ? window : null;

  const storageInfo = await requestPersistentDeviceStorage();
  const hasSpeechSynthesis = Boolean(win && 'speechSynthesis' in win);
  const installedSpeechVoices = hasSpeechSynthesis
    ? win?.speechSynthesis.getVoices().length || 0
    : 0;
  const hasWebAudio = Boolean(
    win &&
      (win.AudioContext ||
        (win as unknown as { webkitAudioContext?: unknown }).webkitAudioContext)
  );
  const hasWakeLock = Boolean(nav && 'wakeLock' in nav);
  const hasVibration = Boolean(nav && typeof nav.vibrate === 'function');
  const hasTextDetector = Boolean(win && 'TextDetector' in win);
  const hasOnDeviceTranslator = Boolean(
    typeof globalThis !== 'undefined' &&
      'Translator' in globalThis &&
      typeof (globalThis as unknown as { Translator?: { create?: unknown } }).Translator?.create ===
        'function'
  );
  const isStandalonePwa = Boolean(
    win &&
      (win.matchMedia?.('(display-mode: standalone)').matches ||
        (nav as unknown as { standalone?: boolean } | null)?.standalone === true)
  );

  return {
    cpuCores: nav?.hardwareConcurrency || 4,
    hasSpeechSynthesis,
    installedSpeechVoices,
    hasWebAudio,
    hasWakeLock,
    hasVibration,
    hasTextDetector,
    hasOnDeviceTranslator,
    isStandalonePwa,
    storageUsedMb: storageInfo.usedMb,
    storageQuotaMb: storageInfo.quotaMb,
    storagePersisted: storageInfo.persisted,
  };
}
