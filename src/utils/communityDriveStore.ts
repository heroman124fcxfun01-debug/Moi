export type CommunityFormat = 'EPUB' | 'PDF' | 'TXT';

export interface CommunityBookDoc {
  id: string;
  title: string;
  title_normalized: string;
  author: string;
  genre: string;
  format: CommunityFormat;
  downloads: number;
  created_at: number;
  updated_at: number;
}

export interface CommunityBookLinkDoc {
  id: string;
  book_id: string;
  drive_url: string;
  drive_file_id: string;
  format: CommunityFormat;
  success_count: number;
  good_votes: number;
  fail_count: number;
  consecutive_fails: number;
  score: number;
  is_active: boolean;
  created_at: number;
}

export interface CommunityBookWithLinks {
  book: CommunityBookDoc;
  links: CommunityBookLinkDoc[];
  bestLink: CommunityBookLinkDoc | null;
}

export enum FirestoreOperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface ParsedDriveLink {
  valid: boolean;
  fileId: string;
  canonicalUrl: string;
  directDownloadUrl: string;
  reason?: string;
}

const DRIVE_PATTERNS: RegExp[] = [
  /https?:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]{10,120})/i,
  /https?:\/\/drive\.google\.com\/open\?(?:[^#\s]*&)?id=([a-zA-Z0-9_-]{10,120})/i,
  /https?:\/\/drive\.google\.com\/uc\?(?:[^#\s]*&)?id=([a-zA-Z0-9_-]{10,120})/i,
  /https?:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation|file)\/d\/([a-zA-Z0-9_-]{10,120})/i,
];

/**
 * Strictly validates Google Drive URL format and extracts canonical drive_file_id.
 */
export function parseGoogleDriveLink(rawUrl: string): ParsedDriveLink {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) {
    return {
      valid: false,
      fileId: '',
      canonicalUrl: '',
      directDownloadUrl: '',
      reason: 'Vui lòng dán đường dẫn Google Drive.',
    };
  }

  for (const regex of DRIVE_PATTERNS) {
    const match = trimmed.match(regex);
    if (match && match[1]) {
      const fileId = match[1];
      return {
        valid: true,
        fileId,
        canonicalUrl: `https://drive.google.com/file/d/${fileId}/view?usp=sharing`,
        directDownloadUrl: `https://drive.google.com/uc?export=download&id=${fileId}`,
      };
    }
  }

  return {
    valid: false,
    fileId: '',
    canonicalUrl: '',
    directDownloadUrl: '',
    reason: 'Link không đúng định dạng Google Drive (ví dụ: https://drive.google.com/file/d/...).',
  };
}

/**
 * Strips Vietnamese diacritics, punctuation, and extra whitespace for instant search & book grouping.
 */
export function normalizeBookTitleForIndex(input: string): string {
  return (input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Quality ranking formula:
 * score = (success_count * 2) + (good_votes * 5) - (fail_count * 15)
 */
export function computeLinkScore(
  successCount: number,
  goodVotes: number,
  failCount: number
): number {
  return successCount * 2 + goodVotes * 5 - failCount * 15;
}

/**
 * Evaluates whether a link remains active (auto-hidden when consecutive_fails >= 3).
 */
export function shouldLinkStayActive(consecutiveFails: number): boolean {
  return consecutiveFails < 3;
}

/**
 * Sorts active links by score DESC, then created_at DESC.
 */
export function rankActiveLinks(links: CommunityBookLinkDoc[]): CommunityBookLinkDoc[] {
  return [...links]
    .filter((l) => l.is_active && shouldLinkStayActive(l.consecutive_fails))
    .sort((a, b) => b.score - a.score || b.created_at - a.created_at);
}

/**
 * Groups flat books + links collections into sorted UI entries with best active link.
 */
export function mergeBooksAndLinks(
  books: CommunityBookDoc[],
  links: CommunityBookLinkDoc[]
): CommunityBookWithLinks[] {
  const linkMap = new Map<string, CommunityBookLinkDoc[]>();
  for (const link of links) {
    if (!link.is_active || !shouldLinkStayActive(link.consecutive_fails)) continue;
    const arr = linkMap.get(link.book_id) || [];
    arr.push(link);
    linkMap.set(link.book_id, arr);
  }

  const merged: CommunityBookWithLinks[] = [];
  for (const book of books) {
    const activeLinks = rankActiveLinks(linkMap.get(book.id) || []);
    if (activeLinks.length === 0) continue;
    merged.push({
      book,
      links: activeLinks,
      bestLink: activeLinks[0] || null,
    });
  }
  return merged;
}

/**
 * Checks whether a drive_file_id already exists among stored links.
 */
export function hasDuplicateDriveFileId(
  links: CommunityBookLinkDoc[],
  driveFileId: string
): boolean {
  return links.some((l) => l.drive_file_id === driveFileId);
}

/**
 * Instant diacritic-insensitive search matching title or author.
 */
export function filterCommunityBooks(
  items: CommunityBookWithLinks[],
  query: string,
  activeChip: string
): CommunityBookWithLinks[] {
  const normQuery = normalizeBookTitleForIndex(query);
  let filtered = items.filter((item) => {
    if (normQuery) {
      const normTitle = item.book.title_normalized || normalizeBookTitleForIndex(item.book.title);
      const normAuthor = normalizeBookTitleForIndex(item.book.author);
      if (!normTitle.includes(normQuery) && !normAuthor.includes(normQuery)) {
        return false;
      }
    }

    if (activeChip === 'EPUB' || activeChip === 'PDF' || activeChip === 'TXT') {
      return (
        item.book.format === activeChip ||
        item.links.some((l) => l.format === activeChip)
      );
    }
    if (activeChip === 'Tiên hiệp' || activeChip === 'Ngôn tình' || activeChip === 'Kinh dị') {
      return normalizeBookTitleForIndex(item.book.genre).includes(
        normalizeBookTitleForIndex(activeChip)
      );
    }
    return true;
  });

  if (activeChip === 'Tải nhiều') {
    filtered = [...filtered].sort(
      (a, b) => (b.book.downloads || 0) - (a.book.downloads || 0)
    );
  } else {
    filtered = [...filtered].sort(
      (a, b) => (b.book.updated_at || b.book.created_at) - (a.book.updated_at || a.book.created_at)
    );
  }
  return filtered;
}

// ---------- Local RAM + localStorage Cache & Starter Catalog ----------
const LOCAL_BOOKS_KEY = 'bookhad_community_books_v2';
const LOCAL_LINKS_KEY = 'bookhad_community_links_v2';

let memoryCacheBooks: CommunityBookDoc[] | null = null;
let memoryCacheLinks: CommunityBookLinkDoc[] | null = null;

function createStarterSeed(): { books: CommunityBookDoc[]; links: CommunityBookLinkDoc[] } {
  const now = Date.now();
  const books: CommunityBookDoc[] = [
    {
      id: 'book-pham-nhan-tu-tien',
      title: 'Phàm Nhân Tu Tiên (Trọn Bộ)',
      title_normalized: normalizeBookTitleForIndex('Phàm Nhân Tu Tiên (Trọn Bộ)'),
      author: 'Vong Ngữ',
      genre: 'Tiên hiệp',
      format: 'EPUB',
      downloads: 428,
      created_at: now - 86400000 * 4,
      updated_at: now - 3600000 * 3,
    },
    {
      id: 'book-ben-nhau-tron-doi',
      title: 'Bên Nhau Trọn Đời',
      title_normalized: normalizeBookTitleForIndex('Bên Nhau Trọn Đời'),
      author: 'Cố Mạn',
      genre: 'Ngôn tình',
      format: 'EPUB',
      downloads: 315,
      created_at: now - 86400000 * 3,
      updated_at: now - 3600000 * 5,
    },
    {
      id: 'book-quy-bi-chi-chu',
      title: 'Quỷ Bí Chi Chủ',
      title_normalized: normalizeBookTitleForIndex('Quỷ Bí Chi Chủ'),
      author: 'Ái Tiềm Thủy Đích Ô Tặc',
      genre: 'Kinh dị',
      format: 'EPUB',
      downloads: 512,
      created_at: now - 86400000 * 2,
      updated_at: now - 3600000 * 2,
    },
    {
      id: 'book-dac-nhan-tam-pdf',
      title: 'Đắc Nhân Tâm (Bản Chuẩn)',
      title_normalized: normalizeBookTitleForIndex('Đắc Nhân Tâm (Bản Chuẩn)'),
      author: 'Dale Carnegie',
      genre: 'Kỹ năng',
      format: 'PDF',
      downloads: 274,
      created_at: now - 86400000,
      updated_at: now - 3600000,
    },
  ];

  const links: CommunityBookLinkDoc[] = [
    {
      id: 'lnk-pntt-1',
      book_id: 'book-pham-nhan-tu-tien',
      drive_url: 'https://drive.google.com/file/d/1BkHdPhAmNhAnTuTiEn001/view?usp=sharing',
      drive_file_id: '1BkHdPhAmNhAnTuTiEn001',
      format: 'EPUB',
      success_count: 86,
      good_votes: 24,
      fail_count: 0,
      consecutive_fails: 0,
      score: computeLinkScore(86, 24, 0),
      is_active: true,
      created_at: now - 86400000 * 4,
    },
    {
      id: 'lnk-bntd-1',
      book_id: 'book-ben-nhau-tron-doi',
      drive_url: 'https://drive.google.com/file/d/1BkHdBeNNhAuTrOnDoI002/view?usp=sharing',
      drive_file_id: '1BkHdBeNNhAuTrOnDoI002',
      format: 'EPUB',
      success_count: 62,
      good_votes: 19,
      fail_count: 0,
      consecutive_fails: 0,
      score: computeLinkScore(62, 19, 0),
      is_active: true,
      created_at: now - 86400000 * 3,
    },
    {
      id: 'lnk-qbcc-1',
      book_id: 'book-quy-bi-chi-chu',
      drive_url: 'https://drive.google.com/file/d/1BkHdQuYBiChIChU003/view?usp=sharing',
      drive_file_id: '1BkHdQuYBiChIChU003',
      format: 'EPUB',
      success_count: 105,
      good_votes: 31,
      fail_count: 0,
      consecutive_fails: 0,
      score: computeLinkScore(105, 31, 0),
      is_active: true,
      created_at: now - 86400000 * 2,
    },
    {
      id: 'lnk-dnt-1',
      book_id: 'book-dac-nhan-tam-pdf',
      drive_url: 'https://drive.google.com/file/d/1BkHdDaCNhAnTaMPdf004/view?usp=sharing',
      drive_file_id: '1BkHdDaCNhAnTaMPdf004',
      format: 'PDF',
      success_count: 54,
      good_votes: 14,
      fail_count: 0,
      consecutive_fails: 0,
      score: computeLinkScore(54, 14, 0),
      is_active: true,
      created_at: now - 86400000,
    },
  ];
  return { books, links };
}

function readLocalCommunityState(): { books: CommunityBookDoc[]; links: CommunityBookLinkDoc[] } {
  if (memoryCacheBooks && memoryCacheLinks) {
    return { books: memoryCacheBooks, links: memoryCacheLinks };
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const bRaw = window.localStorage.getItem(LOCAL_BOOKS_KEY);
      const lRaw = window.localStorage.getItem(LOCAL_LINKS_KEY);
      if (bRaw && lRaw) {
        const b = JSON.parse(bRaw);
        const l = JSON.parse(lRaw);
        if (Array.isArray(b) && Array.isArray(l) && b.length > 0) {
          memoryCacheBooks = b;
          memoryCacheLinks = l;
          return { books: b, links: l };
        }
      }
    } catch {
      // fall through to seed
    }
  }
  const seed = createStarterSeed();
  memoryCacheBooks = seed.books;
  memoryCacheLinks = seed.links;
  persistLocalCommunityState(seed.books, seed.links);
  return seed;
}

function persistLocalCommunityState(
  books: CommunityBookDoc[],
  links: CommunityBookLinkDoc[]
): void {
  memoryCacheBooks = books;
  memoryCacheLinks = links;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(LOCAL_BOOKS_KEY, JSON.stringify(books));
      window.localStorage.setItem(LOCAL_LINKS_KEY, JSON.stringify(links));
    } catch {
      // ignore quota
    }
  }
}

