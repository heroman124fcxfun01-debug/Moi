import { Capacitor } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import type { ExternalVoiceAsset, GeminiVoiceName } from '../types/book';
import { MAX_READING_SPEED, MIN_READING_SPEED } from './audioFilterEngine';
import { mapTimeRatioToWeightedCharIndex } from './audiobookPrefetch';
import { normalizeVietnameseForSpeech } from './vietnameseTtsNormalizer';

/**
 * Distinct on-device acoustic profiles for each voice preset so every voice
 * sounds unmistakably differentiated using the phone's built-in TTS engine (100% offline),
 * even on Android phones with only 1 local Vietnamese TTS voice installed.
 */
export const ON_DEVICE_VOICE_TONES: Record<
  GeminiVoiceName,
  { pitch: number; rate: number; preferGender: 'female' | 'male' | 'neutral'; voiceSlotIndex: number }
> = {
  Kore: { pitch: 1.04, rate: 1.0, preferGender: 'female', voiceSlotIndex: 0 },
  Charon: { pitch: 0.72, rate: 0.93, preferGender: 'male', voiceSlotIndex: 1 },
  Zephyr: { pitch: 1.26, rate: 0.97, preferGender: 'female', voiceSlotIndex: 2 },
  Fenrir: { pitch: 0.56, rate: 0.9, preferGender: 'male', voiceSlotIndex: 3 },
  Puck: { pitch: 0.88, rate: 1.08, preferGender: 'male', voiceSlotIndex: 4 },
  Aoede: { pitch: 1.46, rate: 1.04, preferGender: 'female', voiceSlotIndex: 5 },
};

/**
 * Computes consistent acoustic & Voice Design parameters for an imported/Studio ExternalVoiceAsset
 * so previewing in Studio/Drawer and live audiobook playback sound 100% identical.
 */
export function computeExternalVoiceSpeechParams(ext: ExternalVoiceAsset): {
  baseVoice: GeminiVoiceName;
  pitch: number;
  rate: number;
  preferGender: 'female' | 'male' | 'neutral';
  voiceSlotIndex: number;
  warmthDb: number;
  clarityDb: number;
  stylePrompt: string;
} {
  const promptParams = ext.promptParams;
  const baseVoice =
    promptParams?.recommendedBaseVoice ||
    ext.analyzedProfile?.recommendedBaseVoice ||
    'Kore';
  const preset = ON_DEVICE_VOICE_TONES[baseVoice] || ON_DEVICE_VOICE_TONES.Kore;
  const tone = ext.toneSettings;
  const analyzed = ext.analyzedProfile;

  const preferGender =
    analyzed?.gender === 'male' || analyzed?.gender === 'female' || analyzed?.gender === 'neutral'
      ? analyzed.gender
      : preset.preferGender;

  const rawPitch = promptParams?.pitch ?? tone?.pitch ?? analyzed?.pitchHint ?? preset.pitch;
  const rawRate = promptParams?.speed ?? tone?.rate ?? analyzed?.rateHint ?? preset.rate;
  const warmthDb =
    promptParams?.warmthDb ?? tone?.warmthDb ?? analyzed?.warmthDb ?? (preferGender === 'male' ? 3 : 0);
  const clarityDb =
    promptParams?.clarityDb ?? tone?.clarityDb ?? analyzed?.clarityDb ?? 1;

  // Reflect EQ warmth/clarity subtly in on-device pitch so EQ-tuned & prompt-tuned voices are audibly distinct even offline
  const warmthShift = -warmthDb * 0.014;
  const clarityShift = clarityDb * 0.01;
  const pitch = Math.min(1.68, Math.max(0.58, Math.round((rawPitch + warmthShift + clarityShift) * 100) / 100));
  const rate = Math.min(MAX_READING_SPEED, Math.max(MIN_READING_SPEED, Math.round(rawRate * 100) / 100));

  // Deterministic slot offset from unique voiceId / id so distinct custom voices rotate through device voices
  const seedKey = ext.voiceId || ext.id;
  let hash = 0;
  for (let i = 0; i < seedKey.length; i++) {
    hash = (hash * 31 + seedKey.charCodeAt(i)) >>> 0;
  }
  const voiceSlotIndex = (preset.voiceSlotIndex + (hash % 4)) % 6;

  return {
    baseVoice,
    pitch,
    rate,
    preferGender,
    voiceSlotIndex,
    warmthDb,
    clarityDb,
    stylePrompt:
      promptParams?.geminiStylePrompt ||
      analyzed?.stylePrompt ||
      tone?.styleDirection ||
      `Đọc theo âm sắc giọng ${ext.name}, giữ nhịp tự nhiên và truyền cảm`,
  };
}

