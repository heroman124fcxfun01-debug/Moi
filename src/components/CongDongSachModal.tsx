import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  BookOpen,
  Check,
  Download,
  Loader2,
  MessageSquare,
  Search,
  Send,
  Shield,
  Star,
  Upload,
  X,
} from 'lucide-react';
import type { Book } from '../types/book';
import { resolveApiUrl } from '../utils/apiClient';
import { computeBookFingerprint } from '../utils/syncAndStats';

interface CongDongComment {
  id: string;
  authorAlias: string;
  content: string;
  rating: number;
  createdAt: number;
}

interface CongDongBookSummary {
  id: string;
  title: string;
  author: string;
  uploaderAlias: string;
  category: string;
  description: string;
  coverGradient: string;
  coverImage?: string;
  downloads: number;
  uploadedAt: number;
  chapterCount: number;
  commentCount: number;
}

interface CongDongBookDetail extends CongDongBookSummary {
  chapters: Array<{ title: string; paragraphs: string[] }>;
  comments: CongDongComment[];
}

interface CongDongSachModalProps {
  open: boolean;
  localBooks: Book[];
  onClose: () => void;
  onImportBook: (book: Book, openImmediately?: boolean) => Promise<void>;
}

const LOCAL_FALLBACK_KEY = 'bookhad_congdongsach_cache_v1';

const OFFLINE_FALLBACK_BOOKS: CongDongBookDetail[] = [
  {
    id: 'cds-offline-1',
    title: 'Hành Trình Về Phương Đông (Bản Cộng Đồng)',
    author: 'Baird T. Spalding',
    uploaderAlias: 'Độc Giả Ẩn Danh #104',
    category: 'Tản văn & Triết lý',
    description: 'Bản biên tập tối ưu cho giọng đọc AI tiểu thuyết & tản văn trên BOOKHAD.',
    coverGradient: 'from-amber-800 via-stone-800 to-zinc-900',
    downloads: 1284,
    uploadedAt: Date.now() - 86_400_000 * 6,
    chapterCount: 1,
    commentCount: 1,
    chapters: [
      {
        title: 'Chương 1: Khởi hành giữa mùa gió chướng',
        paragraphs: [
          'Đoàn thám hiểm rời bến cảng vào một buổi sáng sương giăng trắng xóa.',
          '"Khi tâm trí thôi ồn ào, từng nhịp thở cũng trở thành một trang sách," vị đạo sư mỉm cười nói.',
        ],
      },
    ],
    comments: [
      {
        id: 'off-cmt-1',
        authorAlias: 'Người Đọc Đêm',
        content: 'Bản này ngắt đoạn cực gọn, bật giọng Tản văn nghe rất êm.',
        rating: 5,
        createdAt: Date.now() - 86_400_000 * 2,
      },
    ],
  },
];

function loadOfflineFallback(): CongDongBookDetail[] {
  try {
    const raw = localStorage.getItem(LOCAL_FALLBACK_KEY);
    if (!raw) return OFFLINE_FALLBACK_BOOKS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : OFFLINE_FALLBACK_BOOKS;
  } catch {
    return OFFLINE_FALLBACK_BOOKS;
  }
}

function saveOfflineFallback(list: CongDongBookDetail[]) {
  try {
    localStorage.setItem(LOCAL_FALLBACK_KEY, JSON.stringify(list));
  } catch {
    // ignore quota errors
  }
}