// ---------- Firebase Firestore Optional Live Sync (Zero PII, Anonymous Auth) ----------
import firebaseConfig from '../../firebase-applet-config.json';

let firestoreReadyPromise: Promise<{ db: any; firestoreMod: any } | null> | null = null;

async function getFirestoreClient(): Promise<{ db: any; firestoreMod: any } | null> {
  if (typeof window === 'undefined') return null;
  if (firestoreReadyPromise) return firestoreReadyPromise;

  firestoreReadyPromise = (async () => {
    try {
      const cfg = firebaseConfig as Record<string, string | undefined>;
      if (!cfg?.projectId || !cfg?.apiKey) return null;

      const [{ initializeApp, getApps }, firestoreMod] = await Promise.all([
        import('firebase/app'),
        import('firebase/firestore'),
      ]);

      const app = getApps().length > 0 ? getApps()[0] : initializeApp(cfg);
      const db = cfg.firestoreDatabaseId
        ? firestoreMod.getFirestore(app, cfg.firestoreDatabaseId)
        : firestoreMod.getFirestore(app);

      // Connectivity check via getDocFromServer
      try {
        await firestoreMod.getDocFromServer(firestoreMod.doc(db, 'test', 'connection'));
      } catch (err) {
        if (err instanceof Error && err.message.includes('the client is offline')) {
          return null;
        }
      }
      return { db, firestoreMod };
    } catch {
      return null;
    }
  })();

  return firestoreReadyPromise;
}