let cachedNativeVoices: Array<{ voiceURI?: string; name?: string; lang?: string; localService?: boolean }> | null =
  null;

// Adaptive speaking speed calibration learned from actual completed sentences on this phone
let observedBaseCharsPerSec = 13.4;

let sharedAudioCtx: AudioContext | null = null;
let keepaliveGain: GainNode | null = null;
let keepaliveOsc: OscillatorNode | null = null;
let activeSpeechCancelled = false;
let speechGeneration = 0;
let activeWebSpeechCancelResolver: (() => void) | null = null;

function getSharedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    try {
      sharedAudioCtx = new AudioCtx();
    } catch {
      return null;
    }
  }
  return sharedAudioCtx;
}

/**
 * MUST be invoked synchronously inside a user tap/click handler BEFORE any `await` call.
 * Preserves browser/Android WebView User Activation so audio & TTS playback never gets blocked by autoplay policy.
 */
export function unlockAudioPlaybackSync(): boolean {
  if (typeof window === 'undefined') return false;
  let unlocked = false;
  try {
    const ctx = getSharedAudioContext();
    if (ctx) {
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const buffer = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start(0);
      unlocked = true;
    }
  } catch {
    // ignore Web Audio unlock errors
  }

  try {
    if ('speechSynthesis' in window) {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
      // Prime voice list on first touch
      window.speechSynthesis.getVoices();
      unlocked = true;
    }
  } catch {
    // ignore speechSynthesis unlock errors
  }
  return unlocked;
}

/**
 * Maintains an ultra-quiet Web Audio keepalive node while audiobook playback is running
 * so Android WebView holds Audio Focus seamlessly between sentences, batches, and chapters.
 */
export function startAudioFocusKeepalive(): void {
  const ctx = getSharedAudioContext();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    if (keepaliveOsc) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 180;
    gain.gain.value = 0.00001; // Sub-audible Audio Focus keeper
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    keepaliveOsc = osc;
    keepaliveGain = gain;
  } catch {
    // ignore AudioContext keepalive errors
  }
}

export function stopAudioFocusKeepalive(): void {
  try {
    if (keepaliveOsc) {
      keepaliveOsc.stop();
      keepaliveOsc.disconnect();
      keepaliveOsc = null;
    }
    if (keepaliveGain) {
      keepaliveGain.disconnect();
      keepaliveGain = null;
    }
  } catch {
    keepaliveOsc = null;
    keepaliveGain = null;
  }
}

function isCapacitorNativeTtsReady(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return Capacitor.isNativePlatform() && typeof TextToSpeech?.speak === 'function';
  } catch {
    return false;
  }
}

export function getOnDeviceVoiceTone(voiceName?: GeminiVoiceName) {
  if (voiceName && ON_DEVICE_VOICE_TONES[voiceName]) {
    return ON_DEVICE_VOICE_TONES[voiceName];
  }
  return ON_DEVICE_VOICE_TONES.Kore;
}

const LANG_TO_LOCALE_MAP: Record<string, string> = {
  vi: 'vi-VN',
  en: 'en-US',
  zh: 'zh-CN',
  ja: 'ja-JP',
  ko: 'ko-KR',
  fr: 'fr-FR',
  de: 'de-DE',
  es: 'es-ES',
  th: 'th-TH',
  ru: 'ru-RU',
};

export function mapLangCodeToSpeechLocale(langCode?: string): string {
  const clean = (langCode || 'vi').trim().toLowerCase();
  if (!clean) return 'vi-VN';
  if (clean.includes('-')) return langCode!.trim();
  return LANG_TO_LOCALE_MAP[clean] || `${clean}-${clean.toUpperCase()}`;
}

export function listDeviceSpeechVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  try {
    return window.speechSynthesis.getVoices() || [];
  } catch {
    return [];
  }
}

