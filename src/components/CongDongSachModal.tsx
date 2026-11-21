import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  ClipboardPaste,
  Copy,
  Download,
  Flag,
  Loader2,
  Plus,
  Search,
  Shield,
  X,
} from 'lucide-react';
import type { Book } from '../types/book';
import {
  filterCommunityBooks,
  getCachedCommunityBooksWithLinks,
  listCommunityBooksWithLinks,
  parseGoogleDriveLink,
  recordLinkFeedback,
  submitAnonymousBookShare,
  type CommunityBookWithLinks,
  type CommunityFormat,
} from '../utils/communityDriveStore';
import { resolveApiUrl } from '../utils/apiClient';
import { IosSheet } from './IosSheet';

interface CongDongSachModalProps {
  open: boolean;
  localBooks: Book[];
  onClose: () => void;
  onImportBook: (book: Book, openImmediately?: boolean) => Promise<void>;
}

const FILTER_CHIPS = [
  'Mới nhất',
  'Tải nhiều',
  'Tiên hiệp',
  'Ngôn tình',
  'Kinh dị',
  'EPUB',
  'PDF',
] as const;

const GENRE_OPTIONS = ['Tiên hiệp', 'Ngôn tình', 'Kinh dị', 'Kỹ năng', 'Tiểu thuyết', 'Tản văn'];
const FORMAT_OPTIONS: CommunityFormat[] = ['EPUB', 'PDF', 'TXT'];

