import type {
  Book,
  BookReadingStyle,
  ChapterAnalysis,
  CharacterInfo,
  CharacterVoiceAssignment,
  GeminiVoiceName,
  ScriptSegment,
} from '../types/book';
import { DEFAULT_VOICE_TONE } from './audioFilterEngine';
import {
  splitNarrationDialogueAndThought,
  detectSpatialEffect,
} from './aiScriptDirector';

export interface CharacterVoicePreset {
  voiceName: GeminiVoiceName;
  roleTag: string;
  gender: 'male' | 'female';
  browserPitch: number;
  browserRate: number;
}

/**
 * 5 dedicated character voices (separate from Google AI default narrator 'Kore')
 * so every story character automatically receives a distinct voice both on AI TTS
 * and on-device offline speech synthesis.
 */
export const CHARACTER_VOICE_POOL: CharacterVoicePreset[] = [
  {
    voiceName: 'Charon',
    roleTag: 'Nam trầm ấm',
    gender: 'male',
    browserPitch: 0.84,
    browserRate: 0.96,
  },
  {
    voiceName: 'Zephyr',
    roleTag: 'Nữ dịu dàng',
    gender: 'female',
    browserPitch: 1.18,
    browserRate: 1.0,
  },
  {
    voiceName: 'Fenrir',
    roleTag: 'Nam hùng hồn',
    gender: 'male',
    browserPitch: 0.74,
    browserRate: 0.94,
  },
  {
    voiceName: 'Puck',
    roleTag: 'Nam trẻ linh hoạt',
    gender: 'male',
    browserPitch: 1.04,
    browserRate: 1.06,
  },
  {
    voiceName: 'Aoede',
    roleTag: 'Nữ sắc sảo',
    gender: 'female',
    browserPitch: 1.26,
    browserRate: 1.03,
  },
];

const FEMALE_KEYWORDS = [
  'cô',
  'nàng',
  'chị',
  'bà',
  'mẹ',
  'em gái',
  'tiểu thư',
  'công chúa',
  'hoàng hậu',
  'thái hậu',
  'nữ',
  'gái',
  'thiếu nữ',
  'muội',
  'tỷ',
  'she',
  'her',
  'lady',
  'girl',
  'queen',
  'miss',
];

const MALE_KEYWORDS = [
  'anh',
  'hắn',
  'gã',
  'ông',
  'lão',
  'cha',
  'bố',
  'cậu',
  'chàng',
  'thiếu gia',
  'đại ca',
  'sư huynh',
  'hoàng tử',
  'vua',
  'nam',
  'lữ khách',
  'nhà giả kim',
  'ông cụ',
  'he',
  'him',
  'king',
  'lord',
  'mr',
  'boy',
];

const ELDER_KEYWORDS = ['lão', 'ông', 'bà', 'cụ', 'nhà giả kim', 'trưởng lão', 'sư phụ', 'già', 'elder'];
const ANTAGONIST_KEYWORDS = ['quát', 'gầm', 'lạnh lùng', 'cười khẩy', 'giận dữ', 'hét', 'ma vương', 'kẻ thù', 'hắc'];

const SPEECH_VERBS_REGEX =
  /(?:nói|hỏi|đáp|trả lời|thì thầm|quát|hét(?:\s+lên)?|cười(?:\s+nhạt|\s+lớn|\s+khẽ|\s+bật)?|lẩm bẩm|thở dài|cất giọng|lên tiếng|kêu(?:\s+lên)?|bảo|nhắc|than|nhấn mạnh|giải thích|khẽ gọi|gọi|said|asked|replied|whispered|shouted|murmured|exclaimed)/i;