export function warmCommunityRamCache(): void {
  readLocalCommunityState();
  // Silently sync with Firestore in background
  void listCommunityBooksWithLinks();
}

export function getCachedCommunityBooksWithLinks(): CommunityBookWithLinks[] {
  const local = readLocalCommunityState();
  return mergeBooksAndLinks(local.books, local.links);
}

export async function listCommunityBooksWithLinks(): Promise<CommunityBookWithLinks[]> {
  const local = readLocalCommunityState();
  try {
    const client = await getFirestoreClient();
    if (client) {
      const { db, firestoreMod } = client;
      const [booksSnap, linksSnap] = await Promise.all([
        firestoreMod.getDocs(firestoreMod.collection(db, 'books')),
        firestoreMod.getDocs(
          firestoreMod.query(
            firestoreMod.collection(db, 'book_links'),
            firestoreMod.where('is_active', '==', true),
            firestoreMod.orderBy('score', 'desc')
          )
        ),
      ]);

      if (!booksSnap.empty && !linksSnap.empty) {
        const remoteBooks: CommunityBookDoc[] = booksSnap.docs.map((d: any) => ({
          id: d.id,
          ...d.data(),
        }));
        const remoteLinks: CommunityBookLinkDoc[] = linksSnap.docs.map((d: any) => ({
          id: d.id,
          ...d.data(),
        }));
        // Merge remote with local starter if needed
        const bookMap = new Map<string, CommunityBookDoc>();
        for (const b of local.books) bookMap.set(b.id, b);
        for (const b of remoteBooks) bookMap.set(b.id, b);

        const linkMap = new Map<string, CommunityBookLinkDoc>();
        for (const l of local.links) linkMap.set(l.id, l);
        for (const l of remoteLinks) linkMap.set(l.id, l);

        const mergedBooks = Array.from(bookMap.values());
        const mergedLinks = Array.from(linkMap.values());
        persistLocalCommunityState(mergedBooks, mergedLinks);
        return mergeBooksAndLinks(mergedBooks, mergedLinks);
      }
    }
  } catch {
    // Graceful fallback to RAM/local cache
  }
  return mergeBooksAndLinks(local.books, local.links);
}

