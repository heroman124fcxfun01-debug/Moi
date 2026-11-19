import { resolveApiUrl } from './apiClient';

export interface LanguagePackDefinition {
  code: string;
  label: string;
  nativeName: string;
  description: string;
  sizeLabel: string;
  version: string;
  styleDirective: string;
  glossary: Record<string, string>;
}

export interface InstalledLanguagePack {
  code: string;
  label: string;
  version: string;
  installedAt: number;
  sizeLabel: string;
  hasBrowserOnDeviceModel: boolean;
  styleDirective: string;
  glossary: Record<string, string>;
}

const STORAGE_KEY = 'laziread_installed_language_packs_v1';

export const LANGUAGE_PACK_CATALOG: LanguagePackDefinition[] = [
  {
    code: 'vi',
    label: 'Tiếng Việt',
    nativeName: 'Tiếng Việt (Chuẩn văn học & Hán-Việt)',
    description:
      'Gói từ điển văn học, xưng hô tiểu thuyết (ta/ngươi, chàng/nàng, anh/em), thuật ngữ Hán-Việt & dịch nhanh.',
    sizeLabel: '185 KB',
    version: '2.1.0',
    styleDirective:
      'Dịch sang tiếng Việt tự nhiên, mượt mà, giàu chất văn học; giữ nhất quán đại từ nhân xưng (ta/ngươi, anh/em, hắn/nàng), giữ đúng tên riêng và sắc thái cảm xúc thoại.',
    glossary: {
      chapter: 'Chương',
      prologue: 'Mở đầu',
      epilogue: 'Lời kết',
      master: 'Sư phụ',
      senior: 'Sư huynh',
      junior: 'Sư đệ',
      cultivation: 'Tu luyện',
      kingdom: 'Vương quốc',
    },
  },
  {
    code: 'en',
    label: 'English',
    nativeName: 'English (Literary & Idiomatic)',
    description:
      'Literary phrasing pack, dialogue punctuation normalization, and natural English novel prose rules.',
    sizeLabel: '160 KB',
    version: '2.1.0',
    styleDirective:
      'Translate into natural, fluent literary English with idiomatic dialogue, clean paragraph rhythm, and consistent character names.',
    glossary: {
      'Chương': 'Chapter',
      'Mở đầu': 'Prologue',
      'Lời kết': 'Epilogue',
      'Sư phụ': 'Master',
    },
  },
  {
    code: 'zh',
    label: '中文 (Tiếng Trung)',
    nativeName: '简体中文 (小说与文学词库)',
    description:
      'Gói ngôn ngữ Trung văn giản thể hỗ trợ đọc đối chiếu & dịch ngược truyện mạng, tiên hiệp, ngôn tình.',
    sizeLabel: '210 KB',
    version: '2.1.0',
    styleDirective:
      '流畅地翻译为自然地道的简体中文文学语言，保留人物对话语气与专有名词一致性。',
    glossary: {
      Chapter: '章',
      'Chương': '章',
      Prologue: '序章',
    },
  },
  {
    code: 'ja',
    label: '日本語 (Tiếng Nhật)',
    nativeName: '日本語 (ライトノベル・小説)',
    description:
      'Gói ngôn ngữ Nhật văn chuyên biệt cho Light Novel, kính ngữ (keigo) và sắc thái hội thoại.',
    sizeLabel: '195 KB',
    version: '2.1.0',
    styleDirective:
      '自然な日本語の小説文体で翻訳し、会話文の語尾や敬語・キャラクター口調を一貫して表現してください。',
    glossary: {
      Chapter: '章',
      'Chương': '章',
      Prologue: 'プロローグ',
    },
  },
  {
    code: 'ko',
    label: '한국어 (Tiếng Hàn)',
    nativeName: '한국어 (웹소설 문체팩)',
    description:
      'Gói ngôn ngữ Hàn văn cho Web Novel, giữ chuẩn kính ngữ và nhịp câu tự nhiên.',
    sizeLabel: '175 KB',
    version: '2.1.0',
    styleDirective:
      '자연스러운 한국어 소설 문체로 번역하고 인물의 말투, 존댓말/반말 및 고유명사를 일관되게 유지하세요.',
    glossary: {
      Chapter: '장',
      'Chương': '장',
      Prologue: '프롤로그',
    },
  },
  {
    code: 'fr',
    label: 'Français (Tiếng Pháp)',
    nativeName: 'Français (Édition Littéraire)',
    description:
      'Gói ngôn ngữ Pháp văn chuẩn ấn bản văn học, dấu ngoặc kép kiểu Pháp và nhịp văn mượt.',
    sizeLabel: '155 KB',
    version: '2.1.0',
    styleDirective:
      'Traduisez en français littéraire fluide et naturel, en respectant les dialogues, les temps narratifs et la cohérence des noms propres.',
    glossary: {
      Chapter: 'Chapitre',
      'Chương': 'Chapitre',
      Prologue: 'Prologue',
    },
  },
];

export function getLanguagePackDefinition(code: string): LanguagePackDefinition {
  return (
    LANGUAGE_PACK_CATALOG.find((p) => p.code === code) || LANGUAGE_PACK_CATALOG[0]
  );
}

interface ChromeTranslatorInstance {
  translate: (text: string) => Promise<string>;
  destroy?: () => void;
}

