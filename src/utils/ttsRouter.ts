import type {
  BookReadingStyle,
  CharacterVoiceAssignment,
  ExternalVoiceAsset,
  GeminiVoiceName,
  SpeakerEmbeddingVector,
  VoiceToneSettings,
} from '../types/book';
import { resolveClonedVoiceSynthesis } from './vocalClonerDsp';

export type ClonedVoiceSynthesisParams = ReturnType<typeof resolveClonedVoiceSynthesis>;

export type SpeechEngineKind = 'SYSTEM_TTS' | 'ON_DEVICE_CLONED';

export interface SpeechRouteResolution {
  engine: SpeechEngineKind;
  voiceId: string;
  externalVoice?: ExternalVoiceAsset;
  embedding?: SpeakerEmbeddingVector;
  clonedSynthesis?: ClonedVoiceSynthesisParams;
  /** Non-empty when a CUSTOM_CLONED voice is missing its extracted embedding — NEVER silently fall back to System TTS */
  missingEmbeddingError?: string;
}

export interface ReadingCursorPosition {
  chapterIndex: number;
  batchIndex: number;
  paragraphIndex: number;
  charOffsetInParagraph: number;
  charOffsetInBatch: number;
}

/**
 * Strict TTS Router:
 * - Built-in / OS voices -> SYSTEM_TTS
 * - Imported custom cloned voices -> ON_DEVICE_CLONED (NEVER silently falls back to generic system voice!)
 */
export function resolveSpeechEngineRoute(
  assignment: CharacterVoiceAssignment,
  externalVoices: ExternalVoiceAsset[],
  readingStyle: BookReadingStyle = 'novel'
): SpeechRouteResolution {
  if (assignment.source === 'external' && assignment.externalVoiceId) {
    const ext = externalVoices.find((v) => v.id === assignment.externalVoiceId);
    if (!ext) {
      return {
        engine: 'ON_DEVICE_CLONED',
        voiceId: assignment.externalVoiceId,
        missingEmbeddingError:
          'Không tìm thấy hồ sơ giọng nhân bản đã lưu. Vui lòng import lại file giọng mẫu (5–8 giây).',
      };
    }
    const embedding = ext.speakerEmbedding;
    if (!embedding || !embedding.vectorId || !Array.isArray(embedding.envelope16)) {
      return {
        engine: 'ON_DEVICE_CLONED',
        voiceId: ext.id,
        externalVoice: ext,
        missingEmbeddingError: `Giọng "${ext.name}" chưa có Speaker Embedding. Hãy nạp lại file mẫu 5–8 giây trong mục Tạo giọng.`,
      };
    }

    const baseTone: VoiceToneSettings = {
      warmthDb: ext.toneSettings?.warmthDb ?? ext.analyzedProfile?.warmthDb ?? 0,
      clarityDb: ext.toneSettings?.clarityDb ?? ext.analyzedProfile?.clarityDb ?? 0,
      pitch: ext.toneSettings?.pitch ?? ext.analyzedProfile?.pitchHint ?? 1.0,
      rate: ext.toneSettings?.rate ?? ext.analyzedProfile?.rateHint ?? 1.0,
      styleDirection:
        ext.toneSettings?.styleDirection ||
        ext.analyzedProfile?.stylePrompt ||
        assignment.stylePrompt ||
        '',
    };

    const clonedSynthesis = resolveClonedVoiceSynthesis({
      name: ext.name || ext.fileName || 'Cloned Voice',
      embedding,
      tone: baseTone,
      readingStyle,
      instruction: baseTone.styleDirection,
    });

    return {
      engine: 'ON_DEVICE_CLONED',
      voiceId: ext.voiceId || ext.id,
      externalVoice: ext,
      embedding,
      clonedSynthesis,
    };
  }

  return {
    engine: 'SYSTEM_TTS',
    voiceId:
      assignment.source === 'browser' && assignment.browserVoiceURI
        ? `browser:${assignment.browserVoiceURI}`
        : `gemini:${assignment.geminiVoice || 'Kore'}`,
  };
}

/**
 * Preserves exact reading cursor position (D) when switching voices mid-batch:
 * Instead of restarting from index 0 (position A), slices remaining text starting
 * cleanly at the current word/clause boundary around `charOffsetInBatch`.
 */