export async function waitForSpeechVoices(timeoutMs = 250): Promise<SpeechSynthesisVoice[]> {
  const immediate = listDeviceSpeechVoices();
  if (immediate.length > 0) return immediate;
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];

  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      synth.removeEventListener?.('voiceschanged', onVoicesChanged);
      window.clearTimeout(timer);
      resolve(listDeviceSpeechVoices());
    };
    const onVoicesChanged = () => finish();
    synth.addEventListener?.('voiceschanged', onVoicesChanged);
    const timer = window.setTimeout(finish, timeoutMs);
  });
}

export function checkSpeechAudioAvailable(): {
  nativeAvailable: boolean;
  webSpeechAvailable: boolean;
  voiceCount: number;
} {
  const nativeAvailable = isCapacitorNativeTtsReady();
  const webSpeechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const voiceCount = listDeviceSpeechVoices().length;
  return { nativeAvailable, webSpeechAvailable, voiceCount };
}

const MALE_VOICE_HINT_RE =
  /nam|male|man|minh|hung|david|daniel|mark|vi-vn-x-vid|vi-vn-x-vic|vnm|-(c|d)-local|-(c|d)-network/i;
const FEMALE_VOICE_HINT_RE =
  /nu|nữ|female|woman|linh|lan|mai|hoai|samantha|victoria|vi-vn-x-vif|vi-vn-x-vie|vi-vn-x-gft|vnf|-(a|b|e|f)-local|-(a|b|e|f)-network/i;

function matchesLangLocale(voiceLang: string | undefined, targetLang: string): boolean {
  const v = (voiceLang || '').toLowerCase().replace(/_/g, '-');
  const t = (targetLang || 'vi-VN').toLowerCase().replace(/_/g, '-');
  const prefix = t.split('-')[0];
  if (!v) return false;
  if (v === t || v.startsWith(`${prefix}-`) || v === prefix) return true;
  if (prefix === 'vi' && (v.startsWith('vie') || v.includes('viet'))) return true;
  return false;
}

function isLocalOfflineVoice(v: { voiceURI?: string; name?: string; localService?: boolean }): boolean {
  const tag = `${v.name || ''} ${v.voiceURI || ''}`.toLowerCase();
  if (tag.includes('-network') || tag.includes('network')) return false;
  if (tag.includes('-local') || v.localService === true) return true;
  return true;
}

export function pickBestDeviceVoice(
  voices: SpeechSynthesisVoice[],
  lang: string,
  voiceURI?: string,
  preferGender?: 'female' | 'male' | 'neutral',
  voiceSlotIndex = 0
): SpeechSynthesisVoice | undefined {
  if (voices.length === 0) return undefined;
  if (voiceURI) {
    const exact = voices.find((v) => v.voiceURI === voiceURI || v.name === voiceURI);
    if (exact) return exact;
  }

  const langMatches = voices.filter((v) => matchesLangLocale(v.lang, lang));
  const basePool = langMatches.length > 0 ? langMatches : voices;
  const localPool = basePool.filter((v) => isLocalOfflineVoice(v));
  const pool = localPool.length > 0 ? localPool : basePool;

  if (preferGender === 'male') {
    const males = pool.filter((v) => MALE_VOICE_HINT_RE.test(`${v.name} ${v.voiceURI}`));
    if (males.length > 0) return males[Math.abs(voiceSlotIndex) % males.length];
  } else if (preferGender === 'female') {
    const females = pool.filter((v) => FEMALE_VOICE_HINT_RE.test(`${v.name} ${v.voiceURI}`));
    if (females.length > 0) return females[Math.abs(voiceSlotIndex) % females.length];
  }

  return pool[Math.abs(voiceSlotIndex) % pool.length];
}

