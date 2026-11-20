import type {
  CharacterVoiceAssignment,
  CustomFontAsset,
  DefaultVoiceSelection,
  ExternalVoiceAsset,
  GeminiVoiceName,
} from '../types/book';
import {
  CLASSIC_BUILTIN_FONTS,
  EREADER_COMMUNITY_FONTS,
} from './fileHelpers';
import { DEFAULT_VOICE_TONE } from './audioFilterEngine';

export interface UnifiedFontCatalogItem {
  id: string;
  name: string;
  cssValue: string;
  origin: string;
  description: string;
  sample: string;
  kind: 'community' | 'device' | 'imported';
  customFontId?: string;
}

export const DEFAULT_GLOBAL_VOICE: DefaultVoiceSelection = {
  source: 'gemini',
  id: 'gemini:Kore',
  label: 'Nữ ấm (Gốc)',
  geminiVoice: 'Kore',
};

export const HIDDEN_SYSTEM_VOICES_STORAGE_KEY = 'bookhad_hidden_system_voices_v1';
export const HIDDEN_SYSTEM_VOICES_EVENT = 'bookhad-hidden-voices-changed';

/**
 * Only the very first built-in system voice ("gemini:Kore") is protected from deletion.
 * Every other built-in or device voice can be freely deleted by the user.
 */
export function isProtectedPrimaryVoice(voiceKey: string): boolean {
  return voiceKey === 'gemini:Kore';
}

export function loadHiddenSystemVoiceKeys(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(HIDDEN_SYSTEM_VOICES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((k): k is string => typeof k === 'string' && !isProtectedPrimaryVoice(k));
  } catch {
    return [];
  }
}

export function saveHiddenSystemVoiceKeys(keys: string[]): string[] {
  const clean = Array.from(
    new Set(keys.filter((k) => typeof k === 'string' && !isProtectedPrimaryVoice(k)))
  );
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(HIDDEN_SYSTEM_VOICES_STORAGE_KEY, JSON.stringify(clean));
      window.dispatchEvent(new CustomEvent(HIDDEN_SYSTEM_VOICES_EVENT, { detail: clean }));
    } catch {
      // Ignore storage quota errors
    }
  }
  return clean;
}

export function hideSystemVoiceKey(voiceKey: string): string[] {
  if (isProtectedPrimaryVoice(voiceKey)) return loadHiddenSystemVoiceKeys();
  const current = loadHiddenSystemVoiceKeys();
  if (current.includes(voiceKey)) return current;
  return saveHiddenSystemVoiceKeys([...current, voiceKey]);
}

const VALID_GEMINI_VOICES: GeminiVoiceName[] = [
  'Kore',
  'Charon',
  'Zephyr',
  'Fenrir',
  'Puck',
  'Aoede',
];

/**
 * Combines Community E-Reader fonts FIRST, followed by built-in/device native fonts,
 * and seamlessly merges any user-imported custom fonts into ONE unified font catalog.
 */
export function buildUnifiedFontCatalog(
  customFonts: CustomFontAsset[]
): UnifiedFontCatalogItem[] {
  const communityItems: UnifiedFontCatalogItem[] = EREADER_COMMUNITY_FONTS.map((f) => ({
    id: f.id,
    name: f.name,
    cssValue: f.value,
    origin: f.origin,
    description: f.description,
    sample: f.sample,
    kind: 'community',
  }));

  const deviceItems: UnifiedFontCatalogItem[] = CLASSIC_BUILTIN_FONTS.map((f) => ({
    id: f.id,
    name: f.name,
    cssValue: f.value,
    origin: f.origin,
    description: f.description,
    sample: f.sample,
    kind: 'device',
  }));

  const importedItems: UnifiedFontCatalogItem[] = customFonts.map((cf) => ({
    id: `imported-${cf.id}`,
    name: cf.name,
    cssValue: `"${cf.fontFamily}", serif`,
    origin: `File import · .${cf.format.toUpperCase()}`,
    description: `Phông chữ cá nhân nạp từ tệp "${cf.fileName}".`,
    sample: 'Trăm năm trong cõi người ta, chữ tài chữ mệnh khéo là ghét nhau.',
    kind: 'imported',
    customFontId: cf.id,
  }));

  return [...communityItems, ...deviceItems, ...importedItems];
}

/**
 * Resolves the global default narrator assignment used across all books
 * unless the user explicitly scans & overrides characters inside a specific book.
 */
export function resolveNarratorAssignmentFromDefault(
  defaultVoice: DefaultVoiceSelection | undefined,
  externalVoices: ExternalVoiceAsset[]
): CharacterVoiceAssignment {
  const selection = defaultVoice || DEFAULT_GLOBAL_VOICE;

  if (selection.source === 'external' && selection.externalVoiceId) {
    const ext = externalVoices.find((v) => v.id === selection.externalVoiceId);
    if (ext) {
      const baseVoice =
        ext.analyzedProfile?.recommendedBaseVoice &&
        VALID_GEMINI_VOICES.includes(ext.analyzedProfile.recommendedBaseVoice)
          ? ext.analyzedProfile.recommendedBaseVoice
          : 'Kore';
      const tone = ext.toneSettings || DEFAULT_VOICE_TONE;
      return {
        characterId: 'narrator',
        source: 'external',
        geminiVoice: baseVoice,
        externalVoiceId: ext.id,
        stylePrompt:
          ext.analyzedProfile?.stylePrompt ||
          tone.styleDirection ||
          'Giọng đọc mặc định từ Studio',
        browserPitch: tone.pitch,
        browserRate: tone.rate,
        toneSettings: { ...tone },
      };
    }
  }

  if (selection.source === 'browser') {
    return {
      characterId: 'narrator',
      source: 'browser',
      geminiVoice: 'Kore',
      browserVoiceURI: selection.browserVoiceURI,
      stylePrompt: 'Giọng đọc gốc trên thiết bị',
      browserPitch: 1.0,
      browserRate: 1.0,
      toneSettings: { ...DEFAULT_VOICE_TONE },
    };
  }

  const geminiVoice: GeminiVoiceName =
    selection.geminiVoice && VALID_GEMINI_VOICES.includes(selection.geminiVoice)
      ? selection.geminiVoice
      : 'Kore';

  return {
    characterId: 'narrator',
    source: 'gemini',
    geminiVoice,
    stylePrompt: 'Giọng mặc định tự nhiên, rõ ràng, truyền cảm',
    browserPitch: 1.0,
    browserRate: 1.0,
    toneSettings: { ...DEFAULT_VOICE_TONE },
  };
}
