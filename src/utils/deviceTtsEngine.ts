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

interface CapacitorTextToSpeechPlugin {
  speak?: (options: {
    text: string;
    lang?: string;
    rate?: number;
    pitch?: number;
    volume?: number;
    category?: string;
  }) => Promise<void>;
  stop?: () => Promise<void>;
}

function getCapacitorTtsPlugin(): CapacitorTextToSpeechPlugin | null {
  if (typeof window === 'undefined') return null;
  const cap = (
    window as Window & {
      Capacitor?: { Plugins?: { TextToSpeech?: CapacitorTextToSpeechPlugin } };
    }
  ).Capacitor;
  const plugin = cap?.Plugins?.TextToSpeech;
  return plugin && typeof plugin.speak === 'function' ? plugin : null;
}

export function getOnDeviceVoiceTone(voiceName?: GeminiVoiceName) {
  if (voiceName && ON_DEVICE_VOICE_TONES[voiceName]) {
    return ON_DEVICE_VOICE_TONES[voiceName];
  }
  return ON_DEVICE_VOICE_TONES.Kore;
}

export function listDeviceSpeechVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  try {
    return window.speechSynthesis.getVoices() || [];
  } catch {
    return [];
  }
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

export function stopOnDeviceSpeech(): void {
  const capTts = getCapacitorTtsPlugin();
  if (capTts?.stop) {
    capTts.stop().catch(() => {});
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
 * Speaks text cleanly on the user's phone / browser using native Capacitor TTS (if present)
 * or hardened Web Speech API with reliable Vietnamese voice selection and timeout protection.
 */
export async function speakOnDevice(options: SpeakOnDeviceOptions): Promise<boolean> {
  const cleanText = (options.text || '').trim();
  if (!cleanText) return false;

  const lang = options.lang || 'vi-VN';
  const pitch = Math.min(1.8, Math.max(0.55, options.pitch ?? 1.0));
  const rate = Math.min(MAX_READING_SPEED, Math.max(MIN_READING_SPEED, options.rate ?? 1.0));

  // 1. Native Capacitor Android/iOS TextToSpeech plugin (if available in APK)
  const capTts = getCapacitorTtsPlugin();
  if (capTts?.speak) {
    try {
      await capTts.stop?.().catch(() => {});
      options.onStart?.();
      await capTts.speak({
        text: cleanText,
        lang,
        rate,
        pitch,
        volume: 1.0,
      });
      return true;
    } catch {
      // Fall through to Web Speech API
    }
  }

  // 2. Web Speech API (supported in Android Chrome / System WebView & desktop browsers)
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return false;
  }

  return new Promise<boolean>((resolve) => {
    let settled = false;
    let started = false;

    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(safetyTimer);
      resolve(ok);
    };

    const estimatedMs = Math.max(3500, (cleanText.length / (10 * rate)) * 1000 + 3000);
    const safetyTimer = window.setTimeout(() => done(started), estimatedMs);

    try {
      const synth = window.speechSynthesis;
      if (synth.speaking || synth.pending) {
        synth.cancel();
      }
      if (synth.paused) {
        synth.resume();
      }

      const utter = new SpeechSynthesisUtterance(cleanText);
      const voices = listDeviceSpeechVoices();
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
        options.onStart?.();
      };
      utter.onboundary = (ev) => {
        if (typeof ev.charIndex === 'number') {
          options.onBoundary?.(ev.charIndex);
        }
      };
      utter.onend = () => done(true);
      utter.onerror = () => done(false);

      synth.speak(utter);
    } catch {
      done(false);
    }
  });
}