export function pickBestNativeVoiceIndex(
  voices: Array<{ voiceURI?: string; name?: string; lang?: string; localService?: boolean }>,
  lang: string,
  voiceURI?: string,
  preferGender?: 'female' | 'male' | 'neutral',
  voiceSlotIndex = 0
): number {
  if (!voices || voices.length === 0) return -1;

  if (voiceURI) {
    const exactIdx = voices.findIndex(
      (v) => v.voiceURI === voiceURI || v.name === voiceURI
    );
    if (exactIdx >= 0) return exactIdx;
  }

  const indexedLangMatches = voices
    .map((v, index) => ({ v, index }))
    .filter(({ v }) => matchesLangLocale(v.lang, lang));

  if (indexedLangMatches.length === 0) return -1;

  // Strongly prioritize -local offline Android TTS voices because -network voices
  // silently fall back to the single default Android voice when network synthesis lags/fails.
  const localMatches = indexedLangMatches.filter(({ v }) => isLocalOfflineVoice(v));
  const pool = localMatches.length > 0 ? localMatches : indexedLangMatches;

  if (preferGender === 'male') {
    const males = pool.filter(({ v }) =>
      MALE_VOICE_HINT_RE.test(`${v.name || ''} ${v.voiceURI || ''}`)
    );
    if (males.length > 0) {
      return males[Math.abs(voiceSlotIndex) % males.length].index;
    }
  } else if (preferGender === 'female') {
    const females = pool.filter(({ v }) =>
      FEMALE_VOICE_HINT_RE.test(`${v.name || ''} ${v.voiceURI || ''}`)
    );
    if (females.length > 0) {
      return females[Math.abs(voiceSlotIndex) % females.length].index;
    }
  }

  return pool[Math.abs(voiceSlotIndex) % pool.length].index;
}

async function getNativeSupportedVoices(): Promise<
  Array<{ voiceURI?: string; name?: string; lang?: string; localService?: boolean }>
> {
  if (cachedNativeVoices && cachedNativeVoices.length > 0) return cachedNativeVoices;
  if (!isCapacitorNativeTtsReady()) return [];
  try {
    const res = await TextToSpeech.getSupportedVoices();
    const list = Array.isArray(res?.voices) ? res.voices : [];
    // Never cache an empty list — Android TTS service may still be initializing on first call
    if (list.length > 0) {
      cachedNativeVoices = list;
    }
    return list;
  } catch {
    return [];
  }
}

/**
 * Splits long text into crisp sentence-bounded chunks so native Android TextToSpeech
 * and Web Speech stay locked in sync (zero highlight drift) and switch voices responsively.
 */