export function sliceRemainingSpeechFromCursor(
  fullBatchText: string,
  charOffsetInBatch: number
): { remainingText: string; effectiveStartOffset: number } {
  const text = fullBatchText || '';
  if (!text.trim() || charOffsetInBatch <= 0) {
    return { remainingText: text, effectiveStartOffset: 0 };
  }
  const safeOffset = Math.min(text.length - 1, Math.max(0, Math.floor(charOffsetInBatch)));
  if (safeOffset >= text.length - 4) {
    return { remainingText: '', effectiveStartOffset: text.length };
  }

  // Snap backward slightly to the nearest word boundary so we never start mid-syllable
  let start = safeOffset;
  if (start > 0 && !/\s/.test(text[start]) && !/\s/.test(text[start - 1])) {
    while (start > 0 && !/\s/.test(text[start - 1])) {
      start -= 1;
    }
  }
  // Trim leading whitespace/punctuation
  while (start < text.length && /[\s,;:\-—–]/.test(text[start])) {
    start += 1;
  }

  const remainingText = text.slice(start).trim();
  return {
    remainingText,
    effectiveStartOffset: start,
  };
}

/**
 * Resolves a character's default voice assignment when Character Scan runs:
 * Any character without an explicit manual override MUST inherit the exact Narrator voice.
 */
export function resolveDefaultCharacterAssignment(
  characterId: string,
  narratorAssignment: CharacterVoiceAssignment,
  existingMap?: Record<string, CharacterVoiceAssignment>
): CharacterVoiceAssignment {
  const existing = existingMap?.[characterId];
  if (existing && existing.isCustomOverride) {
    return existing;
  }
  return {
    ...narratorAssignment,
    characterId,
    isCustomOverride: false,
  };
}

/**
 * Builds deterministic formant/tone-color EQ curve gains (Low / Mid / Presence)
 * directly from an extracted 16-bin SpeakerEmbeddingVector so on-device audio playback
 * mirrors the original speaker's vocal resonance.
 */
export function computeToneColorEqFromEmbedding(embedding: SpeakerEmbeddingVector): {
  lowShelfDb: number;
  midPeakFreqHz: number;
  midPeakDb: number;
  highShelfDb: number;
  pitchFactor: number;
  speakingRateFactor: number;
} {
  const env = embedding.envelope16 || [];
  const lowEnergy = env.slice(0, 4).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(4, env.length));
  const midEnergy = env.slice(4, 10).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(6, Math.max(0, env.length - 4)));
  const highEnergy = env.slice(10, 16).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(6, Math.max(0, env.length - 10)));

  const lowShelfDb = Math.round(Math.max(-5, Math.min(8, (lowEnergy - 0.35) * 14)));
  const midPeakDb = Math.round(Math.max(-4, Math.min(6, (midEnergy - 0.35) * 11)));
  const highShelfDb = Math.round(Math.max(-5, Math.min(7, (highEnergy - 0.25) * 12)));
  const midPeakFreqHz = Math.round(Math.max(700, Math.min(2600, embedding.spectralCentroidHz || 1350)));

  const f0 = embedding.f0Hz || 165;
  const pitchFactor = Number(Math.max(0.72, Math.min(1.38, f0 / 172)).toFixed(2));
  const speakingRateFactor = Number(
    Math.max(0.84, Math.min(1.18, embedding.cadenceFactor ?? 1.0)).toFixed(2)
  );

  return {
    lowShelfDb,
    midPeakFreqHz,
    midPeakDb,
    highShelfDb,
    pitchFactor,
    speakingRateFactor,
  };
}

/**
 * Helper to select best local base voice name matching an extracted embedding's gender & pitch.
 */
export function pickEmbeddingBaseVoice(embedding: SpeakerEmbeddingVector): GeminiVoiceName {
  if (embedding.estimatedGender === 'male') {
    if (embedding.f0Hz <= 118) return 'Fenrir';
    if (embedding.f0Hz <= 145) return 'Charon';
    return 'Puck';
  }
  if (embedding.f0Hz >= 225) return 'Aoede';
  if (embedding.spectralCentroidHz >= 1600) return 'Zephyr';
  return 'Kore';
}