export interface AnonymousShareInput {
  title: string;
  author: string;
  genre: string;
  format: CommunityFormat;
  driveUrl: string;
}

export async function submitAnonymousBookShare(
  input: AnonymousShareInput
): Promise<{ ok: boolean; error?: string; item?: CommunityBookWithLinks }> {
  const title = input.title.trim();
  const author = input.author.trim() || 'Khuyết danh';
  const genre = input.genre.trim() || 'Tiên hiệp';
  if (title.length < 2) {
    return { ok: false, error: 'Tên sách quá ngắn.' };
  }

  const parsed = parseGoogleDriveLink(input.driveUrl);
  if (!parsed.valid) {
    return { ok: false, error: parsed.reason };
  }

  const state = readLocalCommunityState();
  if (hasDuplicateDriveFileId(state.links, parsed.fileId)) {
    return { ok: false, error: 'Đường dẫn Google Drive này đã được chia sẻ trước đó.' };
  }

  const now = Date.now();
  const titleNorm = normalizeBookTitleForIndex(title);

  // Group into existing book if title_normalized matches
  let book = state.books.find((b) => b.title_normalized === titleNorm);
  if (!book) {
    book = {
      id: `book-${titleNorm.replace(/\s+/g, '-').slice(0, 32)}-${now.toString(36)}`,
      title,
      title_normalized: titleNorm,
      author,
      genre,
      format: input.format,
      downloads: 0,
      created_at: now,
      updated_at: now,
    };
    state.books = [book, ...state.books];
  } else {
    book = { ...book, updated_at: now };
    state.books = state.books.map((b) => (b.id === book!.id ? book! : b));
  }

  const newLink: CommunityBookLinkDoc = {
    id: `lnk-${parsed.fileId.slice(0, 12)}-${now.toString(36)}`,
    book_id: book.id,
    drive_url: parsed.canonicalUrl,
    drive_file_id: parsed.fileId,
    format: input.format,
    success_count: 1,
    good_votes: 0,
    fail_count: 0,
    consecutive_fails: 0,
    score: computeLinkScore(1, 0, 0),
    is_active: true,
    created_at: now,
  };

  state.links = [newLink, ...state.links];
  persistLocalCommunityState(state.books, state.links);

  // Best-effort Firestore write
  try {
    const client = await getFirestoreClient();
    if (client) {
      const { db, firestoreMod } = client;
      await firestoreMod.setDoc(firestoreMod.doc(db, 'books', book.id), book, { merge: true });
      await firestoreMod.setDoc(firestoreMod.doc(db, 'book_links', newLink.id), newLink);
    }
  } catch {
    // Kept in local/RAM cache cleanly
  }

  const activeLinks = rankActiveLinks(state.links.filter((l) => l.book_id === book!.id));
  return {
    ok: true,
    item: {
      book,
      links: activeLinks,
      bestLink: activeLinks[0] || newLink,
    },
  };
}

