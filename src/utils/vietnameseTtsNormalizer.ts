/**
 * Vietnamese TTS Text Normalizer & OCR Artifact Cleaner.
 *
 * Cleans broken OCR/EPUB/PDF strings (e.g. stray "I I C S", split single letters,
 * HTML/CSS leftovers, decorative dividers, footnotes), expands Vietnamese abbreviations,
 * converts structural Roman numerals, and repairs common OCR digit-letter swaps so
 * both on-device TTS and cloud TTS read Vietnamese naturally and accurately.
 */

const ROMAN_MAP: Record<string, number> = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
  VII: 7,
  VIII: 8,
  IX: 9,
  X: 10,
  XI: 11,
  XII: 12,
  XIII: 13,
  XIV: 14,
  XV: 15,
  XVI: 16,
  XVII: 17,
  XVIII: 18,
  XIX: 19,
  XX: 20,
  XXI: 21,
  XXII: 22,
  XXIII: 23,
  XXIV: 24,
  XXV: 25,
  XXX: 30,
};

const VIET_VOWEL_CHARS =
  'aăâeêioôơuưyàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵAĂÂEÊIOÔƠUƯYÀÁẢÃẠẰẮẲẴẶẦẤẨẪẬÈÉẺẼẸỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌỒỐỔỖỘỜỚỞỠỢÙÚỦŨỤỪỨỬỮỰỲÝỶỸỴ';

const VIET_LETTER_CHARS = `${VIET_VOWEL_CHARS}bcdfghjklmnpqrstvwxzđBCDFGHJKLMNPQRSTVWXZĐ`;

/**
 * Normalizes raw Vietnamese book text into clean, natural spoken Vietnamese for TTS.
 */