export function CongDongSachModal({
  open,
  localBooks,
  onClose,
  onImportBook,
}: CongDongSachModalProps) {
  const [items, setItems] = useState<CommunityBookWithLinks[]>(() =>
    getCachedCommunityBooksWithLinks()
  );
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [activeChip, setActiveChip] = useState<string>('Mới nhất');
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Share Bottom Sheet State
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [shareTitle, setShareTitle] = useState('');
  const [shareAuthor, setShareAuthor] = useState('');
  const [shareGenre, setShareGenre] = useState('Tiên hiệp');
  const [shareFormat, setShareFormat] = useState<CommunityFormat>('EPUB');
  const [shareDriveUrl, setShareDriveUrl] = useState('');
  const [shareError, setShareError] = useState('');
  const [isSubmittingShare, setIsSubmittingShare] = useState(false);

  const showToast = useCallback((kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text });
    window.setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, 3200);
  }, []);

  const refreshCatalog = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await listCommunityBooksWithLinks();
      setItems(list);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refreshCatalog();
  }, [open, refreshCatalog]);

  const filteredItems = useMemo(
    () => filterCommunityBooks(items, searchQuery, activeChip),
    [items, searchQuery, activeChip]
  );

  // Instant diacritic-insensitive live suggestions
  const suggestions = useMemo(() => {
    if (!searchFocused || !searchQuery.trim()) return [];
    return filterCommunityBooks(items, searchQuery, 'Mới nhất').slice(0, 5);
  }, [items, searchFocused, searchQuery]);

  const handleCopyDriveLink = async (item: CommunityBookWithLinks) => {
    if (!item.bestLink) return;
    try {
      await navigator.clipboard.writeText(item.bestLink.drive_url);
      setCopiedId(item.book.id);
      showToast('ok', 'Đã sao chép link Google Drive.');
      window.setTimeout(() => setCopiedId((id) => (id === item.book.id ? null : id)), 1800);
    } catch {
      showToast('err', 'Không thể sao chép vào bộ nhớ tạm.');
    }
  };

  const handleReportBroken = async (item: CommunityBookWithLinks) => {
    if (!item.bestLink) return;
    const updated = await recordLinkFeedback(item.book.id, item.bestLink.id, 'fail');
    setItems(updated);
    showToast('ok', 'Đã báo lỗi link. Hệ thống sẽ tự động hạ điểm hoặc ẩn link hỏng.');
  };

  const handleDownloadBook = async (item: CommunityBookWithLinks) => {
    if (!item.links.length) return;
    setDownloadingId(item.book.id);

    try {
      let succeededLink = item.bestLink;
      let downloadedText = '';

      // Auto-fallback across ranked active links if 403/404 occurs
      for (const candidate of item.links) {
        const parsed = parseGoogleDriveLink(candidate.drive_url);
        if (!parsed.valid) {
          const next = await recordLinkFeedback(item.book.id, candidate.id, 'fail');
          setItems(next);
          continue;
        }

        try {
          const probeRes = await fetch(resolveApiUrl('/api/web/fetch'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: parsed.directDownloadUrl }),
          });
          if (probeRes.status === 403 || probeRes.status === 404) {
            const next = await recordLinkFeedback(item.book.id, candidate.id, 'fail');
            setItems(next);
            continue;
          }
          if (probeRes.ok) {
            const data = await probeRes.json().catch(() => null);
            if (data?.paragraphs?.length) {
              downloadedText = data.paragraphs.join('\n\n');
            }
          }
          succeededLink = candidate;
          break;
        } catch {
          succeededLink = candidate;
          break;
        }
      }

      if (!succeededLink) {
        showToast('err', 'Tất cả link của sách này hiện không khả dụng (403/404).');
        return;
      }

      const updated = await recordLinkFeedback(item.book.id, succeededLink.id, 'success');
      setItems(updated);

      const alreadyOwned = localBooks.some(
        (b) => b.title.trim().toLowerCase() === item.book.title.trim().toLowerCase()
      );

      if (!alreadyOwned) {
        const now = Date.now();
        const bookId = `comm-${item.book.id}-${now.toString(36)}`;
        const paragraphs = downloadedText
          ? downloadedText.split(/\n{2,}/).filter((p) => p.trim().length > 0)
          : [
              `Sách "${item.book.title}" của tác giả ${item.book.author} (${item.book.genre} · ${item.book.format}).`,
              `Liên kết Google Drive gốc: ${succeededLink.drive_url}`,
              'Bạn có thể mở liên kết Drive trên máy để tải tệp đầy đủ hoặc đọc ngay bản tóm tắt này trong BOOKHAD.',
            ];

        const imported: Book = {
          id: bookId,
          title: item.book.title,
          author: item.book.author,
          description: `Chia sẻ ẩn danh cộng đồng · ${item.book.genre}`,
          coverUrl: '',
          sourceType: item.book.format === 'PDF' ? 'pdf' : 'epub',
          language: 'vi',
          readingStyle: 'novel',
          chapters: [
            {
              id: `${bookId}-ch-1`,
              index: 0,
              title: 'Chương 1',
              paragraphs,
            },
          ],
          currentChapterIndex: 0,
          currentParagraphIndex: 0,
          progressPercent: 0,
          bookmarks: [],
          highlights: [],
          addedAt: now,
          lastReadAt: now,
          voiceAssignments: {},
          characterVoicesEnabled: false,
          characterVoicesConfigured: false,
          driveFileId: succeededLink.drive_file_id,
        };
        await onImportBook(imported, false);
      }

      showToast('ok', `Đã thêm "${item.book.title}" vào Kho sách riêng.`);
    } finally {
      setDownloadingId(null);
    }
  };

  const handlePasteDriveUrl = async () => {
    setShareError('');
    try {
      const text = await navigator.clipboard.readText();
      if (text?.trim()) {
        setShareDriveUrl(text.trim());
      } else {
        setShareError('Bộ nhớ tạm đang trống.');
      }
    } catch {
      setShareError('Hãy chạm giữ ô nhập để dán link Google Drive.');
    }
  };

  const handleSubmitShare = async (e: FormEvent) => {
    e.preventDefault();
    setShareError('');
    setIsSubmittingShare(true);
    try {
      const result = await submitAnonymousBookShare({
        title: shareTitle,
        author: shareAuthor,
        genre: shareGenre,
        format: shareFormat,
        driveUrl: shareDriveUrl,
      });
      if (!result.ok) {
        setShareError(result.error || 'Không thể đăng chia sẻ.');
        return;
      }

      const refreshed = await listCommunityBooksWithLinks();
      setItems(refreshed);
      setShareTitle('');
      setShareAuthor('');
      setShareDriveUrl('');
      setIsShareOpen(false);
      showToast('ok', 'Đã đăng sách ẩn danh thành công!');
    } finally {
      setIsSubmittingShare(false);
    }
  };

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      data-testid="community-anonymous-modal"
      className="fixed inset-0 z-[95] ios-frosted-backdrop ios-backdrop-fade flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Cộng đồng sách ẩn danh"
        className="ios-sheet-enter w-full sm:max-w-xl h-[92dvh] sm:h-[85dvh] rounded-t-[28px] sm:rounded-[26px] bg-[#F6F4EF] dark:bg-[#111317] text-stone-900 dark:text-stone-100 border border-stone-200/80 dark:border-white/10 shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Top Handle (mobile) */}
        <div className="sm:hidden flex justify-center pt-2 shrink-0">
          <span className="w-10 h-1 rounded-full bg-stone-400/50 dark:bg-stone-600/70" />
        </div>

        {/* Header Row: Title + Top-Right Accent Oval "+ Chia sẻ" + Close */}
        <div className="px-4 pt-3 pb-2.5 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-full bg-amber-800/10 dark:bg-amber-500/15 flex items-center justify-center shrink-0">
              <Shield className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-[14.5px] font-sans font-bold tracking-tight truncate">
                Kho sách Ẩn danh
              </h2>
              <p className="text-[10px] text-stone-500 dark:text-stone-400 truncate">
                Không cần đăng nhập · Chia sẻ qua link Drive
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              data-testid="community-open-share-btn"
              onClick={() => {
                setShareError('');
                setIsShareOpen(true);
              }}
              className="ios-elevated-oval ios-liquid-btn inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-amber-800 text-white text-[11px] font-semibold hover:bg-amber-900 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              <span>Chia sẻ</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng cộng đồng ẩn danh"
              className="w-8 h-8 rounded-full bg-white dark:bg-[#1C1E24] border border-stone-200 dark:border-stone-700 flex items-center justify-center text-stone-600 dark:text-stone-300"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Elevated Oval Full-Width Search Bar with Instant Live Suggestions */}
        <div className="px-4 pb-2.5 shrink-0 relative z-20">
          <div className="relative">
            <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              data-testid="community-search-input"
              value={searchQuery}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => window.setTimeout(() => setSearchFocused(false), 160)}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm tên sách, tác giả (gõ không dấu vẫn ra)..."
              className="ios-elevated-oval w-full pl-10 pr-9 py-2.5 rounded-full bg-white dark:bg-[#181A1F] border border-stone-200/90 dark:border-stone-800 text-[12px] text-stone-900 dark:text-stone-100 placeholder:text-stone-400 focus:outline-none focus:border-amber-700"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Xóa từ khóa tìm kiếm"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center text-stone-400 hover:text-stone-700"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {suggestions.length > 0 && (
            <div className="absolute left-4 right-4 mt-1.5 rounded-2xl bg-white dark:bg-[#181A1F] border border-stone-200 dark:border-stone-800 shadow-lg overflow-hidden">
              {suggestions.map((s) => (
                <button
                  key={s.book.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setSearchQuery(s.book.title);
                    setSearchFocused(false);
                  }}
                  className="w-full px-3.5 py-2 text-left text-[11.5px] hover:bg-stone-50 dark:hover:bg-stone-800/70 flex items-center justify-between gap-2 border-b last:border-b-0 border-stone-100 dark:border-stone-800/80"
                >
                  <span className="font-medium truncate">{s.book.title}</span>
                  <span className="text-[10px] text-stone-500 shrink-0">{s.book.author}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Horizontally Scrollable Elevated Oval Filter Chips */}
        <div className="px-4 pb-2.5 shrink-0">
          <div
            role="tablist"
            aria-label="Bộ lọc sách cộng đồng"
            className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar"
          >
            {FILTER_CHIPS.map((chip) => {
              const active = activeChip === chip;
              return (
                <button
                  key={chip}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-testid={`community-chip-${chip}`}
                  onClick={() => setActiveChip(chip)}
                  className={`ios-elevated-oval px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap border transition-colors shrink-0 ${
                    active
                      ? 'bg-amber-800 text-white border-amber-800'
                      : 'bg-white dark:bg-[#181A1F] text-stone-700 dark:text-stone-300 border-stone-200/90 dark:border-stone-800 hover:border-amber-700'
                  }`}
                >
                  {chip}
                </button>
              );
            })}
          </div>
        </div>

        {/* Toast Banner */}
        {toast && (
          <div className="px-4 pb-2 shrink-0">
            <div
              className={`px-3 py-2 rounded-full text-[11px] font-medium flex items-center justify-between gap-2 ${
                toast.kind === 'ok'
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                  : 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
              }`}
            >
              <span className="truncate">{toast.text}</span>
              <button type="button" onClick={() => setToast(null)}>
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Vertical List of Clean Elevated Book Cards */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-5 space-y-2.5">
          {isLoading && items.length === 0 ? (
            <div className="py-12 flex items-center justify-center gap-2 text-xs text-stone-500">
              <Loader2 className="w-4 h-4 animate-spin text-amber-800" />
              <span>Đang tải kho sách cộng đồng...</span>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="ios-elevated-card p-8 rounded-2xl bg-white dark:bg-[#181A1F] border border-stone-200/90 dark:border-stone-800 text-center space-y-2">
              <p className="text-xs font-semibold text-stone-700 dark:text-stone-200">
                Chưa tìm thấy sách phù hợp.
              </p>
              <button
                type="button"
                onClick={() => setIsShareOpen(true)}
                className="ios-elevated-oval inline-flex items-center gap-1 px-3.5 py-1.5 rounded-full bg-amber-800 text-white text-[11px] font-semibold"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Chia sẻ cuốn đầu tiên</span>
              </button>
            </div>
          ) : (
            filteredItems.map((item) => {
              const isDownloading = downloadingId === item.book.id;
              const isCopied = copiedId === item.book.id;
              return (
                <article
                  key={item.book.id}
                  data-testid={`community-book-card-${item.book.id}`}
                  className="ios-elevated-card rounded-2xl bg-white dark:bg-[#181A1F] border border-stone-200/90 dark:border-stone-800 p-3.5 space-y-2.5"
                >
                  {/* Row 1: Bold Book Title + Small Oval Format Badge */}
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-[13.5px] font-sans font-bold text-stone-900 dark:text-stone-100 leading-snug line-clamp-2">
                      {item.book.title}
                    </h3>
                    <span className="ios-elevated-oval px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 text-[10px] font-bold text-amber-900 dark:text-amber-300 shrink-0">
                      {item.book.format}
                    </span>
                  </div>

                  {/* Row 2: Author • Genre • Download Count */}
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-stone-500 dark:text-stone-400">
                    <span className="font-medium text-stone-700 dark:text-stone-300">
                      {item.book.author}
                    </span>
                    <span>•</span>
                    <span>{item.book.genre}</span>
                    <span>•</span>
                    <span className="tabular-nums">{item.book.downloads} lượt tải</span>
                    {item.links.length > 1 && (
                      <>
                        <span>•</span>
                        <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                          {item.links.length} link dự phòng
                        </span>
                      </>
                    )}
                  </div>

                  {/* Row 3: Accent Oval Tải về máy + White Oval Sao chép link + Flag Báo lỗi */}
                  <div className="flex items-center gap-2 pt-0.5">
                    <button
                      type="button"
                      disabled={isDownloading}
                      onClick={() => handleDownloadBook(item)}
                      className="ios-elevated-oval ios-liquid-btn flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-full bg-amber-800 text-white text-[11.5px] font-semibold hover:bg-amber-900 disabled:opacity-50"
                    >
                      {isDownloading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      <span>{isDownloading ? 'Đang tải...' : 'Tải về máy'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleCopyDriveLink(item)}
                      className="ios-elevated-oval ios-liquid-pill inline-flex items-center justify-center gap-1 px-3 py-2 rounded-full bg-white dark:bg-[#22252C] border border-stone-200 dark:border-stone-700 text-stone-800 dark:text-stone-100 text-[11px] font-semibold whitespace-nowrap"
                    >
                      {isCopied ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Đã chép</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Sao chép link</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleReportBroken(item)}
                      aria-label={`Báo lỗi link cho ${item.book.title}`}
                      title="Báo lỗi link hỏng"
                      className="ios-elevated-oval w-9 h-9 rounded-full bg-white dark:bg-[#22252C] border border-stone-200 dark:border-stone-700 flex items-center justify-center text-stone-500 hover:text-red-600 dark:hover:text-red-400 shrink-0"
                    >
                      <Flag className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </div>

      {/* Smooth Share Book Bottom Sheet */}
      <IosSheet
        isOpen={isShareOpen}
        onClose={() => setIsShareOpen(false)}
        ariaLabel="Chia sẻ sách ẩn danh"
        variant="bottom-sheet"
        zIndexClass="z-[105]"
        showGrabHandle
        panelClassName="w-full sm:max-w-md rounded-t-[26px] sm:rounded-[24px] text-stone-900 dark:text-stone-100 overflow-hidden max-h-[88dvh] flex flex-col"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200/70 dark:border-white/10 shrink-0">
          <h3 className="text-[13.5px] font-sans font-bold">Chia sẻ sách ẩn danh</h3>
          <button
            type="button"
            onClick={() => setIsShareOpen(false)}
            aria-label="Đóng cửa sổ chia sẻ"
            className="w-7 h-7 rounded-full bg-black/5 dark:bg-white/10 flex items-center justify-center text-stone-600 dark:text-stone-300"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <form onSubmit={handleSubmitShare} className="p-4 space-y-3 text-xs overflow-y-auto">
          <div className="space-y-1">
            <span className="inline-block ios-elevated-oval px-2.5 py-0.5 rounded-full bg-stone-100 dark:bg-stone-800 text-[10.5px] font-semibold text-stone-700 dark:text-stone-200">
              Tên sách
            </span>
            <input
              type="text"
              required
              data-testid="share-title-input"
              value={shareTitle}
              onChange={(e) => setShareTitle(e.target.value)}
              placeholder="Ví dụ: Đấu Phá Thương Khung"
              className="w-full px-3.5 py-2.5 rounded-2xl bg-white dark:bg-[#1C1E24] border border-stone-200 dark:border-stone-700 text-xs focus:outline-none focus:border-amber-700"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <span className="inline-block ios-elevated-oval px-2.5 py-0.5 rounded-full bg-stone-100 dark:bg-stone-800 text-[10.5px] font-semibold text-stone-700 dark:text-stone-200">
                Tác giả
              </span>
              <input
                type="text"
                data-testid="share-author-input"
                value={shareAuthor}
                onChange={(e) => setShareAuthor(e.target.value)}
                placeholder="Tên tác giả"
                className="w-full px-3 py-2 rounded-2xl bg-white dark:bg-[#1C1E24] border border-stone-200 dark:border-stone-700 text-xs focus:outline-none focus:border-amber-700"
              />
            </div>

            <div className="space-y-1">
              <span className="inline-block ios-elevated-oval px-2.5 py-0.5 rounded-full bg-stone-100 dark:bg-stone-800 text-[10.5px] font-semibold text-stone-700 dark:text-stone-200">
                Thể loại
              </span>
              <select
                value={shareGenre}
                onChange={(e) => setShareGenre(e.target.value)}
                aria-label="Thể loại sách"
                className="w-full px-3 py-2 rounded-2xl bg-white dark:bg-[#1C1E24] border border-stone-200 dark:border-stone-700 text-xs focus:outline-none focus:border-amber-700"
              >
                {GENRE_OPTIONS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <span className="inline-block ios-elevated-oval px-2.5 py-0.5 rounded-full bg-stone-100 dark:bg-stone-800 text-[10.5px] font-semibold text-stone-700 dark:text-stone-200">
              Định dạng
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {FORMAT_OPTIONS.map((fmt) => {
                const active = shareFormat === fmt;
                return (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => setShareFormat(fmt)}
                    className={`ios-elevated-oval py-1.5 rounded-full text-[11px] font-semibold border ${
                      active
                        ? 'bg-amber-800 text-white border-amber-800'
                        : 'bg-white dark:bg-[#1C1E24] text-stone-700 dark:text-stone-200 border-stone-200 dark:border-stone-700'
                    }`}
                  >
                    {fmt}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="inline-block ios-elevated-oval px-2.5 py-0.5 rounded-full bg-stone-100 dark:bg-stone-800 text-[10.5px] font-semibold text-stone-700 dark:text-stone-200">
                Link Google Drive
              </span>
              <button
                type="button"
                onClick={handlePasteDriveUrl}
                className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-amber-800 dark:text-amber-400"
              >
                <ClipboardPaste className="w-3 h-3" />
                <span>Dán link</span>
              </button>
            </div>
            <input
              type="url"
              required
              data-testid="share-drive-url-input"
              value={shareDriveUrl}
              onChange={(e) => setShareDriveUrl(e.target.value)}
              placeholder="https://drive.google.com/file/d/..."
              className="w-full px-3.5 py-2.5 rounded-2xl bg-white dark:bg-[#1C1E24] border border-stone-200 dark:border-stone-700 text-xs focus:outline-none focus:border-amber-700"
            />
            <p className="text-[10.5px] text-amber-900 dark:text-amber-300 bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-800/50 rounded-xl px-2.5 py-1.5 leading-snug">
              Bật quyền &quot;Bất kỳ ai có đường liên kết đều có thể xem&quot; trên Drive trước khi
              dán.
            </p>
          </div>

          {shareError && (
            <div className="px-3 py-2 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-[11px]">
              {shareError}
            </div>
          )}

          <button
            type="submit"
            data-testid="share-submit-anonymous-btn"
            disabled={isSubmittingShare}
            className="w-full ios-elevated-oval py-2.5 rounded-full bg-amber-800 text-white text-xs font-semibold hover:bg-amber-900 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
          >
            {isSubmittingShare && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>Đăng ẩn danh</span>
          </button>
        </form>
      </IosSheet>
    </div>,
    document.body
  );
}