const STOP_NAMES = new Set([
  'chương',
  'phần',
  'hồi',
  'một',
  'hai',
  'ba',
  'nhưng',
  'tuy',
  'vậy',
  'thế',
  'khi',
  'lúc',
  'sau',
  'trước',
  'đó',
  'này',
  'kia',
  'trong',
  'ngoài',
  'trên',
  'dưới',
  'gió',
  'đêm',
  'ngày',
  'trời',
  'đất',
  'tiếng',
  'giọng',
  'ánh',
  'mọi',
  'tôi',
  'con',
  'người',
  'những',
  'không',
  'còn',
  'đang',
  'vẫn',
  'nếu',
  'bỗng',
  'rồi',
  'cả',
  'từ',
  'ở',
]);

function normalizeId(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'nhan_vat'
  );
}

/**
 * Extracts a capitalized Vietnamese/English character name from surrounding narration context.
 */
function extractSpeakerFromContext(context: string): string | null {
  if (!context || context.trim().length < 2) return null;

  // Pattern 1: Proper noun phrase (2-4 capitalized words) near a speech verb, e.g. "Nhà Giả Kim khẽ bật cười"
  const capitalizedPhraseRe =
    /([A-ZĐÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ][a-zđàáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồỔỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]+(?:\s+[A-ZĐÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ][a-zđàáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]+){1,3})/g;

  const candidates: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = capitalizedPhraseRe.exec(context)) !== null) {
    const phrase = match[1].trim();
    const firstWord = phrase.split(/\s+/)[0].toLowerCase();
    if (!STOP_NAMES.has(firstWord) && phrase.length >= 4 && phrase.length <= 34) {
      candidates.push(phrase);
    }
  }

  if (candidates.length > 0) {
    // Prefer candidate closest to a speech verb if present
    const verbMatch = SPEECH_VERBS_REGEX.exec(context);
    if (verbMatch) {
      let best = candidates[0];
      let bestDist = Infinity;
      for (const c of candidates) {
        const idx = context.indexOf(c);
        const dist = Math.abs(idx - verbMatch.index);
        if (dist < bestDist) {
          bestDist = dist;
          best = c;
        }
      }
      return best;
    }
    return candidates[0];
  }

  // Pattern 2: Role titles like "cô gái trẻ", "lão nông", "ông chủ", "tiểu thư"
  const titleMatch = context.match(
    /\b(cô gái|chàng trai|lão ông|lão bà|ông lão|bà lão|tiểu thư|thiếu gia|sư phụ|đại ca|công chúa|hoàng tử|lữ khách|nhà giả kim)\b/i
  );
  if (titleMatch) {
    return titleMatch[1]
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }

  return null;
}

export function detectEmotionFromLine(text: string, context = ''): string {
  const combined = `${text} ${context}`.toLowerCase();
  if (/dọa|đe|liệu hồn|hùng hồn|quyết chí|xông lên|thề|quát|hét|gầm|giận|phẫn nộ|cút|im ngay|!{2,}/.test(combined)) {
    if (/dọa|đe|liệu hồn/.test(combined)) return 'Dọa nạt, gằn giọng, uy hiếp';
    if (/hùng hồn|quyết chí|xông lên|thề/.test(combined)) return 'Hùng hồn, quyết chí, sục sôi';
    return 'Mạnh mẽ, giận dữ, dứt khoát';
  }
  if (/hoảng|sợ hãi|sợ quá|run rẩy|thở gấp|kinh hãi|thất kinh|cứu/.test(combined)) {
    return 'Hoảng sợ, lo âu, dồn dập';
  }
  if (/bất ngờ|sửng sốt|ngạc nhiên|trời ơi|không thể nào|sao có thể|!\?/.test(combined)) {
    return 'Bất ngờ, sửng sốt, cao giọng';
  }
  if (/kiên định|đĩnh đạc|chắc nịch|không lùi bước|bình tĩnh/.test(combined)) {
    return 'Kiên định, đĩnh đạc, chắc chắn';
  }
  if (/thì thầm|khẽ|nhỏ giọng|bí mật|lặng lẽ/.test(combined)) {
    return 'Thì thầm bí ẩn, nhẹ nhàng';
  }
  if (/cười lớn|phá lên cười|haha|ha ha|vui mừng|sung sướng|hào hứng|tuyệt vời/.test(combined)) {
    return 'Vui mừng, cười lớn, rạng rỡ';
  }
  if (/đau thương|buồn khổ|khóc|nước mắt|nức nở|tuyệt vọng|thở dài|tiếc|hoài niệm|đau/.test(combined)) {
    return 'Đau thương, buồn khổ, nghẹn ngào';
  }
  if (text.trim().endsWith('?')) {
    return 'Tò mò, nghi vấn, tự nhiên';
  }
  if (text.trim().endsWith('!')) {
    return 'Nhấn mạnh, cảm xúc cao trào';
  }
  return 'Tự nhiên, truyền cảm';
}

