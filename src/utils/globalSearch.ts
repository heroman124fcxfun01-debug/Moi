import type { Book, UserCollection } from '../types/book';
import { LANGUAGE_PACK_CATALOG } from './languagePacks';

export type GlobalSearchCategory =
  | 'book'
  | 'collection'
  | 'settings'
  | 'sync'
  | 'import'
  | 'web'
  | 'studio'
  | 'language';

export type GlobalSearchAction =
  | { type: 'open_book'; bookId: string; openAudio?: boolean }
  | { type: 'open_collection'; collectionName: string }
  | { type: 'open_import' }
  | { type: 'navigate'; tab: 'library' | 'reader' | 'web' | 'studio' | 'settings'; sectionId?: string };

export interface GlobalSearchItem {
  id: string;
  category: GlobalSearchCategory;
  categoryLabel: string;
  title: string;
  subtitle: string;
  keywords: string[];
  action: GlobalSearchAction;
}

/**
 * Strips Vietnamese diacritics and lowercases text for forgiving search ("cai dat" -> "cài đặt").
 */
export function normalizeSearchText(input: string): string {
  return (input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const STATIC_APP_FEATURES: GlobalSearchItem[] = [
  {
    id: 'feat-import-book',
    category: 'import',
    categoryLabel: 'Tải & Thêm sách',
    title: 'Thêm sách mới (.EPUB, .PDF, .TXT, Quét ảnh OCR)',
    subtitle: 'Nhập tệp sách từ máy hoặc chụp/quét trang sách ảnh để AI dịch trực tiếp',
    keywords: [
      'them sach',
      'tai sach',
      'nhap sach',
      'import',
      'epub',
      'pdf',
      'txt',
      'ocr',
      'anh sach',
      'chuyen pdf sang epub',
    ],
    action: { type: 'open_import' },
  },
  {
    id: 'feat-web-community',
    category: 'web',
    categoryLabel: 'Cộng đồng Web',
    title: 'Đọc Web trực tiếp & AI tự quét lưu file .EPUB',
    subtitle: 'Mở trang truyện bằng trình duyệt gốc hoặc để AI tự quét nhiều chương thành EPUB',
    keywords: [
      'cong dong',
      'web',
      'quet web',
      'tai truyen',
      'trinh duyet',
      'trinh duyet goc',
      'tu luu epub',
      'crawl',
      'doc truyen online',
    ],
    action: { type: 'navigate', tab: 'web' },
  },
  {
    id: 'feat-drive-login',
    category: 'sync',
    categoryLabel: 'Đồng bộ Google Drive',
    title: 'Đăng nhập Google Drive cá nhân',
    subtitle: 'Đăng nhập tài khoản Google riêng để lưu & nhận sách trong thư mục sáchlazy',
    keywords: [
      'google drive',
      'drive',
      'driver',
      'dang nhap',
      'tai khoan',
      'dong bo',
      'sachlazy',
      'cloud',
    ],
    action: { type: 'navigate', tab: 'settings', sectionId: 'sync-google-drive' },
  },
  {
    id: 'feat-drive-auto-sync',
    category: 'sync',
    categoryLabel: 'Đồng bộ Google Drive',
    title: 'Bật / Tắt tự động đồng bộ tiến độ lên Google Drive',
    subtitle: 'Mục 1: Tự lưu vị trí chương, trang đọc, đánh dấu vào thư mục sáchlazy',
    keywords: [
      'tu dong dong bo',
      'gat tat',
      'auto sync',
      'tien do doc',
      'google drive',
      'dong bo',
    ],
    action: { type: 'navigate', tab: 'settings', sectionId: 'sync-auto' },
  },
  {
    id: 'feat-drive-upload',
    category: 'sync',
    categoryLabel: 'Đồng bộ Google Drive',
    title: 'Up Bộ sưu tập & Sách lẻ lên Google Drive / Xuất tệp',
    subtitle: 'Mục 2: Tải bộ sưu tập (sáchlazy) hoặc sách lẻ, cảnh báo ghi đè trùng & xuất .lazisync.json',
    keywords: [
      'up sach',
      'tai len',
      'upload',
      'up bo suu tap',
      'sach le',
      'xuat file',
      'xuat tep',
      'sao luu',
      'backup',
      'lazisync',
      'ghi de',
    ],
    action: { type: 'navigate', tab: 'settings', sectionId: 'sync-upload' },
  },
  {
    id: 'feat-drive-download',
    category: 'sync',
    categoryLabel: 'Đồng bộ Google Drive',
    title: 'Nhận tệp sách & tiến độ từ Google Drive (Tải về)',
    subtitle: 'Mục 3: Quét Drive để tải xuống Bộ sưu tập (tự tạo cùng tên) hoặc Sách lẻ',
    keywords: [
      'nhan tep',
      'tai ve',
      'tai xuong',
      'download drive',
      'dong bo tai xuong',
      'bo suu tap drive',
      'sach le drive',
      'nhap lazisync',
    ],
    action: { type: 'navigate', tab: 'settings', sectionId: 'sync-download' },
  },
  {
    id: 'feat-settings-basic',
    category: 'settings',
    categoryLabel: 'Cài đặt',
    title: 'Cài đặt đọc sách cơ bản & Giao diện (Sáng / Tối / AMOLED)',
    subtitle: 'Đổi giao diện Sáng giấy, Tối dịu, AMOLED Đen, lật trang, giữ màn hình sáng, văn phong AI',
    keywords: [
      'cai dat',
      'settings',
      'giao dien',
      'theme',
      'toi',
      'sang',
      'amoled',
      'dark mode',
      'lat trang',
      'giu man hinh sang',
      'van phong ai',
      'tu mo sach',
    ],
    action: { type: 'navigate', tab: 'settings', sectionId: 'settings-basic' },
  },
  {
    id: 'feat-settings-appearance',
    category: 'settings',
    categoryLabel: 'Giao diện & Ảnh nền',
    title: 'Đổi màu giao diện & Ảnh nền ứng dụng (Tự ẩn khi đọc)',
    subtitle: 'Chọn 7 bảng màu, tự chọn mã màu và đặt ảnh nền từ điện thoại cho màn hình ngoài trình đọc',
    keywords: [
      'doi mau',
      'mau giao dien',
      'anh nen',
      'hinh nen',
      'wallpaper',
      'accent',
      'theme color',
      'background',
    ],
    action: { type: 'navigate', tab: 'settings', sectionId: 'settings-appearance' },
  },
  {
    id: 'feat-settings-hardware',
    category: 'settings',
    categoryLabel: 'Phần cứng & Độc lập',
    title: 'Chế độ chạy độc lập trên điện thoại & Phần cứng',
    subtitle: 'Offline-first, rung xúc giác, phím âm lượng lật trang, Web Audio DSP và bộ nhớ bền vững',
    keywords: [
      'doc lap',
      'dien thoai',
      'phan cung',
      'offline',
      'rung',
      'haptic',
      'phim am luong',
      'volume',
      'bo nho',
      'hardware',
    ],
    action: { type: 'navigate', tab: 'settings', sectionId: 'settings-hardware' },
  },
  {
    id: 'feat-language-packs',
    category: 'language',
    categoryLabel: 'Gói ngôn ngữ & Dịch AI',
    title: 'Tải gói ngôn ngữ dịch AI vào ứng dụng & Dịch ghi đè EPUB',
    subtitle: 'Cài gói Tiếng Việt, English, Trung, Nhật, Hàn, Pháp giúp dịch nhanh & ghi đè EPUB',
    keywords: [
      'goi ngon ngu',
      'tai goi',
      'dich',
      'dich nhanh',
      'dich epub',
      'ghi de epub',
      'song ngu',
      'translate',
      'language pack',
    ],
    action: { type: 'navigate', tab: 'settings', sectionId: 'settings-language-packs' },
  },
  {
    id: 'feat-studio-voice',
    category: 'studio',
    categoryLabel: 'Studio Giọng & Phông',
    title: 'Studio Giọng AI (5 giọng nhân vật), Phông chữ & Nhạc nền',
    subtitle: 'Quản lý giọng Google AI, nạp tệp giọng nói ngoài, import phông .TTF/.OTF và nhạc nền',
    keywords: [
      'studio',
      'giong',
      'giong ai',
      'giong doc',
      'nghe truyen',
      'sach noi',
      'audiobook',
      'nhan vat',
      'tts',
      'phong chu',
      'font',
      'ttf',
      'otf',
      'nhac nen',
      'ambient',
      'chill',
    ],
    action: { type: 'navigate', tab: 'studio' },
  },
  {
    id: 'feat-ereader-fonts',
    category: 'studio',
    categoryLabel: 'Phông máy đọc sách',
    title: 'Bộ 9 phông chữ cộng đồng máy đọc sách (Kindle · Kobo · Boox)',
    subtitle: 'Literata, Newsreader, Crimson Pro, Vollkorn, EB Garamond, Spectral, Bitter, Lexend, Be Vietnam Pro',
    keywords: [
      'font may doc sach',
      'phong chu dep',
      'kindle',
      'kobo',
      'boox',
      'e-ink',
      'eink',
      'literata',
      'newsreader',
      'crimson pro',
      'vollkorn',
      'eb garamond',
      'spectral',
      'bitter',
      'lexend',
      'be vietnam pro',
      'bookerly',
      'phong chu',
      'font',
    ],
    action: { type: 'navigate', tab: 'studio', sectionId: 'studio-ereader-fonts' },
  },
];

/**
 * Searches across everything in LaziRead: Books, User Collections, Settings,
 * Google Drive Sync, Import/Download, Community Web, Studio Voices/Fonts, and Language Packs.
 */
export function searchEntireApp(
  query: string,
  books: Book[],
  collections: UserCollection[],
  limit = 20
): GlobalSearchItem[] {
  const normQuery = normalizeSearchText(query);

  const dynamicItems: GlobalSearchItem[] = [];

  // 1. User's Books
  for (const book of books) {
    const chapterTitles = book.chapters.slice(0, 12).map((c) => c.title);
    dynamicItems.push({
      id: `book-${book.id}`,
      category: 'book',
      categoryLabel: 'Sách trong Thư viện',
      title: book.title,
      subtitle: `${book.author} · ${book.chapters.length} chương · Đã đọc ${book.progressPercent}%`,
      keywords: [book.title, book.author, book.description || '', ...chapterTitles],
      action: { type: 'open_book', bookId: book.id },
    });
  }

  // 2. User-created Collections in Library
  for (const col of collections) {
    dynamicItems.push({
      id: `col-${col.id}`,
      category: 'collection',
      categoryLabel: 'Bộ sưu tập của bạn',
      title: col.name,
      subtitle: `Bộ sưu tập trong Thư viện · ${col.bookIds.length} cuốn sách`,
      keywords: [col.name, 'bo suu tap', 'thu muc sach'],
      action: { type: 'open_collection', collectionName: col.name },
    });
  }

  // 3. Individual Language Packs
  for (const pack of LANGUAGE_PACK_CATALOG) {
    dynamicItems.push({
      id: `lang-${pack.code}`,
      category: 'language',
      categoryLabel: 'Gói ngôn ngữ',
      title: `Gói ngôn ngữ ${pack.label} (${pack.sizeLabel})`,
      subtitle: pack.description,
      keywords: ['goi ngon ngu', 'tai goi', 'dich', pack.code, pack.label, pack.nativeName],
      action: { type: 'navigate', tab: 'settings', sectionId: 'settings-language-packs' },
    });
  }

  const allItems = [...STATIC_APP_FEATURES, ...dynamicItems];

  if (!normQuery) {
    // Default quick-access suggestions when modal opens with empty query
    return [
      ...STATIC_APP_FEATURES.slice(0, 6),
      ...dynamicItems.filter((i) => i.category === 'collection').slice(0, 3),
      ...dynamicItems.filter((i) => i.category === 'book').slice(0, 4),
    ].slice(0, limit);
  }

  const tokens = normQuery.split(' ').filter(Boolean);

  const scored: Array<{ item: GlobalSearchItem; score: number }> = [];
  for (const item of allItems) {
    const normTitle = normalizeSearchText(item.title);
    const normSub = normalizeSearchText(item.subtitle);
    const normCat = normalizeSearchText(item.categoryLabel);
    const normKeys = item.keywords.map(normalizeSearchText).join(' ');
    const haystack = `${normTitle} ${normCat} ${normSub} ${normKeys}`;

    const allMatch = tokens.every((t) => haystack.includes(t));
    if (!allMatch) continue;

    let score = 0;
    if (normTitle.includes(normQuery)) score += 100;
    if (normTitle.startsWith(normQuery)) score += 40;
    if (normCat.includes(normQuery)) score += 35;
    if (normKeys.includes(normQuery)) score += 30;
    for (const t of tokens) {
      if (normTitle.includes(t)) score += 18;
      else if (normKeys.includes(t)) score += 10;
      else score += 4;
    }

    scored.push({ item, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.item);
}
