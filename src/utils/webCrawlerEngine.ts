import JSZip from 'jszip';
import type { Book } from '../types/book';
import { buildEpubBlob } from './epubBuilder';
import { slugifyFilename } from './fileHelpers';

export interface MacroStep {
  id: string;
  label: string;
  selector: string;
  delayMs: number;
}

export type WebIssueReason =
  | 'paywall'
  | 'login'
  | 'captcha'
  | 'empty'
  | 'error'
  | 'duplicate_loop'
  | 'end_of_book';

export type CrawlStatus =
  | 'idle'
  | 'configured'
  | 'running'
  | 'paused'
  | 'issue'
  | 'completed';

const PAYWALL_PATTERNS = [
  /trả\s*phí/i,
  /nạp\s*(xu|tiền|vip|thẻ)/i,
  /mua\s*(chương|truyện|gói)/i,
  /nâng\s*cấp\s*(tài\s*khoản|vip)/i,
  /chương\s*vip/i,
  /khóa\s*chương/i,
  /subscribe\s*to\s*(read|continue)/i,
  /unlock\s*this\s*chapter/i,
  /paywall/i,
  /members\s*only/i,
];

const LOGIN_PATTERNS = [
  /đăng\s*nhập\s*(để|tài\s*khoản|tiếp)/i,
  /vui\s*lòng\s*đăng\s*nhập/i,
  /bạn\s*cần\s*đăng\s*nhập/i,
  /sign\s*in\s*to\s*(read|continue|view)/i,
  /log\s*in\s*to\s*(read|continue|view)/i,
  /login\s*required/i,
];

const CAPTCHA_PATTERNS = [
  /verify\s*you\s*are\s*human/i,
  /cloudflare/i,
  /attention\s*required/i,
  /xác\s*minh\s*(bạn\s*không\s*phải|robot|người\s*máy)/i,
  /captcha/i,
  /access\s*denied/i,
];

