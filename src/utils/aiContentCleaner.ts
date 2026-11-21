import type { Book, Chapter } from '../types/book';
import { computeBookFingerprint } from './syncAndStats';

export type CleanupCategory =
  | 'addressesAndHeaders'
  | 'typosAndCensored'
  | 'repeatedNotes';

export interface BookScanFinding {
  id: string;
  category: CleanupCategory;
  chapterIndex: number;
  paragraphIndex: number;
  action: 'remove' | 'replace';
  original: string;
  cleaned: string;
  reason: string;
  groupKey?: string;
  repeatTotalCount?: number;
  duplicateRemoveCount?: number;
}

export interface CleanupSelectableItem {
  id: string;
  category: CleanupCategory;
  action: 'remove' | 'replace';
  label: string;
  excerpt: string;
  cleanedPreview?: string;
  chapterIndex: number;
  paragraphIndex: number;
  findingIds: string[];
  repeatTotalCount?: number;
  duplicateRemoveCount?: number;
  defaultChecked: boolean;
}

export interface BookCleanupReport {
  findings: BookScanFinding[];
  selectableItems: CleanupSelectableItem[];
  categoryCounts: Record<CleanupCategory, number>;
  categorySamples: Record<
    CleanupCategory,
    Array<{ original: string; cleaned: string; reason: string }>
  >;
  totalIssues: number;
  usedAiBoost: boolean;
}

export interface PreReadDecision {
  paragraphIndex: number;
  action: 'keep' | 'skip' | 'fix';
  cleanedText: string;
  reason?: string;
  source: 'local' | 'ai';
}

export interface CleanupSelection {
  addressesAndHeaders: boolean;
  typosAndCensored: boolean;
  repeatedNotes: boolean;
}

// Known Vietnamese ebook/novel scraper sites, download watermarks, and promotional footers
const SITE_BRAND_REGEX =
  /\b(?:vtbook|vbook|truyenfull|tangthuvien|metruyencv|metruyenchu|dtruyen|sstruyen|wikidich|thichtruyen|wattpad|webtruyen|truyencv|truyenyy|truyenqq|truyenchu|truyenhay|ngontinh|sachvui|dtv-?ebook|tve-?4u|isach|waka|nhasachmienphi|docsachhay|tailieumienphi|khosachnoi|ebookmienphi|vietmessenger|diendanlequydon|gacsach|vnsach|bookhad\.vn)\b(?:\.[a-z]{2,6})?/gi;

const URL_REGEX =
  /(?:https?:\/\/[^\s)>"'”’]+|www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s)>"'”’]*)?|\b[a-z0-9-]{2,}\.(?:com|vn|net|org|info|xyz|top|me|cc|tv|io|site|online)(?:\/[^\s)>"'”’]*)?)/gi;

const PURE_PROMO_OR_FOOTER_LINE_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  {
    re: /^(?:nguồn|source|tải\s+(?:sách|ebook|truyện|file)|đọc\s+(?:thêm\s+|truyện\s+|sách\s+)?tại|download\s+(?:at|tại)|link\s+tải|chia\s+sẻ\s+tại|truy\s+cập|website|web|fanpage|group|nhóm\s+dịch|biên\s+tập|convert(?:er)?\s*by|ebook\s*by|thực\s+hiện\s*bởi|sưu\s+tầm\s*tại|bản\s+quyền\s+thuộc|đăng\s+tải\s+tại)\s*[:\-–—]?\s*/i,
    reason: 'Địa chỉ tải / nguồn trang web',
  },
  {
    re: /(?:chúc\s+(?:các\s+)?bạn\s+đọc\s+(?:truyện|sách)\s+vui\s+vẻ|mời\s+(?:các\s+)?bạn\s+đón\s+đọc|nhớ\s+(?:nhấn\s+)?(?:like|theo\s+dõi|đề\s+cử|bình\s+chọn|đánh\s+giá|bình\s+luận)|cảm\s+ơn\s+(?:các\s+)?bạn\s+đã\s+(?:đọc|ủng\s+hộ)|vui\s+lòng\s+không\s+reup|nghiêm\s+cấm\s+sao\s+chép|đọc\s+bản\s+(?:full|đầy\s+đủ)\s+tại)/i,
    reason: 'Dòng quảng cáo / lời nhắn cuối trang',
  },
  {
    re: /^(?:trang|page|tr\.?)\s*\d{1,5}(?:\s*\/\s*\d{1,5})?$/i,
    reason: 'Số trang thừa ở cuối trang',
  },
  {
    re: /^[\s\-–—=*_~•·▪▫●○◆◇■□★☆✦✧※†‡§¶|\\/+#@^<>()[\]{}.,:;!?'`"]+$/,
    reason: 'Dấu gạch / ký hiệu phân cách thừa',
  },
  {
    re: /^(?:o0o|0o0|oo0oo|\*+\s*\*+\s*\*+|-\s*-\s*-+|=\s*=\s*=+|~\s*~\s*~+)$/i,
    reason: 'Ký hiệu phân cách thừa',
  },
];

const INLINE_WATERMARK_PHRASES: RegExp[] = [
  /[\[(（]\s*(?:nguồn|tải\s+tại|đọc\s+tại|source|link|convert|ebook|web)\s*[:\-–]?\s*[^\]）)]*[\])）]/gi,
  /(?:nguồn|tải\s+(?:ebook|sách|truyện)\s+tại|đọc\s+(?:truyện|sách)\s+tại)\s*[:\-–]?\s*(?:https?:\/\/\S+|www\.\S+|\S+\.(?:com|vn|net|org|info|xyz)\S*|vtbook\S*)/gi,
];