export function splitSpeechIntoChunks(text: string, maxLen = 115): string[] {
  const normalized = (text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  if (normalized.length <= maxLen) return [normalized];

  const rawSentences = normalized.split(/(?<=[.!?;:…])\s+/);
  const chunks: string[] = [];
  let current = '';

  for (const sentence of rawSentences) {
    if (!sentence.trim()) continue;
    if (sentence.length > maxLen) {
      if (current) {
        chunks.push(current.trim());
        current = '';
      }
      // Also split overly long sentences on commas if possible
      const clauses = sentence.split(/(?<=,)\s+/);
      let buf = '';
      for (const clause of clauses) {
        if (clause.length > maxLen) {
          if (buf.trim()) {
            chunks.push(buf.trim());
            buf = '';
          }
          const words = clause.split(/\s+/);
          for (const word of words) {
            if ((buf + ' ' + word).trim().length > maxLen && buf) {
              chunks.push(buf.trim());
              buf = word;
            } else {
              buf = buf ? `${buf} ${word}` : word;
            }
          }
        } else if ((buf + ' ' + clause).trim().length > maxLen && buf) {
          chunks.push(buf.trim());
          buf = clause;
        } else {
          buf = buf ? `${buf} ${clause}` : clause;
        }
      }
      if (buf.trim()) chunks.push(buf.trim());
      continue;
    }

    if ((current + ' ' + sentence).trim().length > maxLen && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export function stopOnDeviceSpeech(): void {
  activeSpeechCancelled = true;
  speechGeneration += 1;
  if (activeWebSpeechCancelResolver) {
    const cancelFn = activeWebSpeechCancelResolver;
    activeWebSpeechCancelResolver = null;
    cancelFn();
  }
  if (isCapacitorNativeTtsReady()) {
    TextToSpeech.stop().catch(() => {});
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore webview speechSynthesis errors
    }
  }
}

export interface SpeakOnDeviceOptions {
  text: string;
  lang?: string;
  pitch?: number;
  rate?: number;
  voiceURI?: string;
  preferGender?: 'female' | 'male' | 'neutral';
  voiceSlotIndex?: number;
  onStart?: () => void;
  onBoundary?: (charIndex: number) => void;
}

/**
 * Speaks text cleanly on the user's phone / browser using native Capacitor Android/iOS TTS
 * (directly bridging android.speech.tts.TextToSpeech) or hardened Web Speech API with
 * adaptive sentence-anchored timing & original-text index remapping so highlight never drifts.
 */
export async function speakOnDevice(options: SpeakOnDeviceOptions): Promise<boolean> {
  const lang = options.lang || 'vi-VN';
  const originalText = options.text || '';
  const cleanText = normalizeVietnameseForSpeech(originalText, lang);
  if (!cleanText) return false;

  if (activeWebSpeechCancelResolver) {
    const cancelFn = activeWebSpeechCancelResolver;
    activeWebSpeechCancelResolver = null;
    cancelFn();
  }
  const gen = ++speechGeneration;
  activeSpeechCancelled = false;
  const isStale = () => activeSpeechCancelled || gen !== speechGeneration;
  const pitch = Math.min(1.75, Math.max(0.55, options.pitch ?? 1.0));
  const rate = Math.min(MAX_READING_SPEED, Math.max(MIN_READING_SPEED, options.rate ?? 1.0));
  const voiceSlotIndex = options.voiceSlotIndex ?? 0;
  // Short sentence-bounded chunks re-anchor highlight to 0ms drift on every sentence
  const chunks = splitSpeechIntoChunks(cleanText, 115);

  const totalCleanLen = Math.max(
    1,
    chunks.reduce((sum, c, idx) => sum + c.length + (idx > 0 ? 1 : 0), 0)
  );
  const originalLen = Math.max(1, originalText.length);
  const emitMappedBoundary = (cleanCharIndex: number) => {
    if (isStale()) return;
    const ratio = Math.max(0, Math.min(1, cleanCharIndex / totalCleanLen));
    const mapped = Math.min(originalLen, Math.floor(ratio * originalLen));
    options.onBoundary?.(mapped);
  };

  // 1. Native Capacitor Android/iOS TextToSpeech bridge (always prioritized inside APK)
  if (isCapacitorNativeTtsReady()) {
    try {
      await TextToSpeech.stop().catch(() => {});
      if (isStale()) return false;
      const nativeVoices = await getNativeSupportedVoices();
      if (isStale()) return false;
      const nativeVoiceIdx = pickBestNativeVoiceIndex(
        nativeVoices,
        lang,
        options.voiceURI,
        options.preferGender,
        voiceSlotIndex
      );

      let charCursor = 0;
      options.onStart?.();
      for (const chunk of chunks) {
        if (isStale()) return false;
        const chunkBase = charCursor;
        emitMappedBoundary(chunkBase);

        // Compensate for ~200ms Android TTS audio-onset latency + adaptive speaking speed
        const onsetDelayMs = 200;
        const expectedDurationMs = Math.max(
          450,
          (chunk.length / Math.max(6, observedBaseCharsPerSec * rate)) * 1000
        );
        const startedAt = Date.now();
        const cadenceTimer = window.setInterval(() => {
          if (activeSpeechCancelled) return;
          const elapsed = Math.max(0, Date.now() - startedAt - onsetDelayMs);
          const estRatio = Math.min(0.96, elapsed / expectedDurationMs);
          const localOffset = mapTimeRatioToWeightedCharIndex(chunk, estRatio);
          emitMappedBoundary(chunkBase + localOffset);
        }, 65);

        try {
          await TextToSpeech.speak({
            text: chunk,
            lang,
            rate,
            pitch,
            volume: 1.0,
            category: 'playback',
            ...(nativeVoiceIdx >= 0 && nativeVoices.length > 1 ? { voice: nativeVoiceIdx } : {}),
          });
        } finally {
          window.clearInterval(cadenceTimer);
        }

        // Learn actual speaking speed of this Android phone's TTS voice for zero drift
        const actualMs = Date.now() - startedAt - onsetDelayMs;
        if (!activeSpeechCancelled && chunk.length >= 18 && actualMs > 450 && actualMs < 20000) {
          const measuredBaseCps = (chunk.length / (actualMs / 1000)) / Math.max(0.5, rate);
          if (measuredBaseCps >= 6 && measuredBaseCps <= 26) {
            observedBaseCharsPerSec = observedBaseCharsPerSec * 0.65 + measuredBaseCps * 0.35;
          }
        }

        charCursor += chunk.length + 1;
      }
      return !activeSpeechCancelled;
    } catch {
      // Fall through to Web Speech API if native TTS plugin is unavailable
    }
  }

  // 2. Web Speech API (Chrome / Edge / Safari / Android System WebView)
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return false;
  }

  const voices = await waitForSpeechVoices(250);
  if (isStale()) return false;

  let charCursor = 0;
  let anyStarted = false;

  for (let i = 0; i < chunks.length; i++) {
    if (isStale()) return false;
    const chunk = chunks[i];
    const chunkBaseCursor = charCursor;

    const ok = await new Promise<boolean>((resolve) => {
      let settled = false;
      let started = false;
      let lastNativeBoundaryAt = 0;
      let cadenceTimer: number | null = null;
      let chunkStartedAt = 0;

      const done = (result: boolean) => {
        if (settled) return;
        settled = true;
        if (activeWebSpeechCancelResolver === forceCancel) {
          activeWebSpeechCancelResolver = null;
        }
        if (cadenceTimer !== null) {
          window.clearInterval(cadenceTimer);
          cadenceTimer = null;
        }
        window.clearTimeout(safetyTimer);
        window.clearTimeout(noStartTimer);
        if (result && chunkStartedAt > 0 && chunk.length >= 18) {
          const actualMs = Date.now() - chunkStartedAt;
          if (actualMs > 450 && actualMs < 20000) {
            const measuredBaseCps = (chunk.length / (actualMs / 1000)) / Math.max(0.5, rate);
            if (measuredBaseCps >= 6 && measuredBaseCps <= 26) {
              observedBaseCharsPerSec = observedBaseCharsPerSec * 0.65 + measuredBaseCps * 0.35;
            }
          }
        }
        resolve(result);
      };

      const forceCancel = () => done(false);
      activeWebSpeechCancelResolver = forceCancel;

      const estimatedMs = Math.max(3500, (chunk.length / (8 * rate)) * 1000 + 2500);
      const safetyTimer = window.setTimeout(() => done(started), estimatedMs);
      // Fail fast if browser/WebView never starts speechSynthesis (avoids fake silent ticking)
      const noStartTimer = window.setTimeout(() => {
        if (!started) {
          done(false);
        }
      }, 1200);

      try {
        const synth = window.speechSynthesis;
        if (i === 0 && (synth.speaking || synth.pending)) {
          synth.cancel();
        }
        if (synth.paused) {
          synth.resume();
        }

        const utter = new SpeechSynthesisUtterance(chunk);
        const chosen = pickBestDeviceVoice(
          voices,
          lang,
          options.voiceURI,
          options.preferGender,
          voiceSlotIndex
        );
        if (chosen) {
          utter.voice = chosen;
          utter.lang = chosen.lang || lang;
        } else {
          utter.lang = lang;
        }
        utter.pitch = pitch;
        utter.rate = rate;
        utter.volume = 1.0;

        utter.onstart = () => {
          if (isStale()) {
            done(false);
            return;
          }
          started = true;
          chunkStartedAt = Date.now();
          if (!anyStarted) {
            anyStarted = true;
            options.onStart?.();
          }
          emitMappedBoundary(chunkBaseCursor);
          const expectedDurationMs = Math.max(
            450,
            (chunk.length / Math.max(6, observedBaseCharsPerSec * rate)) * 1000
          );
          cadenceTimer = window.setInterval(() => {
            if (!started || settled || isStale()) return;
            // Defer to native browser onboundary whenever it fires actively
            if (Date.now() - lastNativeBoundaryAt < 220) return;
            const elapsed = Math.max(0, Date.now() - chunkStartedAt - 100);
            const estRatio = Math.min(0.96, elapsed / expectedDurationMs);
            const localOffset = mapTimeRatioToWeightedCharIndex(chunk, estRatio);
            emitMappedBoundary(chunkBaseCursor + localOffset);
          }, 65);
        };
        utter.onboundary = (ev) => {
          if (!isStale() && typeof ev.charIndex === 'number') {
            lastNativeBoundaryAt = Date.now();
            emitMappedBoundary(chunkBaseCursor + ev.charIndex);
          }
        };
        utter.onend = () => done(true);
        utter.onerror = () => done(false);

        synth.speak(utter);
      } catch {
        done(false);
      }
    });

    if (!ok || isStale()) {
      return anyStarted && !isStale();
    }
    charCursor += chunk.length + 1;
  }

  return anyStarted && !isStale();
}