export function normalizeVietnameseForSpeech(rawText: string, lang = 'vi-VN'): string {
  if (!rawText) return '';
  let text = rawText;

  // 1. Strip invisible / zero-width / control characters & normalize Unicode NFC
  text = text
    .normalize('NFC')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF\u00AD]/g, '')
    .replace(/\u00A0/g, ' ');

  // 2. Strip residual HTML/XML tags and CSS/code noise
  text = text.replace(/<[^>]{1,120}>/g, ' ');
  text = text.replace(/https?:\/\/\S+|www\.\S+/gi, ' ');
  text = text.replace(/\b(?:ISBN|ISSN|DOI|UTF-?8|HTML|XHTML|CSS|EPUB|PDF)\b[:\s-]*[\dXx-]{0,20}/g, ' ');

  // 3. Rejoin hyphenated line breaks ("tuyệt-\nvời" -> "tuyệt vời")
  text = text.replace(
    new RegExp(`([${VIET_LETTER_CHARS}])[-‐‑]\\s*[\\r\\n]+\\s*([${VIET_LETTER_CHARS}])`, 'g'),
    '$1 $2'
  );
  text = text.replace(/[\r\n]+/g, ' ');

  // 4. Remove decorative dividers and markdown/formatting symbols
  text = text
    .replace(/[•·▪▫●○◆◇■□★☆✦✧※†‡§¶~^_|\\<>]+/g, ' ')
    .replace(/[*=_—–-]{3,}/g, ', ')
    .replace(/[*`#]/g, '')
    .replace(/\[\s*\d{1,4}\s*\]/g, '') // footnote refs like [1], [12]
    .replace(/\(\s*\d{1,3}\s*\)/g, ''); // inline footnote numbers like (1)

  const isVietnamese = !lang || lang.toLowerCase().startsWith('vi');
  if (!isVietnamese) {
    return text.replace(/\s+/g, ' ').trim();
  }

  // 5. Convert structural Roman numerals BEFORE stripping stray spaced uppercase artifacts
  //    e.g. "Chương I" -> "Chương 1", "Phần IV" -> "Phần 4", "Thế kỷ XXI" -> "Thế kỷ 21"
  text = text.replace(
    /\b(Chương|Chưong|Phần|Hồi|Tập|Quyển|Mục|Thế\s+kỷ|Thế\s+kỉ|Điều|Khoản|Bài|Tiết|Cấp)\s+([IVX]{1,6})\b/gi,
    (full, prefix: string, romanRaw: string) => {
      const val = ROMAN_MAP[romanRaw.toUpperCase()];
      if (!val) return full;
      const cleanPrefix = prefix.toLowerCase() === 'chưong' ? 'Chương' : prefix;
      return `${cleanPrefix} ${val}`;
    }
  );

  // 6. Strip stray OCR / scan uppercase letter garbage like "I I C S", "I I C", "C S S", "O C R", "A B C D"
  //    Matches 2+ standalone uppercase ASCII single-letter tokens separated by spaces/dots
  text = text.replace(
    /(?:^|(?<=[\s,.;:!?()\-—–"“'‘]))([A-Z]\.?(?:\s+[A-Z]\.?){1,7})(?=$|[\s,.;:!?()\-—–"”'’])/g,
    (match) => {
      const letters = match.replace(/[^A-Z]/g, '');
      // Keep meaningful 2-letter Vietnamese/geographic codes only if explicitly known
      if (letters === 'VN') return 'Việt Nam';
      if (letters === 'TP') return 'Thành phố';
      return ' ';
    }
  );

  // Also strip isolated stray uppercase artifact sequences glued to punctuation like "IICS", "CSS", "IIICS"
  text = text.replace(
    /\b(?:I{1,3}C{1,2}S{1,2}|I{2,}S|C{1,2}S{2,}|X{2,}Y{0,2}|O{1,2}C{1,2}R)\b/g,
    ' '
  );

  // 7. Rejoin OCR-spaced Vietnamese words (3+ single Vietnamese letters separated by spaces, e.g. "c h ư ơ n g" -> "chương")
  const singleVietChar = `[${VIET_LETTER_CHARS}]`;
  const spacedWordRe = new RegExp(
    `(?:^|(?<=\\s))(${singleVietChar}(?:\\s+${singleVietChar}){2,12})(?=$|[\\s,.;:!?])`,
    'g'
  );
  text = text.replace(spacedWordRe, (match) => {
    // Only collapse if it contains at least one lowercase letter or Vietnamese diacritic (avoids colliding acronyms)
    if (/[a-zàáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/.test(match)) {
      return match.replace(/\s+/g, '');
    }
    return match;
  });

  // 8. Repair common OCR digit-for-letter confusions inside Vietnamese words
  //    Specific diacritic-restoring fixes MUST run before generic 0 -> o replacement.
  text = text.replace(/\bkh0ng\b/gi, 'không');
  text = text.replace(/(?:^|(?<=[\s"“'‘(\-—–]))(?:ngươ1|ngư0i)(?=$|[\s,.;:!?()\-—–"”'’])/gi, 'người');
  text = text.replace(/\bm0t\b/gi, 'một');
  text = text.replace(/\btr0ng\b/gi, 'trong');
  text = text.replace(
    new RegExp(`(^|[\\s"“'‘(\\-—–])1([${VIET_VOWEL_CHARS}][${VIET_LETTER_CHARS}]*)`, 'g'),
    '$1l$2'
  );
  text = text.replace(
    new RegExp(`([${VIET_LETTER_CHARS}])0([${VIET_LETTER_CHARS}])`, 'g'),
    '$1o$2'
  );

  // 9. Expand common Vietnamese abbreviations, titles, units, and shorthand
  const replacements: Array<[RegExp, string]> = [
    [/\bTP\.\s*/gi, 'Thành phố '],
    [/\bPGS\.\s*TS\.\s*/gi, 'Phó giáo sư Tiến sĩ '],
    [/\bGS\.\s*TS\.\s*/gi, 'Giáo sư Tiến sĩ '],
    [/\bPGS\.\s*/gi, 'Phó giáo sư '],
    [/\bGS\.\s*/gi, 'Giáo sư '],
    [/\bThS\.\s*/gi, 'Thạc sĩ '],
    [/\bTS\.\s*/gi, 'Tiến sĩ '],
    [/\bBS\.\s*/gi, 'Bác sĩ '],
    [/\bKS\.\s*/gi, 'Kỹ sư '],
    [/\bNXB\.?\s*/g, 'Nhà xuất bản '],
    [/\bQ\.\s*(?=\d|[A-ZĐÀÁẢÃẠĂÂÊÔƠƯ])/g, 'Quận '],
    [/\bP\.\s*(?=\d|[A-ZĐÀÁẢÃẠĂÂÊÔƠƯ])/g, 'Phường '],
    [/\bTr\.\s*(?=\d)/gi, 'Trang '],
    [/\bVD\s*:/gi, 'Ví dụ:'],
    [/\bv\.v\.+/gi, 'vân vân'],
    [/(?:^|(?<=[\s,.;:!?()\-—–"“'‘]))đ\/c(?=$|[\s,.;:!?()\-—–"”'’])/gi, 'địa chỉ'],
    [/\bSĐT\b/gi, 'số điện thoại'],
    [/\bVNĐ\b|\bVND\b/g, 'đồng'],
    [/(\d+)\s*km\/h\b/gi, '$1 ki lô mét trên giờ'],
    [/(\d+)\s*km\b/gi, '$1 ki lô mét'],
    [/(\d+)\s*kg\b/gi, '$1 ki lô gam'],
    [/(\d+)\s*cm\b/gi, '$1 xen ti mét'],
    [/(\d+)\s*mm\b/gi, '$1 mi li mét'],
    [/(\d+)\s*°\s*C\b/gi, '$1 độ xê'],
    [/(\d+)\s*%/g, '$1 phần trăm'],
    [/\s*&\s*/g, ' và '],
    // Common Vietnamese web-novel / OCR shorthand (Unicode-safe boundaries for đ)
    [/\b(?:ko|k0)\b/gi, 'không'],
    [/(?:^|(?<=[\s,.;:!?()\-—–"“'‘]))(?:đc|dc)(?=$|[\s,.;:!?()\-—–"”'’])/gi, 'được'],
    [/\bng\b(?=\s+(?:ta|ấy|đó|này|kia|khác|lớn|trẻ|già|đẹp|tốt|xấu))/gi, 'người'],
    [/\bmn\b/gi, 'mọi người'],
    [/\bntn\b/gi, 'như thế nào'],
    [/\bvs\b(?=\s+[a-zà-ỹđ])/gi, 'với'],
  ];

  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }

  // 10. Clean punctuation cadence so TTS doesn't spell out symbols or stutter
  text = text
    .replace(/\.{4,}/g, '...')
    .replace(/!{2,}/g, '!')
    .replace(/\?{2,}/g, '?')
    .replace(/([,;:])\1+/g, '$1')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,.;:!?])([^\s"”'’)\d.!?])/g, '$1 $2')
    .replace(/^[\s,.;:–—-]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return text;
}