export interface ReadingVoiceStyleOption {
  id: BookReadingStyle;
  label: string;
  shortLabel: string;
  description: string;
}

export const READING_VOICE_STYLES: ReadingVoiceStyleOption[] = [
  {
    id: 'novel',
    label: 'Tiểu thuyết',
    shortLabel: 'Tiểu thuyết',
    description: 'Nhấn nhá tình huống & cảm xúc nhân vật.',
  },
  {
    id: 'essay',
    label: 'Tản văn',
    shortLabel: 'Tản văn',
    description: 'Nhẹ nhàng, êm ái, lắng đọng.',
  },
  {
    id: 'selfhelp',
    label: 'Học tập',
    shortLabel: 'Học tập',
    description: 'Rõ ràng, mạch lạc, giàu năng lượng.',
  },
  {
    id: 'research',
    label: 'Nghiên cứu',
    shortLabel: 'Nghiên cứu',
    description: 'Điềm tĩnh, chuẩn xác, nhấn thuật ngữ.',
  },
];

export function computeReadingStyleModulation(
  readingStyle: BookReadingStyle,
  emotionStyle: string,
  basePitch: number,
  baseRate: number
): { pitch: number; rate: number; stylePrompt: string } {
  const safePitch = Number.isFinite(basePitch) ? basePitch : 1.0;
  const safeRate = Number.isFinite(baseRate) ? baseRate : 1.0;
  const lower = (emotionStyle || '').toLowerCase();

  let pitchMult = 1.0;
  let rateMult = 1.0;
  let styleTag = '';

  if (readingStyle === 'essay') {
    pitchMult = 0.98;
    rateMult = 0.93;
    styleTag = 'Giọng tản văn nhẹ nhàng, tình cảm, sâu lắng';
  } else if (readingStyle === 'selfhelp') {
    pitchMult = 1.03;
    rateMult = 1.04;
    styleTag = 'Giọng sách Self-help tự tin, truyền động lực, nhấn ý chính';
  } else if (readingStyle === 'research') {
    pitchMult = 1.0;
    rateMult = 0.98;
    styleTag = 'Giọng nghiên cứu chuẩn xác, mạch lạc';
  } else {
    // 'novel' — expressive situational modulation
    styleTag = 'Giọng tiểu thuyết nhấn nhá tình huống';
    if (/hoảng sợ|dồn dập|lo âu/.test(lower)) {
      pitchMult = 1.12;
      rateMult = 1.11;
    } else if (/bất ngờ|sửng sốt|cao giọng/.test(lower)) {
      pitchMult = 1.15;
      rateMult = 1.06;
    } else if (/kiên định|đĩnh đạc|chắc chắn/.test(lower)) {
      pitchMult = 0.93;
      rateMult = 0.95;
    } else if (/dọa nạt|gằn giọng|uy hiếp|hùng hồn|quyết chí|giận dữ/.test(lower)) {
      pitchMult = 0.87;
      rateMult = 1.04;
    } else if (/đau thương|buồn khổ|nghẹn ngào|khóc|trầm buồn/.test(lower)) {
      pitchMult = 0.90;
      rateMult = 0.86;
    } else if (/vui mừng|cười lớn|rạng rỡ|tươi sáng/.test(lower)) {
      pitchMult = 1.12;
      rateMult = 1.08;
    } else if (/thì thầm/.test(lower)) {
      pitchMult = 0.95;
      rateMult = 0.88;
    }
  }

  return {
    pitch: Math.min(1.6, Math.max(0.6, Math.round(safePitch * pitchMult * 100) / 100)),
    rate: Math.min(1.8, Math.max(0.65, Math.round(safeRate * rateMult * 100) / 100)),
    stylePrompt: `${styleTag}. ${emotionStyle || 'Tự nhiên'}`.trim(),
  };
}