const REPEATED_NOTE_MARKER_REGEX =
  /^(?:\[\s*chú\s+thích[^\]]*\]|\(\s*chú\s+thích[^)]*\)|chú\s+thích\s*[:\-–]|lời\s+(?:tác\s+giả|dịch\s+giả|converter|người\s+dịch)\s*[:\-–]|p\/?s\s*[:\-–]|\(\s*\*+\s*\)|\[\s*\*+\s*\]|---\s*hết\s*(?:chương|phần|tập)?\s*---|hết\s+chương\s*\d*\.?$)/i;

// Clean typed helper for preserving capitalization of replaced words
function matchCase(source: string, target: string): string {
  if (!source) return target;
  if (source === source.toUpperCase() && source !== source.toLowerCase()) {
    return target.toUpperCase();
  }
  const first = source[0];
  if (first && first === first.toUpperCase() && first !== first.toLowerCase()) {
    return target[0].toUpperCase() + target.slice(1);
  }
  return target;
}

const CENSORED_WORD_RULES: Array<{ re: RegExp; repl: (m: string, ...args: string[]) => string }> = [
  // "l*n đ*nh núi" / "l*n đỉnh" / "lên đ*nh"
  {
    re: /\b(l[*×]n)\s+(đ[*×]nh|đỉnh)\b/gi,
    repl: (_m, p1, p2) => `${matchCase(p1, 'lên')} ${matchCase(p2, 'đỉnh')}`,
  },
  {
    re: /\b(lên)\s+(đ[*×]nh)\b/gi,
    repl: (_m, p1, p2) => `${p1} ${matchCase(p2, 'đỉnh')}`,
  },
  {
    re: /\b(đ[*×]nh)\s+(núi|đồi|đầu|cao|phong|tháp|cây|nhà)\b/gi,
    repl: (_m, p1, p2) => `${matchCase(p1, 'đỉnh')} ${p2}`,
  },
  {
    re: /\b(đỉnh|chân|trên|dưới|ngọn)\s+(n[*×]i)\b/gi,
    repl: (_m, p1, p2) => `${p1} ${matchCase(p2, 'núi')}`,
  },
  // Common censored action/story words in Vietnamese web novels
  { re: /\b(gi[*×]t|gi[*×]ết)\b/gi, repl: (m) => matchCase(m, 'giết') },
  { re: /\b(ch[*×]t|ch[*×]ết)\b/gi, repl: (m) => matchCase(m, 'chết') },
  { re: /\b(m[*×]u)\b/gi, repl: (m) => matchCase(m, 'máu') },
  { re: /\b(t[*×]nh)\s+(yêu|cảm|thương|nghĩa|duyên)\b/gi, repl: (_m, p1, p2) => `${matchCase(p1, 'tình')} ${p2}` },
  { re: /\b(ng[*×]ời|ngư[*×]i)\b/gi, repl: (m) => matchCase(m, 'người') },
  { re: /\b(h[*×]n)\s+(nhau|lên|nhẹ|sâu|môi|má|trán)\b/gi, repl: (_m, p1, p2) => `${matchCase(p1, 'hôn')} ${p2}` },
  { re: /\b(đ[*×]m)\s+(thẳng|xuyên|vào|ngực|lưng|mạnh)\b/gi, repl: (_m, p1, p2) => `${matchCase(p1, 'đâm')} ${p2}` },
  { re: /\b(đ[*×]m)\s+(tối|khuya|nay|qua|đông|trăng|mưa|lạnh)\b/gi, repl: (_m, p1, p2) => `${matchCase(p1, 'đêm')} ${p2}` },
  { re: /\b(ch[*×]m)\s+(đứt|ngang|xuống|mạnh|vào|bay)\b/gi, repl: (_m, p1, p2) => `${matchCase(p1, 'chém')} ${p2}` },
  { re: /\b(k[*×]m)\s+(khí|pháp|quang|ảnh|trận|đạo)\b/gi, repl: (_m, p1, p2) => `${matchCase(p1, 'kiếm')} ${p2}` },
  { re: /\b(x[*×]c)\s+(chết|thịt|người|ướp)\b/gi, repl: (_m, p1, p2) => `${matchCase(p1, 'xác')} ${p2}` },
  { re: /\b(l[*×]ng)\s+(người|dạ|tin|đau|nặng)\b/gi, repl: (_m, p1, p2) => `${matchCase(p1, 'lòng')} ${p2}` },
  { re: /\b(th[*×]t)\s+(ra|sự|lòng|tình|đấy)\b/gi, repl: (_m, p1, p2) => `${matchCase(p1, 'thật')} ${p2}` },
  { re: /\b(s[*×]ng)\s+(sót|chết|còn|dậy|đời)\b/gi, repl: (_m, p1, p2) => `${matchCase(p1, 'sống')} ${p2}` },
  { re: /\b(b[*×]n)\s+(ra|vào|trúng|tên|súng|phát)\b/gi, repl: (_m, p1, p2) => `${matchCase(p1, 'bắn')} ${p2}` },
  { re: /\b(đ[*×]nh)\b/gi, repl: (m) => matchCase(m, 'đỉnh') },
  { re: /\b(l[*×]n)\b/gi, repl: (m) => matchCase(m, 'lên') },
];