export async function recordLinkFeedback(
  bookId: string,
  linkId: string,
  action: 'success' | 'good_vote' | 'fail'
): Promise<CommunityBookWithLinks[]> {
  const state = readLocalCommunityState();

  state.links = state.links.map((link) => {
    if (link.id !== linkId) return link;
    const success_count = action === 'success' ? link.success_count + 1 : link.success_count;
    const good_votes = action === 'good_vote' ? link.good_votes + 1 : link.good_votes;
    const fail_count = action === 'fail' ? link.fail_count + 1 : link.fail_count;
    const consecutive_fails = action === 'fail' ? link.consecutive_fails + 1 : 0;
    const score = computeLinkScore(success_count, good_votes, fail_count);
    const is_active = shouldLinkStayActive(consecutive_fails);

    const updated: CommunityBookLinkDoc = {
      ...link,
      success_count,
      good_votes,
      fail_count,
      consecutive_fails,
      score,
      is_active,
    };

    // Best-effort Firestore update
    void getFirestoreClient().then((client) => {
      if (!client) return;
      const { db, firestoreMod } = client;
      firestoreMod
        .updateDoc(firestoreMod.doc(db, 'book_links', link.id), {
          success_count,
          good_votes,
          fail_count,
          consecutive_fails,
          score,
          is_active,
        })
        .catch(() => {});
    });

    return updated;
  });

  if (action === 'success') {
    state.books = state.books.map((book) => {
      if (book.id !== bookId) return book;
      const downloads = (book.downloads || 0) + 1;
      void getFirestoreClient().then((client) => {
        if (!client) return;
        const { db, firestoreMod } = client;
        firestoreMod
          .updateDoc(firestoreMod.doc(db, 'books', book.id), {
            downloads,
            updated_at: Date.now(),
          })
          .catch(() => {});
      });
      return { ...book, downloads, updated_at: Date.now() };
    });
  }

  persistLocalCommunityState(state.books, state.links);
  return mergeBooksAndLinks(state.books, state.links);
}