function inferCharacterTraits(name: string, contexts: string[]): {
  gender: 'male' | 'female' | 'neutral';
  ageGroup: string;
  roleHint: 'protagonist' | 'supporting' | 'antagonist';
} {
  const blob = `${name} ${contexts.join(' ')}`.toLowerCase();
  const femaleScore = FEMALE_KEYWORDS.reduce((acc, kw) => (blob.includes(kw) ? acc + 1 : acc), 0);
  const maleScore = MALE_KEYWORDS.reduce((acc, kw) => (blob.includes(kw) ? acc + 1 : acc), 0);

  let gender: 'male' | 'female' | 'neutral' = 'neutral';
  if (femaleScore > maleScore) gender = 'female';
  else if (maleScore > femaleScore) gender = 'male';

  const isElder = ELDER_KEYWORDS.some((kw) => blob.includes(kw));
  const isAntagonist = ANTAGONIST_KEYWORDS.some((kw) => blob.includes(kw));
  const ageGroup = isElder ? 'Lớn tuổi / Từng trải' : 'Trẻ / Trưởng thành';
  const roleHint = isAntagonist ? 'antagonist' : 'supporting';

  return { gender, ageGroup, roleHint };
}

interface RawSegmentPiece {
  isDialogue: boolean;
  text: string;
  surrounding: string;
}

/**
 * Splits a paragraph into narration & dialogue segments while preserving original order.
 */
function splitParagraphDialogue(paragraph: string): RawSegmentPiece[] {
  const trimmed = paragraph.trim();
  if (!trimmed) return [];

  // Dash-prefixed dialogue paragraph: "— Con đi đâu vậy? — ông hỏi."
  if (/^[—–-]\s+/.test(trimmed)) {
    const cleaned = trimmed.replace(/^[—–-]\s+/, '');
    const dashParts = cleaned.split(/\s+[—–]\s+/);
    if (dashParts.length >= 2) {
      return [
        { isDialogue: true, text: dashParts[0].trim(), surrounding: dashParts.slice(1).join(' ') },
        { isDialogue: false, text: dashParts.slice(1).join(' — ').trim(), surrounding: '' },
      ].filter((p) => p.text.length > 0);
    }
    return [{ isDialogue: true, text: cleaned, surrounding: '' }];
  }

  // Quoted dialogue: "..." or “...” or «...»
  const quoteRegex = /["“«]([^"”»]{2,})["”»]/g;
  const matches = Array.from(trimmed.matchAll(quoteRegex));
  if (matches.length === 0) {
    return [{ isDialogue: false, text: trimmed, surrounding: '' }];
  }

  const pieces: RawSegmentPiece[] = [];
  let cursor = 0;
  for (const m of matches) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const before = trimmed.slice(cursor, start).trim();
    const after = trimmed.slice(end).trim();

    if (before.length > 0) {
      pieces.push({ isDialogue: false, text: before, surrounding: '' });
    }
    const quoteText = m[1].trim();
    if (quoteText.length > 0) {
      pieces.push({
        isDialogue: true,
        text: quoteText,
        surrounding: `${before} ${after}`.trim(),
      });
    }
    cursor = end;
  }
  const tail = trimmed.slice(cursor).trim();
  if (tail.length > 0) {
    pieces.push({ isDialogue: false, text: tail, surrounding: '' });
  }

  return pieces;
}