export function computePageSignature(title: string, paragraphs: string[]): string {
  const joined = [title, ...paragraphs.slice(0, 4)]
    .join(' ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 360);

  let hash = 2166136261;
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `pg-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function detectPaywallOrIssue(
  title: string,
  paragraphs: string[],
  rawHint = ''
): { hasIssue: boolean; reason: WebIssueReason | null; message: string } {
  const fullText = `${title}\n${rawHint}\n${paragraphs.join('\n')}`.trim();

  if (CAPTCHA_PATTERNS.some((rx) => rx.test(fullText))) {
    return {
      hasIssue: true,
      reason: 'captcha',
      message:
        'Trang web yêu cầu xác minh chống bot / Captcha. Bạn có thể đóng thông báo (X) để mở trình duyệt gốc kiểm tra trực tiếp.',
    };
  }

  const wordCount = (paragraphs || []).join(' ').trim().split(/\s+/).filter(Boolean).length;

  if (PAYWALL_PATTERNS.some((rx) => rx.test(fullText)) && wordCount < 220) {
    return {
      hasIssue: true,
      reason: 'paywall',
      message:
        'Trang yêu cầu đóng phí / mở khóa VIP để đọc tiếp. Đóng thông báo (X) nếu bạn muốn tự vào kiểm tra hoặc lưu các chương đã quét.',
    };
  }

  if (LOGIN_PATTERNS.some((rx) => rx.test(fullText)) && wordCount < 220) {
    return {
      hasIssue: true,
      reason: 'login',
      message:
        'Trang web bắt đăng nhập tài khoản để đọc tiếp. Đóng thông báo (X) để mở trình duyệt gốc đăng nhập và kiểm tra.',
    };
  }

  if (!paragraphs || paragraphs.length === 0 || fullText.length < 40) {
    return {
      hasIssue: true,
      reason: 'empty',
      message:
        'Không đọc được nội dung văn bản mới trên trang này (có thể trang tải động hoặc đã hết chương). Đóng thông báo (X) để kiểm tra.',
    };
  }

  return { hasIssue: false, reason: null, message: '' };
}

export function detectDuplicateOrLoop(
  candidateUrl: string,
  candidateTitle: string,
  candidateParagraphs: string[],
  existingPages: Array<{ url: string; title: string; paragraphs: string[] }>
): { isDuplicate: boolean; isLoopToStart: boolean; message: string } {
  if (existingPages.length === 0) {
    return { isDuplicate: false, isLoopToStart: false, message: '' };
  }

  const normUrl = candidateUrl.trim().replace(/\/+$/, '');
  const candidateSig = computePageSignature(candidateTitle, candidateParagraphs);

  const first = existingPages[0];
  const firstUrl = first.url.trim().replace(/\/+$/, '');
  const firstSig = computePageSignature(first.title, first.paragraphs);

  if (normUrl === firstUrl || candidateSig === firstSig) {
    return {
      isDuplicate: true,
      isLoopToStart: true,
      message:
        'Phát hiện nội dung lặp lại từ trang đầu tiên. Quá trình quét tự động dừng để tránh trùng lặp.',
    };
  }

  for (const prev of existingPages) {
    const prevUrl = prev.url.trim().replace(/\/+$/, '');
    const prevSig = computePageSignature(prev.title, prev.paragraphs);
    if (normUrl === prevUrl || candidateSig === prevSig) {
      return {
        isDuplicate: true,
        isLoopToStart: false,
        message: 'Phát hiện trang có nội dung lặp lại với trang đã quét trước đó.',
      };
    }
  }

  return { isDuplicate: false, isLoopToStart: false, message: '' };
}

/**
 * Exports all books in the Library organized cleanly into collection folders inside a single `.zip`.
 */
export async function buildLibraryCollectionZip(books: Book[]): Promise<Blob> {
  const zip = new JSZip();
  const rootFolder = zip.folder('BOOKHAD-ThuVien-BoSuuTap') || zip;

  const manifest: Array<{
    title: string;
    author: string;
    collection: string;
    filePath: string;
    progressPercent: number;
  }> = [];

  for (const book of books) {
    const colName = (book.collection || 'Chua-phan-loai').trim();
    const colFolderSlug = slugifyFilename(colName);
    const fileName = `${slugifyFilename(book.title)}.epub`;
    const epubBlob = await buildEpubBlob(book);
    const arrayBuf = await epubBlob.arrayBuffer();

    const subFolder = rootFolder.folder(colFolderSlug) || rootFolder;
    subFolder.file(fileName, arrayBuf);

    manifest.push({
      title: book.title,
      author: book.author,
      collection: colName,
      filePath: `BOOKHAD-ThuVien-BoSuuTap/${colFolderSlug}/${fileName}`,
      progressPercent: book.progressPercent,
    });
  }

  rootFolder.file('muc-luc-thu-vien.json', JSON.stringify(manifest, null, 2));

  return await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
  });
}

/**
 * Resolves the external browser URI (defaulting to Google search when URL input is blank)
 * and builds an Android Intent URI when inside the Capacitor native APK shell.
 */
export function buildNativeBrowserHref(
  raw: string,
  isNativeAndroid = false,
  origin?: string
): string {
  const trimmed = raw.trim();
  const httpUrl = !trimmed
    ? 'https://www.google.com'
    : /^https?:\/\//i.test(trimmed)
    ? trimmed
    : trimmed.startsWith('/')
    ? origin
      ? `${origin}${trimmed}`
      : trimmed
    : `https://${trimmed}`;

  if (isNativeAndroid && /^https?:\/\//i.test(httpUrl)) {
    const scheme = httpUrl.startsWith('http://') ? 'http' : 'https';
    const hostAndPath = httpUrl.replace(/^https?:\/\//i, '');
    return `intent://${hostAndPath}#Intent;scheme=${scheme};action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;S.browser_fallback_url=${encodeURIComponent(
      httpUrl
    )};end`;
  }
  return httpUrl;
}

