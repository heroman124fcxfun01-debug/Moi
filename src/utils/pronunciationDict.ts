export interface PronunciationEntry {
  id: string;
  wrongWord: string;
  correctReading: string;
  caseSensitive?: boolean;
}

const STORAGE_KEY = 'bookhad_pronunciation_dict_v1';

export function loadPronunciationDict(): PronunciationEntry[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.wrongWord === 'string' && typeof item.correctReading === 'string')
      .map((item) => ({
        id: String(item.id || `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
        wrongWord: item.wrongWord.trim(),
        correctReading: item.correctReading.trim(),
        caseSensitive: Boolean(item.caseSensitive),
      }))
      .filter((item) => item.wrongWord.length > 0 && item.correctReading.length > 0);
  } catch {
    return [];
  }
}

export function savePronunciationDict(entries: PronunciationEntry[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const cleaned = entries
      .map((e) => ({
        id: e.id || `pd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        wrongWord: e.wrongWord.trim(),
        correctReading: e.correctReading.trim(),
        caseSensitive: Boolean(e.caseSensitive),
      }))
      .filter((e) => e.wrongWord.length > 0 && e.correctReading.length > 0);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
  } catch {
    // ignore quota errors
  }
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Applies user's personalized pronunciation dictionary before TTS synthesis.
 * Longest terms are matched first to avoid partial overlap.
 */
export function applyPronunciationDict(
  text: string,
  entries?: PronunciationEntry[]
): string {
  if (!text) return '';
  const list = entries ?? loadPronunciationDict();
  if (!list || list.length === 0) return text;

  const sorted = [...list]
    .filter((e) => e.wrongWord.trim().length > 0 && e.correctReading.trim().length > 0)
    .sort((a, b) => b.wrongWord.length - a.wrongWord.length);

  let output = text;
  for (const entry of sorted) {
    const escaped = escapeRegExp(entry.wrongWord.trim());
    const flags = entry.caseSensitive ? 'g' : 'gi';
    // Match whole word/phrase using Unicode-friendly boundaries so Vietnamese diacritics match accurately
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, `${flags}u`);
    output = output.replace(pattern, entry.correctReading.trim());
  }
  return output;
}