/**
 * 100% On-Device Local AI Character Analyzer & Voice Caster.
 * Runs synchronously offline in <15ms without any API key or network request.
 */
export function analyzeChapterOnDevice(
  title: string,
  paragraphs: string[],
  readingStyle: BookReadingStyle = 'novel'
): ChapterAnalysis {
  const charMap = new Map<
    string,
    {
      id: string;
      name: string;
      lineCount: number;
      sampleQuote: string;
      contexts: string[];
    }
  >();

  const script: ScriptSegment[] = [];
  let lastSpeakerId: string | null = null;
  let prevSpeakerId: string | null = null;
  let lastMentionedName: string | null = null;

  const ensureChar = (name: string, quote: string, context: string) => {
    const id = normalizeId(name);
    const existing = charMap.get(id);
    if (existing) {
      existing.lineCount += 1;
      if (!existing.sampleQuote && quote) existing.sampleQuote = quote.slice(0, 110);
      if (context) existing.contexts.push(context);
      return existing;
    }
    const created = {
      id,
      name,
      lineCount: 1,
      sampleQuote: quote.slice(0, 110),
      contexts: context ? [context] : [],
    };
    charMap.set(id, created);
    return created;
  };

  let narratorLines = 0;

  paragraphs.forEach((para, pIdx) => {
    // AI 2 Director: Strictly separate narration lead, direct spoken dialogue, and inner thought
    const directed = splitNarrationDialogueAndThought(para, lastMentionedName || 'Nhân vật');
    if (directed.length === 0) return;

    const allowRoleSplit = readingStyle === 'novel' || readingStyle === 'essay';

    for (const chunk of directed) {
      if (chunk.segmentType === 'narration' || !allowRoleSplit) {
        const mentioned = extractSpeakerFromContext(chunk.text);
        if (mentioned) lastMentionedName = mentioned;
        narratorLines += 1;
        script.push({
          id: `local-seg-${script.length}`,
          paragraphIndex: pIdx,
          speakerId: 'narrator',
          speakerName: readingStyle === 'selfhelp' ? 'Diễn giả chính' : 'Người dẫn chuyện',
          emotionStyle:
            readingStyle === 'selfhelp'
              ? 'Tự tin, nhấn mạnh ý trọng tâm'
              : readingStyle === 'research'
              ? 'Rõ ràng, mạch lạc'
              : chunk.emotionStyle || 'Trầm tư kể chuyện, tự nhiên',
          text: chunk.text,
          segmentType: 'narration',
          spatialEffect: 'none',
        });
        continue;
      }

      // Attribute spoken dialogue or inner thought strictly to character
      const contextSpeaker = extractSpeakerFromContext(para);
      const validHint =
        chunk.speakerHint &&
        chunk.speakerHint !== 'Nhân vật' &&
        chunk.speakerHint !== 'Narrator' &&
        chunk.speakerHint.split(/\s+/).length <= 4
          ? chunk.speakerHint
          : null;
      let detectedName = contextSpeaker || validHint;
      if (!detectedName && lastMentionedName) {
        detectedName = lastMentionedName;
      }

      let speakerId: string;
      let speakerName: string;

      if (detectedName) {
        const ch = ensureChar(detectedName, chunk.text, para);
        speakerId = ch.id;
        speakerName = ch.name;
        lastMentionedName = ch.name;
      } else if (prevSpeakerId && prevSpeakerId !== lastSpeakerId) {
        const alt = charMap.get(prevSpeakerId);
        if (alt) {
          alt.lineCount += 1;
          speakerId = alt.id;
          speakerName = alt.name;
        } else {
          const fallback = ensureChar('Nhân Vật 1', chunk.text, para);
          speakerId = fallback.id;
          speakerName = fallback.name;
        }
      } else {
        const fallbackLabel = `Nhân Vật ${Math.min(10, charMap.size + 1)}`;
        const fallback = ensureChar(fallbackLabel, chunk.text, para);
        speakerId = fallback.id;
        speakerName = fallback.name;
      }

      if (lastSpeakerId && lastSpeakerId !== speakerId) {
        prevSpeakerId = lastSpeakerId;
      }
      lastSpeakerId = speakerId;

      const spatial =
        chunk.spatialEffect !== 'none'
          ? chunk.spatialEffect
          : detectSpatialEffect(chunk.segmentType, para, chunk.text);

      script.push({
        id: `local-seg-${script.length}`,
        paragraphIndex: pIdx,
        speakerId,
        speakerName,
        emotionStyle:
          chunk.segmentType === 'inner_thought'
            ? 'Nội tâm trầm lắng, suy tư'
            : detectEmotionFromLine(chunk.text, para),
        text: chunk.text,
        segmentType: chunk.segmentType,
        spatialEffect: spatial,
      });
    }
  });

  // Sort discovered characters by dialogue frequency and assign across the 5 distinct AI character voices
  const sortedChars = Array.from(charMap.values()).sort((a, b) => b.lineCount - a.lineCount);
  const usedVoices = new Set<GeminiVoiceName>();

  const pickVoiceForChar = (
    gender: 'male' | 'female' | 'neutral',
    ageGroup: string,
    roleHint: 'protagonist' | 'supporting' | 'antagonist',
    idx: number
  ): CharacterVoicePreset => {
    const genderPool =
      gender === 'neutral'
        ? CHARACTER_VOICE_POOL
        : CHARACTER_VOICE_POOL.filter((v) => v.gender === gender);

    // Prefer Fenrir for antagonists, Charon for elders, Zephyr for female lead, Aoede for female supporting, Puck for young male
    if (roleHint === 'antagonist' && gender !== 'female') {
      const fenrir = CHARACTER_VOICE_POOL.find((v) => v.voiceName === 'Fenrir')!;
      usedVoices.add(fenrir.voiceName);
      return fenrir;
    }
    if (ageGroup.includes('Lớn tuổi') && gender !== 'female') {
      const charon = CHARACTER_VOICE_POOL.find((v) => v.voiceName === 'Charon')!;
      usedVoices.add(charon.voiceName);
      return charon;
    }

    const unusedInGender = genderPool.find((v) => !usedVoices.has(v.voiceName));
    if (unusedInGender) {
      usedVoices.add(unusedInGender.voiceName);
      return unusedInGender;
    }

    const unusedAny = CHARACTER_VOICE_POOL.find((v) => !usedVoices.has(v.voiceName));
    if (unusedAny && gender === 'neutral') {
      usedVoices.add(unusedAny.voiceName);
      return unusedAny;
    }

    return genderPool[idx % genderPool.length] || CHARACTER_VOICE_POOL[idx % CHARACTER_VOICE_POOL.length];
  };

  const characters: CharacterInfo[] = [
    {
      id: 'narrator',
      name: readingStyle === 'selfhelp' ? 'Diễn giả chính' : 'Người dẫn chuyện',
      role: 'narrator',
      gender: 'neutral',
      ageGroup: 'Trưởng thành',
      voiceDescription: 'Giọng Google AI gốc tự nhiên, dẫn mạch truyện rõ ràng',
      suggestedVoiceName: 'Kore',
      lineCount: narratorLines,
      sampleQuote: paragraphs[0]?.slice(0, 100) || title,
    },
    ...sortedChars.map((ch, idx) => {
      const traits = inferCharacterTraits(ch.name, ch.contexts);
      const role: CharacterInfo['role'] =
        idx === 0 && traits.roleHint !== 'antagonist' ? 'protagonist' : traits.roleHint;
      const preset = pickVoiceForChar(traits.gender, traits.ageGroup, traits.roleHint, idx);
      return {
        id: ch.id,
        name: ch.name,
        role,
        gender: traits.gender,
        ageGroup: traits.ageGroup,
        voiceDescription: `${preset.roleTag} · Tự động nhận diện trên thiết bị (${traits.ageGroup})`,
        suggestedVoiceName: preset.voiceName,
        lineCount: ch.lineCount,
        sampleQuote: ch.sampleQuote || ch.name,
      };
    }),
  ];

  const charNames = sortedChars.slice(0, 5).map((c) => c.name);
  const summary =
    sortedChars.length > 0
      ? `AI trên thiết bị đã phân tích cục bộ (Offline) và nhận diện ${sortedChars.length} nhân vật (${charNames.join(', ')}), tự động phân phối 5 giọng nhân vật riêng biệt.`
      : 'AI trên thiết bị không thấy hội thoại tách biệt — giữ giọng Google AI gốc để đọc liền mạch.';

  return {
    estimatedTotalCharacters: Math.max(1, sortedChars.length),
    readingStyle,
    summary,
    characters,
    script,
    analyzedAt: Date.now(),
  };
}