// Vietnamese typo & OCR syntax fixes (including "ci" -> "chị" as specifically requested!)
const TYPO_SYNTAX_RULES: Array<{ re: RegExp; repl: (m: string, ...args: string[]) => string }> = [
  // "ci" -> "chị" in Vietnamese contexts (avoids English "CI/CD")
  {
    re: /(^|[\s"“'‘(\-—–,;:])(ci)(?=\s+(?:ấy|gái|ơi|ta|em|hai|ba|tư|cả|nhỏ|lớn|họ|dâu|ruột|này|đó|kia|đang|đã|sẽ|vẫn|cũng|không|có|là|nói|bảo|hỏi|cười|khóc|nhìn|đi|về|ra|vào|làm|biết|muốn|thấy|nghe|ơi|nhé|nha|ạ)|[\s,.;:!?)"”'’]|$)/gi,
    repl: (_m, pre, word) => {
      // Skip all-caps "CI" (could be acronym) unless preceded by Vietnamese context
      if (word === 'CI') return `${pre}${word}`;
      return `${pre}${matchCase(word, 'chị')}`;
    },
  },
  // Preceded by Vietnamese kinship/action cue: "gọi ci", "của ci", "với ci", "như ci", "thưa ci", "chào ci"
  {
    re: /(^|[\s"“'‘(\-—–,;:])(gọi|của|với|như|thưa|chào|hỏi|nhìn|theo|giúp|yêu|thương|nhớ|sợ|bảo|nói|cho|cùng|bên|cạnh|em|anh|mẹ|bố|ba)\s+(ci)(?=$|[\s,.;:!?)"”'’])/gi,
    repl: (_m, pre, prev, word) => `${pre}${prev} ${matchCase(word, 'chị')}`,
  },
  // Common Vietnamese web-novel / OCR typos (Unicode-safe boundaries so 'Ông ta' / 'Lòng ta' are NEVER matched)
  {
    re: /(^|[\s"“'‘(\-—–,;:])(ko|k0|kh0ng)(?=$|[\s,.;:!?)"”'’])/gi,
    repl: (_m, pre, word) => `${pre}${matchCase(word, 'không')}`,
  },
  {
    re: /(^|[\s"“'‘(\-—–,;:])(đc|dc)(?=$|[\s,.;:!?)"”'’])/gi,
    repl: (_m, pre, word) => {
      if (word === 'DC') return `${pre}${word}`;
      return `${pre}${matchCase(word, 'được')}`;
    },
  },
  {
    re: /(^|[\s"“'‘(\-—–,;:])(trc)(?=$|[\s,.;:!?)"”'’])/gi,
    repl: (_m, pre, word) => `${pre}${matchCase(word, 'trước')}`,
  },
  {
    re: /(^|[\s"“'‘(\-—–,;:])(nhg)(?=$|[\s,.;:!?)"”'’])/gi,
    repl: (_m, pre, word) => `${pre}${matchCase(word, 'nhưng')}`,
  },
  {
    re: /(^|[\s"“'‘(\-—–,;:])(cx)(?=$|[\s,.;:!?)"”'’])/gi,
    repl: (_m, pre, word) => `${pre}${matchCase(word, 'cũng')}`,
  },
  {
    re: /(^|[\s"“'‘(\-—–,;:])(ngư0i|ngươ1)(?=$|[\s,.;:!?)"”'’])/gi,
    repl: (_m, pre, word) => `${pre}${matchCase(word, 'người')}`,
  },
  {
    re: /(^|[\s"“'‘(\-—–,;:])(m0t)(?=$|[\s,.;:!?)"”'’])/gi,
    repl: (_m, pre, word) => `${pre}${matchCase(word, 'một')}`,
  },
  {
    re: /(^|[\s"“'‘(\-—–,;:])(tr0ng)(?=$|[\s,.;:!?)"”'’])/gi,
    repl: (_m, pre, word) => `${pre}${matchCase(word, 'trong')}`,
  },
  {
    re: /(^|[\s"“'‘(\-—–,;:])(chưong)(?=$|[\s,.;:!?)"”'’])/gi,
    repl: (_m, pre, word) => `${pre}${matchCase(word, 'chương')}`,
  },
  {
    re: /(^|[\s"“'‘(\-—–,;:])(ng)\s+(ta|ấy|đó|này|kia|khác|lớn|trẻ|già|đẹp|tốt|xấu)(?=$|[\s,.;:!?)"”'’])/gi,
    repl: (_m, pre, w, next) => `${pre}${matchCase(w, 'người')} ${next}`,
  },
  {
    re: /(^|[\s"“'‘(\-—–,;:])(vs)\s+([a-zà-ỹđ])/gi,
    repl: (_m, pre, w, next) => `${pre}${matchCase(w, 'với')} ${next}`,
  },
  {
    re: /(^|[\s"“'‘(\-—–,;:])(mn)(?=$|[\s,.;:!?)"”'’])/gi,
    repl: (_m, pre, word) => `${pre}${matchCase(word, 'mọi người')}`,
  },
  {
    re: /(^|[\s"“'‘(\-—–,;:])(ntn)(?=$|[\s,.;:!?)"”'’])/gi,
    repl: (_m, pre, word) => `${pre}${matchCase(word, 'như thế nào')}`,
  },
  // Stray OCR uppercase garbage tokens like "I I C S" or "IICS"
  {
    re: /(?:^|(?<=[\s,.;:!?()\-—–"“'‘]))(?:I\s+I\s+C\s+S|I{1,3}C{1,2}S{1,2}|O\s+C\s+R)(?=$|[\s,.;:!?()\-—–"”'’])/g,
    repl: () => '',
  },
];

// Normalize line for duplicate/repeated-note detection across pages & chapters
export function normalizeLineSignature(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/\d+/g, '#')
    .replace(/[\s\-–—=*_~•·▪▫●○◆◇■□★☆✦✧.,:;!?()[\]{}"“”'‘’]+/g, ' ')
    .trim();
}

/**
 * Collects signatures of repeated notes, watermarks, or page headers/footers
 * appearing 2+ times across a book (kept short <= 140 chars so genuine recurring dialogue isn't flagged).
 */
export function collectRepeatedLineCounts(
  chapters: Array<Pick<Chapter, 'paragraphs'>>
): Map<string, number> {
  const counts = new Map<string, number>();
  const chapterSpread = new Map<string, Set<number>>();
  const consecutiveDup = new Set<string>();

  for (let chIdx = 0; chIdx < chapters.length; chIdx++) {
    const paras = chapters[chIdx]?.paragraphs || [];
    let prevSig = '';
    for (let pIdx = 0; pIdx < paras.length; pIdx++) {
      const raw = (paras[pIdx] || '').trim();
      if (!raw || raw.length > 600) {
        prevSig = '';
        continue;
      }
      const sig = normalizeLineSignature(raw);
      if (!sig || sig.length < 4) {
        prevSig = '';
        continue;
      }
      counts.set(sig, (counts.get(sig) || 0) + 1);
      if (sig === prevSig && raw.length >= 6) {
        consecutiveDup.add(sig);
      }
      prevSig = sig;
      let set = chapterSpread.get(sig);
      if (!set) {
        set = new Set<number>();
        chapterSpread.set(sig, set);
      }
      set.add(chIdx);
    }
  }

  const repeatedCounts = new Map<string, number>();
  for (const [sig, count] of counts.entries()) {
    const spread = chapterSpread.get(sig)?.size || 0;
    // Flag as repeated content if repeated >= 2 across different chapters, >= 3 times total, or duplicated consecutively
    if (count >= 2 && (spread >= 2 || count >= 3 || consecutiveDup.has(sig))) {
      repeatedCounts.set(sig, count);
    }
  }
  return repeatedCounts;
}

export function collectRepeatedLineSignatures(
  chapters: Array<Pick<Chapter, 'paragraphs'>>
): Set<string> {
  return new Set(collectRepeatedLineCounts(chapters).keys());
}

function isPureAddressOrJunkLine(text: string, bookTitle?: string): { hit: boolean; reason: string } {
  const trimmed = text.trim();
  if (!trimmed) return { hit: true, reason: 'Dòng trống' };

  for (const { re, reason } of PURE_PROMO_OR_FOOTER_LINE_PATTERNS) {
    if (re.test(trimmed)) {
      // For prefix-based promo patterns (index 0), ensure line is short/banner-like (< 220 chars)
      if (trimmed.length < 220) {
        return { hit: true, reason };
      }
    }
  }

  // Check if stripping URLs, known ebook site brands, and symbols leaves almost nothing real
  const withoutUrlsAndBrands = trimmed
    .replace(URL_REGEX, '')
    .replace(SITE_BRAND_REGEX, '')
    .replace(
      /\b(?:nguồn|source|tải|download|đọc|truyện|sách|ebook|tại|web|website|link|full|miễn\s+phí|free|chương|trang|page)\b/gi,
      ''
    )
    .replace(/[\s\-–—=*_~•·▪▫●○◆◇■□★☆✦✧.,:;!?()[\]{}"“”'‘’|/\\<>#@+]+/g, '')
    .trim();

  if (
    (URL_REGEX.test(trimmed) || SITE_BRAND_REGEX.test(trimmed)) &&
    withoutUrlsAndBrands.length <= 12
  ) {
    URL_REGEX.lastIndex = 0;
    SITE_BRAND_REGEX.lastIndex = 0;
    return { hit: true, reason: 'Địa chỉ tải / link trang web' };
  }
  URL_REGEX.lastIndex = 0;
  SITE_BRAND_REGEX.lastIndex = 0;

  // Redundant running book-title header inside body text
  if (bookTitle && bookTitle.trim().length >= 4 && trimmed.length <= bookTitle.trim().length + 24) {
    const normLine = normalizeLineSignature(trimmed);
    const normTitle = normalizeLineSignature(bookTitle);
    if (normLine && normTitle && (normLine === normTitle || normLine === `${normTitle} #`)) {
      return { hit: true, reason: 'Tiêu đề thừa lặp lại trong trang' };
    }
  }

  return { hit: false, reason: '' };
}

function stripInlineAddressesAndSymbols(text: string): { cleaned: string; changed: boolean; reason: string } {
  let out = text;
  const reasons: string[] = [];

  for (const re of INLINE_WATERMARK_PHRASES) {
    const next = out.replace(re, ' ');
    if (next !== out) {
      out = next;
      reasons.push('Xóa nguồn/địa chỉ tải chèn trong đoạn');
    }
  }

  const afterUrl = out.replace(URL_REGEX, ' ');
  URL_REGEX.lastIndex = 0;
  if (afterUrl !== out) {
    out = afterUrl;
    reasons.push('Xóa đường dẫn web (http/link)');
  }

  const afterBrand = out.replace(SITE_BRAND_REGEX, ' ');
  SITE_BRAND_REGEX.lastIndex = 0;
  if (afterBrand !== out) {
    out = afterBrand;
    reasons.push('Xóa tên trang tải sách (vtbook/web)');
  }

  // Strip long stray symbol runs embedded in text ("---", "===", "~~~", "•••")
  const afterDividers = out
    .replace(/[*=_~—–-]{4,}/g, ' ')
    .replace(/[•·▪▫●○◆◇■□★☆✦✧※†‡§¶|^\\<>]{2,}/g, ' ');
  if (afterDividers !== out) {
    out = afterDividers;
    reasons.push('Xóa ký hiệu / dấu gạch thừa');
  }

  out = out
    .replace(/\(\s*\)/g, '')
    .replace(/\[\s*\]/g, '')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return {
    cleaned: out,
    changed: out !== text.trim(),
    reason: reasons[0] || 'Xóa địa chỉ & ký hiệu thừa',
  };
}

function repairTyposAndCensoredText(text: string): { cleaned: string; changed: boolean; reason: string } {
  let out = text.normalize('NFC');
  let censoredFixed = false;
  let typoFixed = false;
  let punctFixed = false;

  // 1. Repair censored / masked words ("l*n đ*nh" -> "lên đỉnh", etc.)
  for (const rule of CENSORED_WORD_RULES) {
    const next = out.replace(rule.re, rule.repl as (...args: string[]) => string);
    if (next !== out) {
      out = next;
      censoredFixed = true;
    }
  }

  // 2. Repair Vietnamese typos & OCR syntax ("ci" -> "chị", "ko" -> "không", "đc" -> "được", etc.)
  for (const rule of TYPO_SYNTAX_RULES) {
    const next = out.replace(rule.re, rule.repl as (...args: string[]) => string);
    if (next !== out) {
      out = next;
      typoFixed = true;
    }
  }

  // 3. Clean broken punctuation / stray inline formatting symbols
  const afterPunct = out
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '')
    .replace(/([,;:])\1+/g, '$1')
    .replace(/\.{4,}/g, '...')
    .replace(/!{3,}/g, '!')
    .replace(/\?{3,}/g, '?')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,;:])([^\s"”'’)\d.,;:])/g, '$1 $2')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (afterPunct !== out.trim()) {
    out = afterPunct;
    punctFixed = true;
  } else {
    out = afterPunct;
  }

  const changed = out !== text.normalize('NFC').trim();
  const reason = censoredFixed
    ? 'Khôi phục từ bị che ký tự (*)'
    : typoFixed
    ? 'Sửa lỗi chính tả / cú pháp tiếng Việt'
    : punctFixed
    ? 'Sửa dấu câu & khoảng trắng thừa'
    : '';

  return { cleaned: out, changed, reason };
}

/**
 * Checks whether a paragraph still contains suspicious tokens (unresolved `*` censoring,
 * weird OCR typos, or ambiguous short lines) worth sending to server-side Gemini AI proofreading.
 */
export function isSuspiciousForAiProofread(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  // Unresolved masked word like "c*t", "đ*m", "x*u"
  if (/[a-zA-Zà-ỹđÀ-ỸĐ]\*[a-zA-Zà-ỹđÀ-ỸĐ]?/.test(trimmed)) return true;
  // URL / domain / site name that might still have surrounding promotional phrasing
  if (URL_REGEX.test(trimmed) || SITE_BRAND_REGEX.test(trimmed)) {
    URL_REGEX.lastIndex = 0;
    SITE_BRAND_REGEX.lastIndex = 0;
    return true;
  }
  URL_REGEX.lastIndex = 0;
  SITE_BRAND_REGEX.lastIndex = 0;
  // Suspicious OCR digits inside letters (e.g. "b4n", "l1nh")
  if (/[a-zà-ỹđ][01345][a-zà-ỹđ]/i.test(trimmed)) return true;
  // Suspicious repeated symbols or bracketed editorial notes
  if (/(?:\[\s*[^\]]{3,60}\s*\]|\(\s*(?:note|chú thích|nguồn|edit|beta)[^)]*\)|[-=_*]{3,})/i.test(trimmed)) {
    return true;
  }
  return false;
}

function buildReportFromFindings(
  findings: BookScanFinding[],
  usedAiBoost: boolean
): BookCleanupReport {
  const categoryCounts: Record<CleanupCategory, number> = {
    addressesAndHeaders: 0,
    typosAndCensored: 0,
    repeatedNotes: 0,
  };
  const categorySamples: Record<
    CleanupCategory,
    Array<{ original: string; cleaned: string; reason: string }>
  > = {
    addressesAndHeaders: [],
    typosAndCensored: [],
    repeatedNotes: [],
  };

  const selectableItems: CleanupSelectableItem[] = [];
  const groupedMap = new Map<string, CleanupSelectableItem>();

  for (const f of findings) {
    categoryCounts[f.category] += 1;
    if (categorySamples[f.category].length < 4) {
      categorySamples[f.category].push({
        original: f.original.slice(0, 110),
        cleaned: f.action === 'remove' ? '' : f.cleaned.slice(0, 110),
        reason: f.reason,
      });
    }

    if (f.groupKey) {
      const existing = groupedMap.get(f.groupKey);
      if (existing) {
        existing.findingIds.push(f.id);
        existing.duplicateRemoveCount = existing.findingIds.length;
        const total = f.repeatTotalCount || existing.findingIds.length + 1;
        existing.repeatTotalCount = total;
        existing.label = `Nội dung lặp lại nhiều lần (lặp ${total} lần — giữ 1 bản gốc, xóa ${existing.findingIds.length} bản thừa)`;
      } else {
        const removeCount = f.duplicateRemoveCount || 1;
        const total = f.repeatTotalCount || removeCount + 1;
        const item: CleanupSelectableItem = {
          id: `item-${f.groupKey}`,
          category: f.category,
          action: f.action,
          label: `Nội dung lặp lại nhiều lần (lặp ${total} lần — giữ 1 bản gốc, xóa ${removeCount} bản thừa)`,
          excerpt: f.original.slice(0, 110),
          chapterIndex: f.chapterIndex,
          paragraphIndex: f.paragraphIndex,
          findingIds: [f.id],
          repeatTotalCount: total,
          duplicateRemoveCount: 1,
          defaultChecked: true,
        };
        groupedMap.set(f.groupKey, item);
        selectableItems.push(item);
      }
    } else {
      const linePrefix =
        f.chapterIndex > 0
          ? `Ch.${f.chapterIndex + 1} · Dòng ${f.paragraphIndex + 1}`
          : `Dòng ${f.paragraphIndex + 1}`;
      selectableItems.push({
        id: `item-${f.id}`,
        category: f.category,
        action: f.action,
        label: `${linePrefix}: ${f.reason}`,
        excerpt: f.original.slice(0, 110),
        cleanedPreview: f.action === 'replace' ? f.cleaned.slice(0, 110) : undefined,
        chapterIndex: f.chapterIndex,
        paragraphIndex: f.paragraphIndex,
        findingIds: [f.id],
        defaultChecked: true,
      });
    }
  }

  return {
    findings,
    selectableItems,
    categoryCounts,
    categorySamples,
    totalIssues: findings.length,
    usedAiBoost,
  };
}

/**
 * Job 1 (Core Deterministic Scanner):
 * Scans an entire book during import (or on demand) and classifies every detected issue
 * into individual & grouped selectable items while enforcing the Mandatory Deduplication Rule:
 * - Any repeated paragraph/sentence (occurring N >= 2 times) MUST preserve its 1st original
 *   occurrence intact at its original position and ONLY flag occurrences 2..N (N - 1 duplicates)
 *   for optional deletion. NEVER delete 100% of repeated content!
 */
export function scanBookForCleanup(
  book: Pick<Book, 'title' | 'author' | 'chapters'>
): BookCleanupReport {
  const findings: BookScanFinding[] = [];
  const repeatedCounts = collectRepeatedLineCounts(book.chapters);
  const seenRepeatedSignatures = new Set<string>();

  for (let chIdx = 0; chIdx < book.chapters.length; chIdx++) {
    const ch = book.chapters[chIdx];
    const paras = ch.paragraphs || [];

    for (let pIdx = 0; pIdx < paras.length; pIdx++) {
      const original = (paras[pIdx] || '').trim();
      if (!original) continue;

      const sig = normalizeLineSignature(original);
      const repeatTotalCount = sig.length >= 4 ? repeatedCounts.get(sig) || 0 : 0;
      const isRepeatedAcrossBook = repeatTotalCount >= 2;
      const isExplicitNoteLine = REPEATED_NOTE_MARKER_REGEX.test(original) && original.length <= 220;

      // Check Category 1: pure download URL / vtbook / footer / decorative divider / redundant title
      const pureJunk = isPureAddressOrJunkLine(original, book.title);
      if (pureJunk.hit) {
        findings.push({
          id: `f-${chIdx}-${pIdx}-addr`,
          category: 'addressesAndHeaders',
          chapterIndex: chIdx,
          paragraphIndex: pIdx,
          action: 'remove',
          original,
          cleaned: '',
          reason: pureJunk.reason,
        });
        continue;
      }

      // Mandatory Deduplication Preservation Rule:
      // If a line/paragraph repeats N >= 2 times, ALWAYS preserve the 1st original copy in place
      // and ONLY flag duplicate occurrences 2..N for removal (keep 1, delete N-1).
      if (isRepeatedAcrossBook) {
        if (!seenRepeatedSignatures.has(sig)) {
          seenRepeatedSignatures.add(sig);
          // 1st occurrence is KEPT intact — do NOT flag for deletion!
          continue;
        }
        const duplicateRemoveCount = repeatTotalCount - 1;
        findings.push({
          id: `f-${chIdx}-${pIdx}-note`,
          category: 'repeatedNotes',
          chapterIndex: chIdx,
          paragraphIndex: pIdx,
          action: 'remove',
          original,
          cleaned: '',
          reason: `Nội dung lặp lại nhiều lần (lặp ${repeatTotalCount} lần — giữ 1 bản gốc, xóa ${duplicateRemoveCount} bản thừa)`,
          groupKey: `repeat:${sig}`,
          repeatTotalCount,
          duplicateRemoveCount,
        });
        continue;
      }

      if (isExplicitNoteLine) {
        findings.push({
          id: `f-${chIdx}-${pIdx}-note`,
          category: 'repeatedNotes',
          chapterIndex: chIdx,
          paragraphIndex: pIdx,
          action: 'remove',
          original,
          cleaned: '',
          reason: 'Chú thích / dòng kết chương thừa',
        });
        continue;
      }

      // Check inline addresses/symbols inside real prose (Category 1)
      const inlineAddr = stripInlineAddressesAndSymbols(original);
      if (inlineAddr.changed) {
        findings.push({
          id: `f-${chIdx}-${pIdx}-addr-inline`,
          category: 'addressesAndHeaders',
          chapterIndex: chIdx,
          paragraphIndex: pIdx,
          action: inlineAddr.cleaned.length === 0 ? 'remove' : 'replace',
          original,
          cleaned: inlineAddr.cleaned,
          reason: inlineAddr.reason,
        });
      }

      // Check typos, censored words, syntax fixes (Category 2) on the text after inline address removal
      const baseForTypo = inlineAddr.changed ? inlineAddr.cleaned : original;
      if (baseForTypo.length > 0) {
        const typoRes = repairTyposAndCensoredText(baseForTypo);
        if (typoRes.changed) {
          findings.push({
            id: `f-${chIdx}-${pIdx}-typo`,
            category: 'typosAndCensored',
            chapterIndex: chIdx,
            paragraphIndex: pIdx,
            action: 'replace',
            original: baseForTypo,
            cleaned: typoRes.cleaned,
            reason: typoRes.reason,
          });
        }
      }
    }
  }

  return buildReportFromFindings(findings, false);
}

/**
 * Merges server-side Gemini AI proofreading findings into the local scan report
 * without duplicating already-detected findings for the same paragraph + category.
 */
export function mergeAiBookFindings(
  baseReport: BookCleanupReport,
  aiFindings: BookScanFinding[]
): BookCleanupReport {
  if (!aiFindings || aiFindings.length === 0) {
    return baseReport;
  }

  const byKey = new Map<string, BookScanFinding>();
  for (const f of baseReport.findings) {
    byKey.set(`${f.chapterIndex}:${f.paragraphIndex}:${f.category}`, f);
  }

  for (const af of aiFindings) {
    const key = `${af.chapterIndex}:${af.paragraphIndex}:${af.category}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, af);
    } else if (af.category === 'typosAndCensored' && af.cleaned && af.cleaned !== existing.cleaned) {
      // Prefer Gemini AI's contextual repair when it improves upon local regex
      byKey.set(key, {
        ...existing,
        cleaned: af.cleaned,
        reason: af.reason || existing.reason,
      });
    }
  }

  return buildReportFromFindings(Array.from(byKey.values()), true);
}

function applyActiveFindingsToBook(
  book: Book,
  activeFindings: BookScanFinding[]
): { cleanedBook: Book; removedCount: number; fixedCount: number } {
  if (activeFindings.length === 0) {
    return { cleanedBook: book, removedCount: 0, fixedCount: 0 };
  }

  // Group findings by chapterIndex -> paragraphIndex
  const byChapter = new Map<number, Map<number, BookScanFinding[]>>();
  for (const f of activeFindings) {
    let chMap = byChapter.get(f.chapterIndex);
    if (!chMap) {
      chMap = new Map<number, BookScanFinding[]>();
      byChapter.set(f.chapterIndex, chMap);
    }
    const list = chMap.get(f.paragraphIndex) || [];
    list.push(f);
    chMap.set(f.paragraphIndex, list);
  }

  let removedCount = 0;
  let fixedCount = 0;

  const cleanedChapters: Chapter[] = book.chapters.map((ch, chIdx) => {
    const chMap = byChapter.get(chIdx);
    if (!chMap || chMap.size === 0) return ch;

    const nextParagraphs: string[] = [];
    for (let pIdx = 0; pIdx < ch.paragraphs.length; pIdx++) {
      const orig = ch.paragraphs[pIdx];
      const pFindings = chMap.get(pIdx);
      if (!pFindings || pFindings.length === 0) {
        nextParagraphs.push(orig);
        continue;
      }

      // If any selected finding removes the paragraph completely, drop it
      if (pFindings.some((f) => f.action === 'remove')) {
        removedCount += 1;
        continue;
      }

      // Apply replacements in logical order: addressesAndHeaders -> typosAndCensored -> repeatedNotes
      let currentText = orig;
      const addrFinding = pFindings.find((f) => f.category === 'addressesAndHeaders');
      if (addrFinding && addrFinding.cleaned) {
        currentText = addrFinding.cleaned;
      }
      const typoFinding = pFindings.find((f) => f.category === 'typosAndCensored');
      if (typoFinding && typoFinding.cleaned) {
        // If both addr and typo were selected, typoFinding.cleaned was already computed on addr-cleaned text;
        // if ONLY typo was selected (addr unchecked), run typo fix directly on original!
        currentText = addrFinding
          ? typoFinding.cleaned
          : repairTyposAndCensoredText(orig).cleaned || typoFinding.cleaned;
      }
      const noteFinding = pFindings.find((f) => f.category === 'repeatedNotes');
      if (noteFinding && noteFinding.cleaned) {
        currentText = noteFinding.cleaned;
      }

      if (currentText.trim().length === 0) {
        removedCount += 1;
      } else {
        if (currentText.trim() !== orig.trim()) {
          fixedCount += 1;
        }
        nextParagraphs.push(currentText.trim());
      }
    }

    return {
      ...ch,
      paragraphs: nextParagraphs.length > 0 ? nextParagraphs : ch.paragraphs.slice(0, 1),
      // Reset stale character analysis if chapter paragraphs changed
      analysis: undefined,
    };
  });

  const cleanedBook: Book = {
    ...book,
    chapters: cleanedChapters,
    fingerprint: computeBookFingerprint({
      title: book.title,
      author: book.author,
      chapters: cleanedChapters,
    }),
  };

  return { cleanedBook, removedCount, fixedCount };
}

/**
 * Applies ONLY the user-checked cleanup categories to a Book (legacy 3-category API).
 */
export function applyBookCleanupSelection(
  book: Book,
  report: BookCleanupReport,
  selected: CleanupSelection
): { cleanedBook: Book; removedCount: number; fixedCount: number } {
  const activeFindings = report.findings.filter((f) => selected[f.category]);
  return applyActiveFindingsToBook(book, activeFindings);
}

/**
 * Applies ONLY the individual selectable line/group items checked by the user.
 * Enforces keeping at least 1 original occurrence of any repeated paragraph!
 */
export function applyBookCleanupByItemIds(
  book: Book,
  report: BookCleanupReport,
  selectedItemIds: Set<string> | string[]
): { cleanedBook: Book; removedCount: number; fixedCount: number } {
  const idSet = selectedItemIds instanceof Set ? selectedItemIds : new Set(selectedItemIds);
  if (idSet.size === 0) {
    return { cleanedBook: book, removedCount: 0, fixedCount: 0 };
  }
  const activeFindingIds = new Set<string>();
  for (const item of report.selectableItems) {
    if (idSet.has(item.id)) {
      for (const fid of item.findingIds) {
        activeFindingIds.add(fid);
      }
    }
  }
  const activeFindings = report.findings.filter((f) => activeFindingIds.has(f.id));
  return applyActiveFindingsToBook(book, activeFindings);
}

/**
 * Job 2 (Pre-Read AI Local Fast Gate — 0ms latency):
 * Evaluates a single paragraph right before the AI Reader speaks it.
 * - Returns `action: 'skip'` if the paragraph is a download address (vtbook/http),
 *   end-of-page watermark, stray symbol separator, or repeated footnote.
 * - Returns `action: 'fix'` with `cleanedText` if inline URLs, censored words (`l*n đ*nh`),
 *   or typos (`ci`) need fixing before speaking.
 * - Returns `action: 'keep'` for clean literary content.
 */
export function evaluateParagraphForPreRead(
  paragraph: string,
  paragraphIndex: number,
  bookTitle?: string,
  repeatedSignatures?: Set<string>
): PreReadDecision {
  const original = (paragraph || '').trim();
  if (!original) {
    return {
      paragraphIndex,
      action: 'skip',
      cleanedText: '',
      reason: 'Đoạn trống',
      source: 'local',
    };
  }

  const pureJunk = isPureAddressOrJunkLine(original, bookTitle);
  if (pureJunk.hit) {
    return {
      paragraphIndex,
      action: 'skip',
      cleanedText: '',
      reason: pureJunk.reason,
      source: 'local',
    };
  }

  const sig = normalizeLineSignature(original);
  if (
    (repeatedSignatures && sig.length >= 4 && repeatedSignatures.has(sig)) ||
    (REPEATED_NOTE_MARKER_REGEX.test(original) && original.length <= 220)
  ) {
    return {
      paragraphIndex,
      action: 'skip',
      cleanedText: '',
      reason: 'Chú thích / dòng lặp thừa',
      source: 'local',
    };
  }

  const inlineAddr = stripInlineAddressesAndSymbols(original);
  const afterAddr = inlineAddr.changed ? inlineAddr.cleaned : original;
  if (!afterAddr) {
    return {
      paragraphIndex,
      action: 'skip',
      cleanedText: '',
      reason: inlineAddr.reason || 'Địa chỉ tải / ký hiệu thừa',
      source: 'local',
    };
  }

  const typoRes = repairTyposAndCensoredText(afterAddr);
  const finalCleaned = typoRes.changed ? typoRes.cleaned : afterAddr;

  if (inlineAddr.changed || typoRes.changed) {
    return {
      paragraphIndex,
      action: 'fix',
      cleanedText: finalCleaned,
      reason: typoRes.changed ? typoRes.reason : inlineAddr.reason,
      source: 'local',
    };
  }

  return {
    paragraphIndex,
    action: 'keep',
    cleanedText: original,
    source: 'local',
  };
}

/**
 * Resolves the spoken text for a playback batch using the Pre-Read AI decisions map.
 * If all spans in the batch are marked `skip`, returns `shouldSkipBatch: true` so the
 * AI Voice Reader immediately skips reading addresses/links/junk and moves to the next sentence!
 */
export function resolveBatchSpeechWithPreRead(
  spans: Array<{ paragraphIndex: number; text: string }>,
  decisions: Map<number, PreReadDecision>,
  bookTitle?: string,
  repeatedSignatures?: Set<string>
): {
  shouldSkipBatch: boolean;
  spokenText: string;
  skipReason?: string;
  fixedCount: number;
  skippedCount: number;
} {
  const spokenParts: string[] = [];
  let fixedCount = 0;
  let skippedCount = 0;
  let firstSkipReason: string | undefined;

  for (const span of spans) {
    const decision =
      decisions.get(span.paragraphIndex) ||
      evaluateParagraphForPreRead(span.text, span.paragraphIndex, bookTitle, repeatedSignatures);

    if (decision.action === 'skip') {
      skippedCount += 1;
      if (!firstSkipReason && decision.reason) {
        firstSkipReason = decision.reason;
      }
      continue;
    }

    if (decision.action === 'fix') {
      fixedCount += 1;
      // If span is a slice/dialogue inside the paragraph, apply local fix to the span when AI decision was for full paragraph
      const cleanedSpan =
        decision.cleanedText && span.text.trim().length >= decision.cleanedText.length * 0.65
          ? decision.cleanedText
          : repairTyposAndCensoredText(stripInlineAddressesAndSymbols(span.text).cleaned).cleaned;
      if (cleanedSpan) spokenParts.push(cleanedSpan);
    } else {
      spokenParts.push(span.text);
    }
  }

  const spokenText = spokenParts.join(' ').replace(/\s{2,}/g, ' ').trim();
  return {
    shouldSkipBatch: spokenText.length === 0,
    spokenText,
    skipReason: firstSkipReason,
    fixedCount,
    skippedCount,
  };
}

/**
 * Helper to apply Pre-Read AI decisions to a script segment list (used in tests & summaries).
 */
export function applyPreReadDecisionsToScript<
  T extends { paragraphIndex: number; text: string }
>(
  script: T[],
  decisions: Map<number, PreReadDecision>
): {
  filteredScript: T[];
  skippedParagraphs: number[];
  fixedParagraphs: number[];
  skippedReasons: Record<number, string>;
} {
  const filteredScript: T[] = [];
  const skippedParagraphs: number[] = [];
  const fixedParagraphs: number[] = [];
  const skippedReasons: Record<number, string> = {};

  for (const seg of script) {
    const dec = decisions.get(seg.paragraphIndex);
    if (dec?.action === 'skip') {
      if (!skippedParagraphs.includes(seg.paragraphIndex)) {
        skippedParagraphs.push(seg.paragraphIndex);
        skippedReasons[seg.paragraphIndex] = dec.reason || 'Nội dung thừa';
      }
      continue;
    }
    if (dec?.action === 'fix' && dec.cleanedText) {
      if (!fixedParagraphs.includes(seg.paragraphIndex)) {
        fixedParagraphs.push(seg.paragraphIndex);
      }
      filteredScript.push({ ...seg, text: dec.cleanedText });
    } else {
      filteredScript.push(seg);
    }
  }

  return { filteredScript, skippedParagraphs, fixedParagraphs, skippedReasons };
}