export function CongDongSachModal({
  open,
  localBooks,
  onClose,
  onImportBook,
}: CongDongSachModalProps) {
  const [books, setBooks] = useState<CongDongBookSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Active subview: list | detail | upload
  const [viewMode, setViewMode] = useState<'list' | 'detail' | 'upload'>('list');
  const [selectedBook, setSelectedBook] = useState<CongDongBookDetail | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadedIds, setDownloadedIds] = useState<Record<string, boolean>>({});

  // Comment form
  const [commentAlias, setCommentAlias] = useState('');
  const [commentText, setCommentText] = useState('');
  const [commentRating, setCommentRating] = useState(5);
  const [isPostingComment, setIsPostingComment] = useState(false);

  // Upload form
  const [uploadSource, setUploadSource] = useState<'library' | 'manual'>('library');
  const [selectedLibraryBookId, setSelectedLibraryBookId] = useState<string>('');
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadAuthor, setUploadAuthor] = useState('');
  const [uploadAlias, setUploadAlias] = useState('');
  const [uploadCategory, setUploadCategory] = useState('Tiểu thuyết');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadContent, setUploadContent] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  const fetchBooks = useCallback(async (query = '') => {
    setIsLoading(true);
    try {
      const res = await fetch(
        resolveApiUrl(`/api/congdongsach/books?q=${encodeURIComponent(query.trim())}`)
      );
      if (!res.ok) throw new Error('offline');
      const data = (await res.json()) as { books?: CongDongBookSummary[] };
      setBooks(data.books || []);
      setIsOfflineMode(false);
    } catch {
      const local = loadOfflineFallback();
      const q = query.trim().toLowerCase();
      const filtered = q
        ? local.filter(
            (b) =>
              b.title.toLowerCase().includes(q) ||
              b.author.toLowerCase().includes(q) ||
              b.category.toLowerCase().includes(q)
          )
        : local;
      setBooks(filtered);
      setIsOfflineMode(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setViewMode('list');
    setSelectedBook(null);
    setStatusMessage(null);
    if (localBooks.length > 0 && !selectedLibraryBookId) {
      setSelectedLibraryBookId(localBooks[0].id);
    }
    void fetchBooks(searchQuery);
  }, [open, fetchBooks]);

  // Debounced search
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      void fetchBooks(searchQuery);
    }, 220);
    return () => window.clearTimeout(t);
  }, [searchQuery, open, fetchBooks]);

  if (!open) return null;

  const openBookDetail = async (id: string) => {
    setIsDetailLoading(true);
    setViewMode('detail');
    try {
      const res = await fetch(resolveApiUrl(`/api/congdongsach/books/${encodeURIComponent(id)}`));
      if (!res.ok) throw new Error('offline');
      const data = (await res.json()) as { book: CongDongBookDetail };
      setSelectedBook({
        ...data.book,
        chapterCount: data.book.chapters.length,
        commentCount: data.book.comments.length,
      });
    } catch {
      const local = loadOfflineFallback().find((b) => b.id === id) || null;
      setSelectedBook(local);
    } finally {
      setIsDetailLoading(false);
    }
  };

  const handleDownloadBook = async (id: string) => {
    setDownloadingId(id);
    setStatusMessage(null);
    try {
      let detail: CongDongBookDetail | null = null;
      if (!isOfflineMode) {
        const res = await fetch(
          resolveApiUrl(`/api/congdongsach/books/${encodeURIComponent(id)}/download`)
        );
        if (res.ok) {
          const data = (await res.json()) as { book: CongDongBookDetail };
          detail = data.book;
        }
      }
      if (!detail) {
        detail = loadOfflineFallback().find((b) => b.id === id) || selectedBook;
      }
      if (!detail) throw new Error('Không tải được nội dung sách.');

      const chapters = (detail.chapters || []).map((ch, idx) => ({
        id: `cds-ch-${idx}-${Date.now()}`,
        index: idx,
        title: ch.title || `Chương ${idx + 1}`,
        paragraphs: ch.paragraphs && ch.paragraphs.length > 0 ? ch.paragraphs : [detail!.description],
      }));

      const bookPayload: Book = {
        id: `book-cds-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title: detail.title,
        author: detail.author,
        description: detail.description,
        language: 'vi',
        sourceType: 'web',
        coverUrl: detail.coverImage,
        collection: 'congdongsach',
        chapters,
        currentChapterIndex: 0,
        currentParagraphIndex: 0,
        progressPercent: 0,
        bookmarks: [],
        highlights: [],
        voiceAssignments: {},
        addedAt: Date.now(),
        lastReadAt: Date.now(),
      };
      bookPayload.fingerprint = computeBookFingerprint(bookPayload);

      await onImportBook(bookPayload, false);
      setDownloadedIds((prev) => ({ ...prev, [id]: true }));
      setBooks((prev) =>
        prev.map((b) => (b.id === id ? { ...b, downloads: b.downloads + 1 } : b))
      );
      if (selectedBook?.id === id) {
        setSelectedBook((prev) => (prev ? { ...prev, downloads: prev.downloads + 1 } : prev));
      }
      setStatusMessage(`Đã tải "${detail.title}" từ congdongsach vào Thư viện BOOKHAD!`);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Lỗi tải sách từ congdongsach.');
    } finally {
      setDownloadingId(null);
    }
  };

  const handlePostComment = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedBook || !commentText.trim()) return;
    setIsPostingComment(true);
    try {
      let createdComment: CongDongComment;
      if (!isOfflineMode) {
        const res = await fetch(
          resolveApiUrl(`/api/congdongsach/books/${encodeURIComponent(selectedBook.id)}/comments`),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              authorAlias: commentAlias.trim() || 'Độc giả ẩn danh',
              content: commentText.trim(),
              rating: commentRating,
            }),
          }
        );
        if (!res.ok) throw new Error('Không gửi được bình luận.');
        const data = (await res.json()) as { comment: CongDongComment };
        createdComment = data.comment;
      } else {
        createdComment = {
          id: `cmt-local-${Date.now()}`,
          authorAlias: commentAlias.trim() || 'Độc giả ẩn danh',
          content: commentText.trim(),
          rating: commentRating,
          createdAt: Date.now(),
        };
        const cache = loadOfflineFallback().map((b) =>
          b.id === selectedBook.id
            ? { ...b, comments: [createdComment, ...b.comments], commentCount: b.comments.length + 1 }
            : b
        );
        saveOfflineFallback(cache);
      }

      setSelectedBook((prev) =>
        prev
          ? {
              ...prev,
              comments: [createdComment, ...(prev.comments || [])],
              commentCount: (prev.comments?.length || 0) + 1,
            }
          : prev
      );
      setBooks((prev) =>
        prev.map((b) =>
          b.id === selectedBook.id ? { ...b, commentCount: b.commentCount + 1 } : b
        )
      );
      setCommentText('');
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Không thể gửi bình luận.');
    } finally {
      setIsPostingComment(false);
    }
  };

  const handleUploadSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsUploading(true);
    setStatusMessage(null);
    try {
      let payload: {
        title: string;
        author: string;
        uploaderAlias: string;
        category: string;
        description: string;
        coverGradient?: string;
        coverImage?: string;
        chapters: Array<{ title: string; paragraphs: string[] }>;
      };

      if (uploadSource === 'library') {
        const picked = localBooks.find((b) => b.id === selectedLibraryBookId);
        if (!picked) throw new Error('Vui lòng chọn 1 cuốn sách trong thư viện để đăng lên.');
        payload = {
          title: uploadTitle.trim() || picked.title,
          author: uploadAuthor.trim() || picked.author || 'Tác giả ẩn danh',
          uploaderAlias: uploadAlias.trim() || 'Độc giả ẩn danh',
          category: uploadCategory.trim() || picked.collection || 'Cộng đồng chia sẻ',
          description:
            uploadDescription.trim() ||
            picked.description ||
            `Sách gồm ${picked.chapters.length} chương được chia sẻ ẩn danh lên congdongsach.`,
          coverImage: picked.coverUrl,
          chapters: picked.chapters.slice(0, 80).map((ch) => ({
            title: ch.title,
            paragraphs: ch.paragraphs,
          })),
        };
      } else {
        const title = uploadTitle.trim();
        const paragraphs = uploadContent
          .split(/\n+/)
          .map((p) => p.trim())
          .filter(Boolean);
        if (!title || paragraphs.length === 0) {
          throw new Error('Vui lòng nhập tên sách và nội dung trước khi đăng lên congdongsach.');
        }
        payload = {
          title,
          author: uploadAuthor.trim() || 'Tác giả ẩn danh',
          uploaderAlias: uploadAlias.trim() || 'Độc giả ẩn danh',
          category: uploadCategory.trim() || 'Cộng đồng chia sẻ',
          description:
            uploadDescription.trim() || paragraphs[0].slice(0, 140),
          chapters: [{ title: 'Chương 1', paragraphs }],
        };
      }

      if (!isOfflineMode) {
        const res = await fetch(resolveApiUrl('/api/congdongsach/books'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error || 'Không đăng được sách lên congdongsach.');
        }
      } else {
        const localRecord: CongDongBookDetail = {
          id: `cds-local-${Date.now()}`,
          ...payload,
          coverGradient: payload.coverGradient || 'from-amber-800 via-stone-800 to-zinc-900',
          downloads: 0,
          uploadedAt: Date.now(),
          chapterCount: payload.chapters.length,
          commentCount: 0,
          comments: [],
        };
        const updated = [localRecord, ...loadOfflineFallback()];
        saveOfflineFallback(updated);
      }

      setUploadTitle('');
      setUploadAuthor('');
      setUploadDescription('');
      setUploadContent('');
      setViewMode('list');
      setStatusMessage(`Đã đăng ẩn danh "${payload.title}" lên congdongsach thành công!`);
      await fetchBooks(searchQuery);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Lỗi đăng sách.');
    } finally {
      setIsUploading(false);
    }
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-50 ios-frosted-backdrop flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="congdongsach - Cộng đồng sách ẩn danh"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-xl h-[92vh] sm:h-[85vh] rounded-t-[28px] sm:rounded-[28px] ios-frosted-surface flex flex-col overflow-hidden animate-ios-sheet"
      >
        {/* Top iPhone Glass Header */}
        <div className="px-4 py-3 border-b border-stone-200/70 dark:border-zinc-800/80 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {viewMode !== 'list' && (
              <button
                type="button"
                onClick={() => {
                  setViewMode('list');
                  setSelectedBook(null);
                }}
                className="p-1.5 rounded-full bg-stone-100/90 dark:bg-zinc-800/90 text-stone-700 dark:text-stone-200 hover:bg-stone-200/80 shrink-0"
                aria-label="Quay lại danh sách congdongsach"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div className="w-8 h-8 rounded-2xl bg-gradient-to-br from-amber-700 to-stone-900 flex items-center justify-center text-white shrink-0 shadow-xs">
              <Shield className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h2 className="text-sm font-bold text-stone-900 dark:text-stone-100 truncate">
                  congdongsach
                </h2>
                <span className="px-1.5 py-0.5 rounded-full bg-amber-800/10 dark:bg-amber-400/15 text-[9px] font-semibold text-amber-900 dark:text-amber-300">
                  Ẩn danh
                </span>
              </div>
              <p className="text-[10px] text-stone-500 dark:text-stone-400 truncate">
                Kho sách cộng đồng chia sẻ, tải về & bình luận tự do
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng congdongsach"
            className="p-1.5 rounded-full bg-stone-100/90 dark:bg-zinc-800/90 text-stone-500 hover:text-stone-900 dark:hover:text-white shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Status Toast */}
        {statusMessage && (
          <div className="mx-4 mt-2.5 px-3 py-2 rounded-2xl bg-emerald-50/90 dark:bg-emerald-950/50 border border-emerald-200/80 dark:border-emerald-800/70 text-[11px] text-emerald-800 dark:text-emerald-200 flex items-center justify-between gap-2 shrink-0">
            <span className="truncate">{statusMessage}</span>
            <button
              type="button"
              onClick={() => setStatusMessage(null)}
              className="p-0.5 text-emerald-600 hover:text-emerald-900 shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* VIEW 1: BOOK LIST + SEARCH + UPLOAD CTA */}
        {viewMode === 'list' && (
          <>
            <div className="px-4 py-3 flex items-center gap-2 shrink-0">
              <div className="relative flex-1 min-w-0">
                <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Tìm sách trên congdongsach..."
                  className="w-full pl-8 pr-3 py-2 rounded-2xl bg-white/80 dark:bg-zinc-900/80 border border-stone-200/80 dark:border-zinc-700/80 text-xs text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-600/35"
                />
              </div>
              <button
                type="button"
                onClick={() => setViewMode('upload')}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-amber-800 hover:bg-amber-900 text-white text-[11px] font-semibold shadow-xs transition-all active:scale-95 whitespace-nowrap shrink-0"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Up sách lên web</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 pb-5 space-y-2.5">
              {isLoading ? (
                <div className="py-12 flex flex-col items-center justify-center gap-2 text-stone-500">
                  <Loader2 className="w-5 h-5 animate-spin text-amber-700" />
                  <span className="text-xs">Đang kết nối congdongsach...</span>
                </div>
              ) : books.length === 0 ? (
                <div className="py-12 text-center space-y-2">
                  <BookOpen className="w-8 h-8 mx-auto text-stone-300 dark:text-zinc-600" />
                  <p className="text-xs text-stone-500">Không tìm thấy sách phù hợp trên congdongsach.</p>
                </div>
              ) : (
                books.map((book) => {
                  const isDownloaded = Boolean(downloadedIds[book.id]);
                  const isBusy = downloadingId === book.id;
                  return (
                    <div
                      key={book.id}
                      onClick={() => openBookDetail(book.id)}
                      className="group cursor-pointer rounded-2xl p-2.5 bg-white/75 dark:bg-zinc-900/75 border border-stone-200/75 dark:border-zinc-800/80 hover:border-amber-600/50 transition-all flex items-center gap-3"
                    >
                      <div
                        className={`w-12 h-16 rounded-xl bg-gradient-to-br ${book.coverGradient} shrink-0 overflow-hidden shadow-xs flex items-end p-1.5 relative`}
                      >
                        {book.coverImage ? (
                          <img
                            src={book.coverImage}
                            alt={book.title}
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-[8px] font-bold text-white/90 line-clamp-2 leading-tight">
                            {book.title}
                          </span>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <h3 className="text-xs font-bold text-stone-900 dark:text-stone-100 truncate">
                          {book.title}
                        </h3>
                        <p className="text-[11px] text-stone-500 dark:text-stone-400 truncate mt-0.5">
                          {book.author} · {book.uploaderAlias}
                        </p>
                        <div className="mt-1.5 flex items-center gap-2.5 text-[10px] text-stone-500 dark:text-stone-400">
                          <span className="inline-flex items-center gap-0.5">
                            <Download className="w-3 h-3 text-amber-700 dark:text-amber-400" />
                            {book.downloads}
                          </span>
                          <span className="inline-flex items-center gap-0.5">
                            <MessageSquare className="w-3 h-3 text-sky-600 dark:text-sky-400" />
                            {book.commentCount} bình luận
                          </span>
                          <span className="truncate text-stone-400">{book.chapterCount} ch</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDownloadBook(book.id);
                        }}
                        className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold transition-all active:scale-95 shrink-0 ${
                          isDownloaded
                            ? 'bg-emerald-600 text-white'
                            : 'bg-amber-800/12 dark:bg-amber-400/15 text-amber-900 dark:text-amber-300 hover:bg-amber-800 hover:text-white'
                        }`}
                      >
                        {isBusy ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : isDownloaded ? (
                          <Check className="w-3.5 h-3.5" />
                        ) : (
                          <Download className="w-3.5 h-3.5" />
                        )}
                        <span>{isDownloaded ? 'Đã tải' : 'Tải về'}</span>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

        {/* VIEW 2: BOOK DETAIL + COMMENTS */}
        {viewMode === 'detail' && (
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
            {isDetailLoading || !selectedBook ? (
              <div className="py-12 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-amber-700" />
              </div>
            ) : (
              <>
                <div className="rounded-2xl p-3.5 bg-white/75 dark:bg-zinc-900/75 border border-stone-200/75 dark:border-zinc-800/80 flex gap-3">
                  <div
                    className={`w-16 h-22 rounded-xl bg-gradient-to-br ${selectedBook.coverGradient} shrink-0 overflow-hidden shadow-sm relative flex items-end p-1.5`}
                  >
                    {selectedBook.coverImage ? (
                      <img
                        src={selectedBook.coverImage}
                        alt={selectedBook.title}
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-[9px] font-bold text-white/90 line-clamp-3 leading-tight">
                        {selectedBook.title}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <span className="inline-block px-2 py-0.5 rounded-full bg-stone-100 dark:bg-zinc-800 text-[10px] font-medium text-stone-600 dark:text-stone-300">
                      {selectedBook.category}
                    </span>
                    <h3 className="text-sm font-bold text-stone-900 dark:text-stone-100 leading-snug">
                      {selectedBook.title}
                    </h3>
                    <p className="text-[11px] text-stone-500">
                      Tác giả: {selectedBook.author} · Đăng bởi: {selectedBook.uploaderAlias}
                    </p>
                    <div className="pt-1 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={downloadingId === selectedBook.id}
                        onClick={() => handleDownloadBook(selectedBook.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-800 hover:bg-amber-900 text-white text-xs font-semibold shadow-xs transition-all active:scale-95"
                      >
                        {downloadingId === selectedBook.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Download className="w-3.5 h-3.5" />
                        )}
                        <span>Tải về Thư viện ({selectedBook.downloads})</span>
                      </button>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl p-3 bg-white/65 dark:bg-zinc-900/65 border border-stone-200/70 dark:border-zinc-800/70 text-xs text-stone-700 dark:text-stone-300 leading-relaxed">
                  {selectedBook.description}
                </div>

                {/* Comment Composer */}
                <form
                  onSubmit={handlePostComment}
                  className="rounded-2xl p-3 bg-white/80 dark:bg-zinc-900/80 border border-stone-200/80 dark:border-zinc-800/80 space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-stone-900 dark:text-stone-100 inline-flex items-center gap-1.5">
                      <MessageSquare className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
                      Bình luận về sách ({selectedBook.comments?.length || 0})
                    </span>
                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => setCommentRating(star)}
                          className="p-0.5"
                          aria-label={`Đánh giá ${star} sao`}
                        >
                          <Star
                            className={`w-3.5 h-3.5 ${
                              star <= commentRating
                                ? 'fill-amber-500 text-amber-500'
                                : 'text-stone-300 dark:text-zinc-600'
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                  <input
                    type="text"
                    value={commentAlias}
                    onChange={(e) => setCommentAlias(e.target.value)}
                    placeholder="Biệt danh ẩn danh (để trống = Độc giả ẩn danh)"
                    className="w-full px-3 py-1.5 rounded-xl bg-stone-50/90 dark:bg-zinc-950/70 border border-stone-200/80 dark:border-zinc-700/80 text-xs"
                  />
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      placeholder="Viết cảm nhận, review hoặc gợi ý giọng đọc..."
                      className="flex-1 px-3 py-2 rounded-xl bg-stone-50/90 dark:bg-zinc-950/70 border border-stone-200/80 dark:border-zinc-700/80 text-xs"
                    />
                    <button
                      type="submit"
                      disabled={isPostingComment || !commentText.trim()}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-amber-800 hover:bg-amber-900 disabled:opacity-45 text-white text-xs font-semibold shrink-0"
                    >
                      {isPostingComment ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Send className="w-3.5 h-3.5" />
                      )}
                      <span>Gửi</span>
                    </button>
                  </div>
                </form>

                {/* Comment List */}
                <div className="space-y-2 pb-4">
                  {(selectedBook.comments || []).length === 0 ? (
                    <p className="text-center text-xs text-stone-400 py-4">
                      Chưa có bình luận nào. Hãy là người đầu tiên nhận xét cuốn sách này!
                    </p>
                  ) : (
                    selectedBook.comments.map((cmt) => (
                      <div
                        key={cmt.id}
                        className="rounded-2xl p-3 bg-white/70 dark:bg-zinc-900/70 border border-stone-200/70 dark:border-zinc-800/70 space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-bold text-stone-800 dark:text-stone-100">
                            {cmt.authorAlias}
                          </span>
                          <span className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold">
                            {'★'.repeat(cmt.rating)}
                          </span>
                        </div>
                        <p className="text-xs text-stone-700 dark:text-stone-300 leading-relaxed">
                          {cmt.content}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* VIEW 3: ANONYMOUS BOOK UPLOADER */}
        {viewMode === 'upload' && (
          <form
            onSubmit={handleUploadSubmit}
            className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
          >
            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-2xl bg-stone-200/70 dark:bg-zinc-800/80">
              <button
                type="button"
                onClick={() => setUploadSource('library')}
                className={`py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  uploadSource === 'library'
                    ? 'bg-white dark:bg-zinc-900 text-amber-800 dark:text-amber-300 shadow-xs'
                    : 'text-stone-600 dark:text-stone-400'
                }`}
              >
                Chọn từ Thư viện
              </button>
              <button
                type="button"
                onClick={() => setUploadSource('manual')}
                className={`py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  uploadSource === 'manual'
                    ? 'bg-white dark:bg-zinc-900 text-amber-800 dark:text-amber-300 shadow-xs'
                    : 'text-stone-600 dark:text-stone-400'
                }`}
              >
                Dán / Nhập sách mới
              </button>
            </div>

            {uploadSource === 'library' && (
              <label className="block space-y-1">
                <span className="text-[11px] font-semibold text-stone-700 dark:text-stone-300">
                  Chọn sách trong Thư viện BOOKHAD để up lên congdongsach
                </span>
                <select
                  value={selectedLibraryBookId}
                  onChange={(e) => setSelectedLibraryBookId(e.target.value)}
                  className="w-full px-3 py-2 rounded-2xl bg-white/85 dark:bg-zinc-900/85 border border-stone-200 dark:border-zinc-700 text-xs"
                >
                  {localBooks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title} ({b.chapters.length} chương)
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <input
                type="text"
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                placeholder={
                  uploadSource === 'library'
                    ? 'Đổi tên sách (tùy chọn)'
                    : 'Tên sách *'
                }
                className="w-full px-3 py-2 rounded-2xl bg-white/85 dark:bg-zinc-900/85 border border-stone-200 dark:border-zinc-700 text-xs"
              />
              <input
                type="text"
                value={uploadAuthor}
                onChange={(e) => setUploadAuthor(e.target.value)}
                placeholder="Tác giả"
                className="w-full px-3 py-2 rounded-2xl bg-white/85 dark:bg-zinc-900/85 border border-stone-200 dark:border-zinc-700 text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <input
                type="text"
                value={uploadAlias}
                onChange={(e) => setUploadAlias(e.target.value)}
                placeholder="Biệt danh ẩn danh"
                className="w-full px-3 py-2 rounded-2xl bg-white/85 dark:bg-zinc-900/85 border border-stone-200 dark:border-zinc-700 text-xs"
              />
              <input
                type="text"
                value={uploadCategory}
                onChange={(e) => setUploadCategory(e.target.value)}
                placeholder="Thể loại"
                className="w-full px-3 py-2 rounded-2xl bg-white/85 dark:bg-zinc-900/85 border border-stone-200 dark:border-zinc-700 text-xs"
              />
            </div>

            <input
              type="text"
              value={uploadDescription}
              onChange={(e) => setUploadDescription(e.target.value)}
              placeholder="Mô tả ngắn giới thiệu sách..."
              className="w-full px-3 py-2 rounded-2xl bg-white/85 dark:bg-zinc-900/85 border border-stone-200 dark:border-zinc-700 text-xs"
            />

            {uploadSource === 'manual' && (
              <textarea
                rows={6}
                value={uploadContent}
                onChange={(e) => setUploadContent(e.target.value)}
                placeholder="Dán nội dung sách tại đây (mỗi đoạn 1 dòng)..."
                className="w-full px-3 py-2 rounded-2xl bg-white/85 dark:bg-zinc-900/85 border border-stone-200 dark:border-zinc-700 text-xs resize-none"
              />
            )}

            <button
              type="submit"
              disabled={isUploading}
              className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-2xl bg-amber-800 hover:bg-amber-900 disabled:opacity-45 text-white text-xs font-semibold shadow-sm transition-all active:scale-[0.98]"
            >
              {isUploading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              <span>Đăng ẩn danh lên congdongsach</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
}