/**
 * Generates CharacterVoiceAssignments for all discovered characters while preserving
 * any custom voice assignments the user already configured manually.
 */
export function buildAutoVoiceAssignments(
  characters: CharacterInfo[],
  existing: Record<string, CharacterVoiceAssignment> = {},
  options?: { inheritNarratorVoice?: boolean }
): Record<string, CharacterVoiceAssignment> {
  const next: Record<string, CharacterVoiceAssignment> = { ...existing };
  const inheritNarrator = Boolean(options?.inheritNarratorVoice && next.narrator);

  for (const ch of characters) {
    if (next[ch.id] && (ch.id === 'narrator' || !inheritNarrator || next[ch.id].isCustomOverride)) {
      continue;
    }
    if (inheritNarrator && ch.id !== 'narrator' && next.narrator) {
      next[ch.id] = {
        characterId: ch.id,
        source: next.narrator.source,
        geminiVoice: next.narrator.geminiVoice,
        externalVoiceId: next.narrator.externalVoiceId,
        browserVoiceURI: next.narrator.browserVoiceURI,
        stylePrompt: next.narrator.stylePrompt || ch.voiceDescription,
        browserPitch: next.narrator.browserPitch,
        browserRate: next.narrator.browserRate,
        toneSettings: next.narrator.toneSettings ? { ...next.narrator.toneSettings } : { ...DEFAULT_VOICE_TONE },
        isCustomOverride: false,
      };
      continue;
    }

    const preset = CHARACTER_VOICE_POOL.find((p) => p.voiceName === ch.suggestedVoiceName);
    next[ch.id] = {
      characterId: ch.id,
      source: 'gemini',
      geminiVoice: ch.id === 'narrator' ? 'Kore' : ch.suggestedVoiceName,
      stylePrompt: ch.voiceDescription,
      browserPitch: ch.id === 'narrator' ? 1.0 : preset?.browserPitch ?? (ch.gender === 'female' ? 1.18 : 0.88),
      browserRate: ch.id === 'narrator' ? 1.0 : preset?.browserRate ?? 1.0,
      toneSettings: {
        ...DEFAULT_VOICE_TONE,
        pitch: ch.id === 'narrator' ? 1.0 : preset?.browserPitch ?? 1.0,
        rate: ch.id === 'narrator' ? 1.0 : preset?.browserRate ?? 1.0,
      },
      isCustomOverride: false,
    };
  }

  return next;
}