interface ChromeTranslatorConstructor {
  availability?: (opts: {
    sourceLanguage: string;
    targetLanguage: string;
  }) => Promise<string>;
  create: (opts: {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (m: EventTarget) => void;
  }) => Promise<ChromeTranslatorInstance>;
}

function getBrowserTranslatorApi(): ChromeTranslatorConstructor | null {
  if (typeof globalThis === 'undefined') return null;
  const g = globalThis as unknown as {
    Translator?: ChromeTranslatorConstructor;
  };
  return g.Translator && typeof g.Translator.create === 'function'
    ? g.Translator
    : null;
}

export function isOnDeviceTranslatorSupported(): boolean {
  return Boolean(getBrowserTranslatorApi());
}

/**
 * Loads installed language packs persisted in the app.
 */
export function loadInstalledLanguagePacks(): Record<string, InstalledLanguagePack> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, InstalledLanguagePack>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveInstalledLanguagePacks(packs: Record<string, InstalledLanguagePack>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(packs));
  } catch {
    // ignore quota errors
  }
}

export function removeInstalledLanguagePack(code: string): Record<string, InstalledLanguagePack> {
  const current = loadInstalledLanguagePacks();
  const next = { ...current };
  delete next[code];
  saveInstalledLanguagePacks(next);
  return next;
}

/**
 * Downloads a language pack into the app (fetches literary pack bundle from server
 * with offline fallback + warms up Chrome on-device Translator model if browser supports it).
 */
export async function downloadLanguagePackToApp(
  code: string,
  onProgress?: (pct: number, message: string) => void
): Promise<InstalledLanguagePack> {
  const def = getLanguagePackDefinition(code);
  onProgress?.(15, `Đang tải gói ngôn ngữ ${def.label} vào ứng dụng...`);

  let serverGlossary = def.glossary;
  let serverDirective = def.styleDirective;
  let serverVersion = def.version;

  try {
    const resp = await fetch(resolveApiUrl(`/api/language-packs/${encodeURIComponent(code)}`));
    if (resp.ok) {
      const data = (await resp.json()) as Partial<LanguagePackDefinition>;
      if (data.glossary && typeof data.glossary === 'object') {
        serverGlossary = { ...def.glossary, ...data.glossary };
      }
      if (typeof data.styleDirective === 'string' && data.styleDirective.trim()) {
        serverDirective = data.styleDirective;
      }
      if (typeof data.version === 'string' && data.version.trim()) {
        serverVersion = data.version;
      }
    }
  } catch {
    // Offline fallback uses embedded literary pack rules
  }

  onProgress?.(70, `Đang lưu từ điển & cấu hình dịch ${def.label} vào ứng dụng...`);

  let hasBrowserOnDeviceModel = false;
  const api = getBrowserTranslatorApi();
  if (api && typeof api.availability === 'function') {
    try {
      const pairSource = code === 'en' ? 'vi' : 'en';
      const availability = await Promise.race([
        api.availability({ sourceLanguage: pairSource, targetLanguage: code }),
        new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 1000)),
      ]);
      hasBrowserOnDeviceModel = availability === 'available';
    } catch {
      hasBrowserOnDeviceModel = false;
    }
  }

  const installed: InstalledLanguagePack = {
    code: def.code,
    label: def.label,
    version: serverVersion,
    installedAt: Date.now(),
    sizeLabel: def.sizeLabel,
    hasBrowserOnDeviceModel,
    styleDirective: serverDirective,
    glossary: serverGlossary,
  };

  const all = loadInstalledLanguagePacks();
  all[def.code] = installed;
  saveInstalledLanguagePacks(all);

  onProgress?.(100, `Đã cài đặt gói ngôn ngữ ${def.label} vào ứng dụng.`);
  return installed;
}

/**
 * Simple heuristic source language detector for Chrome on-device Translator API.
 */
export function detectRoughSourceLang(sampleText: string): string {
  const s = sampleText.slice(0, 600);
  if (/[\u3040-\u30ff]/.test(s)) return 'ja';
  if (/[\uac00-\ud7af]/.test(s)) return 'ko';
  if (/[\u4e00-\u9fff]/.test(s)) return 'zh';
  if (/[ăâđêôơưàáạảãèéẹẻẽìíịỉĩòóọỏõùúụủũỳýỵỷỹ]/i.test(s)) return 'vi';
  return 'en';
}

/**
 * Attempts instant local translation via browser's built-in on-device Translator API
 * when the user has downloaded the language pack and the browser supports it.
 * Returns null if unsupported so caller uses fast parallel Gemini Flash Lite translation.
 */
export async function tryOnDeviceTranslateParagraphs(
  paragraphs: string[],
  targetLang: string
): Promise<string[] | null> {
  const api = getBrowserTranslatorApi();
  if (!api || paragraphs.length === 0) return null;

  const sourceLang = detectRoughSourceLang(paragraphs.slice(0, 3).join(' '));
  if (sourceLang === targetLang) return paragraphs;

  try {
    if (api.availability) {
      const avail = await api.availability({
        sourceLanguage: sourceLang,
        targetLanguage: targetLang,
      });
      if (avail === 'unavailable') return null;
    }
    const translator = await api.create({
      sourceLanguage: sourceLang,
      targetLanguage: targetLang,
    });
    const out: string[] = [];
    for (const p of paragraphs) {
      if (!p.trim()) {
        out.push(p);
      } else {
        out.push((await translator.translate(p)).trim());
      }
    }
    translator.destroy?.();
    return out;
  } catch {
    return null;
  }
}
