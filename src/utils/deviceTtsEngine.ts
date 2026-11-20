import { Capacitor } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import type { GeminiVoiceName } from '../types/book';
import { MAX_READING_SPEED, MIN_READING_SPEED } from './audioFilterEngine';

/**
 * Distinct on-device acoustic profiles for each voice preset so every voice
 * sounds clearly differentiated using the phone's built-in TTS engine (100% offline).
 */
export const ON_DEVICE_VOICE_TONES: Record<
  GeminiVoiceName,
  { pitch: number; rate: number; preferGender: 'female' | 'male' | 'neutral' }
> = {
  Kore: { pitch: 1.02, rate: 1.0, preferGender: 'female' },
  Charon: { pitch: 0.82, rate: 0.94, preferGender: 'male' },
  Zephyr: { pitch: 1.12, rate: 1.0, preferGender: 'female' },
  Fenrir: { pitch: 0.76, rate: 0.96, preferGender: 'male' },
  Puck: { pitch: 1.06, rate: 1.06, preferGender: 'male' },
  Aoede: { pitch: 1.18, rate: 1.03, preferGender: 'female' },
};

let sharedAudioCtx: AudioContext | null = null;
let keepaliveGain: GainNode | null = null;
let keepaliveOsc: OscillatorNode | null = null;
let activeSpeechCancelled = false;

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

export async function waitForSpeechVoices(timeoutMs = 700): Promise<SpeechSynthesisVoice[]> {
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

export function pickBestDeviceVoice(
  voices: SpeechSynthesisVoice[],
  lang: string,
  voiceURI?: string,
  preferGender?: 'female' | 'male' | 'neutral'
): SpeechSynthesisVoice | undefined {
  if (voices.length === 0) return undefined;
  if (voiceURI) {
    const exact = voices.find((v) => v.voiceURI === voiceURI);
    if (exact) return exact;
  }

  const langPrefix = (lang || 'vi-VN').split('-')[0].toLowerCase();
  const langMatches = voices.filter((v) =>
    v.lang.toLowerCase().startsWith(langPrefix)
  );
  const pool = langMatches.length > 0 ? langMatches : voices;

  if (preferGender === 'male') {
    const male = pool.find((v) =>
      /nam|male|man|minh|hung|an|david|daniel|mark/i.test(v.name)
    );
    if (male) return male;
  } else if (preferGender === 'female') {
    const female = pool.find((v) =>
      /nu|nữ|female|woman|linh|lan|mai|hoai|samantha|victoria|google tiếng việt/i.test(
        v.name
      )
    );
    if (female) return female;
  }

  return pool[0];
}

/**
 * Splits long text into natural sentence-bounded chunks so native Android TextToSpeech
 * and Web Speech never drop long chapters and support clean word/character progress.
 */
export function splitSpeechIntoChunks(text: string, maxLen = 190): string[] {
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
      const words = sentence.split(/\s+/);
      let buf = '';
      for (const word of words) {
        if ((buf + ' ' + word).trim().length > maxLen && buf) {
          chunks.push(buf.trim());
          buf = word;
        } else {
          buf = buf ? `${buf} ${word}` : word;
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
  onStart?: () => void;
  onBoundary?: (charIndex: number) => void;
}

/**
 * Speaks text cleanly on the user's phone / browser using native Capacitor Android/iOS TTS
 * (directly bridging android.speech.tts.TextToSpeech) or hardened Web Speech API with
 * voice readiness wait & sentence chunking. Returns false if no audio output started.
 */
export async function speakOnDevice(options: SpeakOnDeviceOptions): Promise<boolean> {
  const cleanText = (options.text || '').trim();
  if (!cleanText) return false;

  activeSpeechCancelled = false;
  const lang = options.lang || 'vi-VN';
  const pitch = Math.min(1.8, Math.max(0.55, options.pitch ?? 1.0));
  const rate = Math.min(MAX_READING_SPEED, Math.max(MIN_READING_SPEED, options.rate ?? 1.0));
  const chunks = splitSpeechIntoChunks(cleanText, 210);

  // 1. Native Capacitor Android/iOS TextToSpeech bridge (always prioritized inside APK)
  if (isCapacitorNativeTtsReady()) {
    try {
      await TextToSpeech.stop().catch(() => {});
      let charCursor = 0;
      options.onStart?.();
      for (const chunk of chunks) {
        if (activeSpeechCancelled) return false;
        const chunkBase = charCursor;
        options.onBoundary?.(chunkBase);
        const charsPerMs = (11.5 * rate) / 1000;
        const startedAt = Date.now();
        const cadenceTimer = window.setInterval(() => {
          if (activeSpeechCancelled) return;
          const elapsed = Date.now() - startedAt;
          const approxOffset = Math.min(
            Math.max(1, chunk.length - 2),
            Math.floor(elapsed * charsPerMs)
          );
          options.onBoundary?.(chunkBase + approxOffset);
        }, 75);
        try {
          await TextToSpeech.speak({
            text: chunk,
            lang,
            rate,
            pitch,
            volume: 1.0,
            category: 'playback',
          });
        } finally {
          window.clearInterval(cadenceTimer);
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

  const voices = await waitForSpeechVoices(700);
  if (activeSpeechCancelled) return false;

  let charCursor = 0;
  let anyStarted = false;

  for (let i = 0; i < chunks.length; i++) {
    if (activeSpeechCancelled) return false;
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
        if (cadenceTimer !== null) {
          window.clearInterval(cadenceTimer);
          cadenceTimer = null;
        }
        window.clearTimeout(safetyTimer);
        window.clearTimeout(noStartTimer);
        resolve(result);
      };

      const estimatedMs = Math.max(3500, (chunk.length / (9 * rate)) * 1000 + 2500);
      const safetyTimer = window.setTimeout(() => done(started), estimatedMs);
      // Fail fast if browser/WebView never starts speechSynthesis (avoids fake silent ticking)
      const noStartTimer = window.setTimeout(() => {
        if (!started) {
          done(false);
        }
      }, 2200);

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
          options.preferGender
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
          started = true;
          chunkStartedAt = Date.now();
          if (!anyStarted) {
            anyStarted = true;
            options.onStart?.();
          }
          options.onBoundary?.(chunkBaseCursor);
          const charsPerMs = (11.5 * rate) / 1000;
          cadenceTimer = window.setInterval(() => {
            if (!started || settled || activeSpeechCancelled) return;
            // Defer to native browser onboundary whenever it fires actively
            if (Date.now() - lastNativeBoundaryAt < 180) return;
            const elapsed = Date.now() - chunkStartedAt;
            const approxOffset = Math.min(
              Math.max(1, chunk.length - 2),
              Math.floor(elapsed * charsPerMs)
            );
            options.onBoundary?.(chunkBaseCursor + approxOffset);
          }, 75);
        };
        utter.onboundary = (ev) => {
          if (typeof ev.charIndex === 'number') {
            lastNativeBoundaryAt = Date.now();
            options.onBoundary?.(chunkBaseCursor + ev.charIndex);
          }
        };
        utter.onend = () => done(true);
        utter.onerror = () => done(false);

        synth.speak(utter);
      } catch {
        done(false);
      }
    });

    if (!ok) {
      return anyStarted && !activeSpeechCancelled;
    }
    charCursor += chunk.length + 1;
  }

  return anyStarted && !activeSpeechCancelled;
}