/**
 * Implicitly propagates a newly selected narrator voice onto all non-manually-overridden characters
 * so choosing a narrator voice automatically applies across character lines without extra UI toggles.
 */
export function applyNarratorVoiceToCharacters(
  existing: Record<string, CharacterVoiceAssignment>,
  narratorAssignment: CharacterVoiceAssignment
): Record<string, CharacterVoiceAssignment> {
  const next: Record<string, CharacterVoiceAssignment> = {
    ...existing,
    narrator: { ...narratorAssignment, characterId: 'narrator' },
  };
  for (const [charId, assign] of Object.entries(next)) {
    if (charId === 'narrator' || assign.isCustomOverride) continue;
    next[charId] = {
      ...assign,
      source: narratorAssignment.source,
      geminiVoice: narratorAssignment.geminiVoice,
      externalVoiceId: narratorAssignment.externalVoiceId,
      browserVoiceURI: narratorAssignment.browserVoiceURI,
      browserPitch: narratorAssignment.browserPitch,
      browserRate: narratorAssignment.browserRate,
      toneSettings: narratorAssignment.toneSettings
        ? { ...narratorAssignment.toneSettings }
        : assign.toneSettings,
      isCustomOverride: false,
    };
  }
  return next;
}

/**
 * AI 5 Character Memory — Book-Wide Top 10 Scanner:
 * Scans ALL chapters of the entire book (not just the current chapter), ranks characters
 * by dialogue & inner-thought frequency across the whole book, and caps at Top 10
 * characters plus the Narrator so voice memory stays consistent across every chapter.
 */
export function analyzeBookTopCharacters(
  book: Book,
  readingStyle: BookReadingStyle = 'novel',
  maxCharacters = 10
): {
  topCharacters: CharacterInfo[];
  totalChaptersScanned: number;
  summary: string;
} {
  const aggregate = new Map<
    string,
    {
      info: CharacterInfo;
      totalLines: number;
    }
  >();

  let narratorTotalLines = 0;

  for (const ch of book.chapters || []) {
    const chAnalysis = analyzeChapterOnDevice(ch.title, ch.paragraphs || [], readingStyle);
    for (const c of chAnalysis.characters) {
      if (c.id === 'narrator') {
        narratorTotalLines += c.lineCount;
        continue;
      }
      const existing = aggregate.get(c.id);
      if (existing) {
        existing.totalLines += c.lineCount;
        existing.info.lineCount = existing.totalLines;
      } else {
        aggregate.set(c.id, {
          info: { ...c },
          totalLines: c.lineCount,
        });
      }
    }
  }

  const ranked = Array.from(aggregate.values())
    .sort((a, b) => b.totalLines - a.totalLines)
    .slice(0, Math.max(1, maxCharacters))
    .map((entry, idx) => {
      const poolPreset = CHARACTER_VOICE_POOL[idx % CHARACTER_VOICE_POOL.length];
      return {
        ...entry.info,
        role: idx === 0 && entry.info.role !== 'antagonist' ? ('protagonist' as const) : entry.info.role,
        suggestedVoiceName: entry.info.suggestedVoiceName || poolPreset.voiceName,
      };
    });

  const narratorInfo: CharacterInfo = {
    id: 'narrator',
    name: readingStyle === 'selfhelp' ? 'Diễn giả chính' : 'Người dẫn chuyện',
    role: 'narrator',
    gender: 'neutral',
    ageGroup: 'Trưởng thành',
    voiceDescription: 'Giọng dẫn mạch truyện chính xuyên suốt toàn bộ sách',
    suggestedVoiceName: 'Kore',
    lineCount: narratorTotalLines,
    sampleQuote: book.chapters?.[0]?.paragraphs?.[0]?.slice(0, 90) || book.title,
  };

  const namesPreview = ranked.slice(0, 4).map((c) => c.name).join(', ');
  const summary =
    ranked.length > 0
      ? `Đã quét toàn bộ ${book.chapters.length} chương — lọc ra ${ranked.length} nhân vật xuất hiện nhiều nhất (${namesPreview}${ranked.length > 4 ? '...' : ''}).`
      : `Đã quét ${book.chapters.length} chương — không phát hiện hội thoại tách biệt.`;

  return {
    topCharacters: [narratorInfo, ...ranked],
    totalChaptersScanned: book.chapters.length,
    summary,
  };
}

