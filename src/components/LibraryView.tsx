import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BookOpen,
  Check,
  ChevronDown,
  Clock,
  Download,
  Edit3,
  FolderOpen,
  FolderPlus,
  Headphones,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  List,
  MoreVertical,
  Orbit,
  Plus,
  RotateCcw,
  Search,
  Shield,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  Book,
  BookReadingStyle,
  BookSourceType,
  ReadingLogEntry,
  UserCollection,
} from '../types/book';
import { estimateBookStats } from '../utils/textProcessing';
import { buildEpubBlob } from '../utils/epubBuilder';
import { downloadBlob, slugifyFilename } from '../utils/fileHelpers';
import { cleanBookChaptersOnDevice, type BookCleanReport } from '../utils/bookCleaner';
import { computeReadingTimeSummary } from '../utils/syncAndStats';
import {
  sortBooksByMode,
  sortCollectionsByMode,
  type BookSortMode,
  type CollectionSortMode,
} from '../utils/librarySort';
import { compressWallpaperImageFile } from '../utils/appAppearance';
import { CollectionModal } from './CollectionModal';
import { BookShowcase3D } from './BookShowcase3D';
import { GlassSelect } from './GlassSelect';
import { LiquidDropThumb, useLiquidDropIndicator } from './LiquidGlassBar';
import { TwoTapDeleteButton } from './TwoTapDeleteButton';

interface LibraryViewProps {
  books: Book[];
  collections: UserCollection[];
  readingLogs: ReadingLogEntry[];
  onOpenBook: (bookId: string, openAudioStudio?: boolean) => void;
  onUpdateBook: (book: Book) => void;
  onDuplicateAsNewBook?: (book: Book) => void;
  onDeleteBook: (bookId: string) => void;
  onUpdateCollections: (collections: UserCollection[]) => void;
  onOpenImportModal: () => void;
  onOpenCongDongSach: () => void;
  onRestoreSamples: () => void;
  focusCollectionSignal?: { name: string; tick: number } | null;
}

type LibraryShelfTab = 'all' | 'imported' | 'downloaded' | 'collections';
type LibraryViewMode = 'grid' | 'list' | 'carousel3d' | 'stack3d';

const SOURCE_LABELS: Record<BookSourceType, string> = {
  sample: 'Ấn bản mẫu',
  epub: 'EPUB',
  pdf: 'PDF → EPUB',
  image: 'Dịch từ ảnh',
  web: 'Tải từ Web',
};

const STYLE_LABELS: Record<BookReadingStyle, string> = {
  novel: 'Tiểu thuyết',
  selfhelp: 'Văn phong học tập',
  essay: 'Tản văn',
  research: 'Nghiên cứu',
};

export const LibraryView: React.FC<LibraryViewProps> = ({
  books,
  collections,
  readingLogs,
  onOpenBook,
  onUpdateBook,
  onDuplicateAsNewBook,
  onDeleteBook,
  onUpdateCollections,
  onOpenImportModal,
  onOpenCongDongSach,
  onRestoreSamples,
  focusCollectionSignal = null,
}) => {
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [shelfTab, setShelfTab] = useState<LibraryShelfTab>('all');

  useEffect(() => {
    if (!focusCollectionSignal) return;
    setShelfTab('collections');
    setSearchQuery(focusCollectionSignal.name);
  }, [focusCollectionSignal]);

  const [sortMode, setSortMode] = useState<BookSortMode>('recent');
  const [collectionSortMode, setCollectionSortMode] = useState<CollectionSortMode>('name_asc');
  const [viewMode, setViewMode] = useState<LibraryViewMode>(() => {
    try {
      const saved = localStorage.getItem('laziread_library_view_mode') as LibraryViewMode | null;
      if (saved && ['grid', 'list', 'carousel3d', 'stack3d'].includes(saved)) return saved;
    } catch {
      // ignore storage errors
    }
    return 'grid';
  });

  const handleSetViewMode = (mode: LibraryViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem('laziread_library_view_mode', mode);
    } catch {
      // ignore
    }
  };

  const [showExactReadingHours, setShowExactReadingHours] = useState(false);
  const shelfTabsRef = useRef<HTMLDivElement>(null);
  const viewModeBarRef = useRef<HTMLDivElement>(null);
  const { thumb: shelfThumb, isGliding: shelfGliding } = useLiquidDropIndicator(
    shelfTab,
    shelfTabsRef
  );
  const { thumb: viewModeThumb, isGliding: viewModeGliding } = useLiquidDropIndicator(
    viewMode,
    viewModeBarRef
  );
  const [exportingId, setExportingId] = useState<string | null>(null);

  // Three-dot action menu state
  const [menuContext, setMenuContext] = useState<{
    book: Book;
    collectionId?: string;
  } | null>(null);
  const [menuSubView, setMenuSubView] = useState<'main' | 'collections' | 'rename' | 'clean'>('main');
  const [cleanReport, setCleanReport] = useState<BookCleanReport | null>(null);
  const [isSavingCleanedEpub, setIsSavingCleanedEpub] = useState(false);
  const [renameTitleInput, setRenameTitleInput] = useState('');
  const [renameAuthorInput, setRenameAuthorInput] = useState('');
  const [isUpdatingCover, setIsUpdatingCover] = useState(false);

  // User-created Collection Modal & Selector state
  const [isColModalOpen, setIsColModalOpen] = useState(false);
  const [editingCollection, setEditingCollection] = useState<UserCollection | null>(null);
  const [preselectBookIds, setPreselectBookIds] = useState<string[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>('');
  const [showCollectionPicker, setShowCollectionPicker] = useState(false);

  const recentBooks = useMemo(
    () => [...books].sort((a, b) => b.lastReadAt - a.lastReadAt).slice(0, 1),
    [books]
  );

  const featuredBook = recentBooks[0];

  const readingSummary = useMemo(
    () => computeReadingTimeSummary(readingLogs),
    [readingLogs]
  );

  const filteredAndSortedBooks = useMemo(() => {
    const filtered = books.filter((b) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q);

      if (!matchesSearch) return false;
      if (shelfTab === 'imported') return b.sourceType !== 'web';
      if (shelfTab === 'downloaded') return b.sourceType === 'web';
      return true;
    });

    return sortBooksByMode(filtered, sortMode);
  }, [books, searchQuery, shelfTab, sortMode]);

  // User-created collections sorted by selected collectionSortMode (A->Z, recent read, recent added, Z->A)
  const sortedCollections = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sortCollectionsByMode(collections, books, collectionSortMode)
      .map((col) => {
        const colBooks = sortBooksByMode(
          col.bookIds
            .map((id) => books.find((b) => b.id === id))
            .filter((b): b is Book => Boolean(b))
            .filter(
              (b) =>
                !q ||
                col.name.toLowerCase().includes(q) ||
                b.title.toLowerCase().includes(q) ||
                b.author.toLowerCase().includes(q)
            ),
          sortMode
        );
        return {
          ...col,
          resolvedBooks: colBooks,
        };
      })
      .filter((col) => !q || col.name.toLowerCase().includes(q) || col.resolvedBooks.length > 0);
  }, [collections, books, searchQuery, collectionSortMode, sortMode]);

  const activeCollection = useMemo(() => {
    if (sortedCollections.length === 0) return null;
    return (
      sortedCollections.find((c) => c.id === selectedCollectionId) || sortedCollections[0]
    );
  }, [sortedCollections, selectedCollectionId]);

  useEffect(() => {
    if (focusCollectionSignal && collections.length > 0) {
      const matched = collections.find(
        (c) => c.name.toLowerCase() === focusCollectionSignal.name.toLowerCase()
      );
      if (matched) setSelectedCollectionId(matched.id);
    }
  }, [focusCollectionSignal, collections]);

  const handleExportEpub = async (book: Book, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setExportingId(book.id);
    try {
      const blob = await buildEpubBlob(book);
      downloadBlob(blob, `${slugifyFilename(book.title)}.epub`);
    } finally {
      setExportingId(null);
    }
  };

  const handleSaveCollection = (name: string, bookIds: string[], existingId?: string) => {
    if (existingId) {
      onUpdateCollections(
        collections.map((c) => (c.id === existingId ? { ...c, name, bookIds } : c))
      );
    } else {
      const created: UserCollection = {
        id: `col-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        bookIds,
        createdAt: Date.now(),
      };
      onUpdateCollections([...collections, created]);
    }
  };

  const handleDeleteCollection = (colId: string) => {
    onUpdateCollections(collections.filter((c) => c.id !== colId));
  };

  const handleToggleBookInCollection = (colId: string, bookId: string) => {
    onUpdateCollections(
      collections.map((col) => {
        if (col.id !== colId) return col;
        const exists = col.bookIds.includes(bookId);
        return {
          ...col,
          bookIds: exists
            ? col.bookIds.filter((id) => id !== bookId)
            : [...col.bookIds, bookId],
        };
      })
    );
  };

  const openBookOptionsMenu = (
    book: Book,
    e: React.MouseEvent,
    collectionId?: string
  ) => {
    e.stopPropagation();
    setMenuSubView('main');
    setRenameTitleInput(book.title);
    setRenameAuthorInput(book.author);
    setMenuContext({ book, collectionId });
  };

  const handleSaveBookRename = (e: React.FormEvent) => {
    e.preventDefault();
    if (!menuContext) return;
    const trimmedTitle = renameTitleInput.trim();
    if (!trimmedTitle) return;
    const updated: Book = {
      ...menuContext.book,
      title: trimmedTitle,
      author: renameAuthorInput.trim() || menuContext.book.author,
    };
    onUpdateBook(updated);
    setMenuContext(null);
    setMenuSubView('main');
  };

  const handlePickBookCover = async (files: FileList | null) => {
    if (!files || files.length === 0 || !menuContext) return;
    setIsUpdatingCover(true);
    try {
      const compressedCover = await compressWallpaperImageFile(files[0], 720, 0.86);
      const updated: Book = {
        ...menuContext.book,
        coverUrl: compressedCover,
      };
      onUpdateBook(updated);
      setMenuContext({ ...menuContext, book: updated });
    } finally {
      setIsUpdatingCover(false);
      if (coverInputRef.current) coverInputRef.current.value = '';
    }
  };

  const renderListBookRow = (book: Book, collectionId?: string) => {
    const stats = estimateBookStats(book.chapters);
    return (
      <article
        key={`list-${collectionId || 'shelf'}-${book.id}`}
        className="ios-tap-card flex items-center gap-3 p-2.5 sm:p-3 rounded-xl border border-stone-200/90 dark:border-stone-800 bg-white/90 dark:bg-[#16181C]/95 hover:border-amber-700 transition-colors"
      >
        <button
          type="button"
          onClick={() => onOpenBook(book.id)}
          className="flex items-center gap-3 min-w-0 flex-1 text-left focus:outline-none"
        >
          <div className="w-9 h-12 rounded-md overflow-hidden bg-stone-200 dark:bg-stone-800 shrink-0">
            {book.coverUrl ? (
              <img
                src={book.coverUrl}
                alt={`Bìa ${book.title}`}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[9px] font-display font-bold p-1 text-center">
                {book.title.slice(0, 2)}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex items-center gap-1.5">
              <h3 className="text-[11.5px] sm:text-xs font-semibold text-stone-900 dark:text-stone-100 truncate">
                {book.title}
              </h3>
              <span className="hidden sm:inline text-[9px] px-1.5 py-0.5 rounded bg-stone-100 dark:bg-stone-800 text-stone-500 shrink-0">
                {SOURCE_LABELS[book.sourceType]}
              </span>
            </div>
            <p className="text-[10px] text-stone-500 dark:text-stone-400 truncate">
              {book.author} · {stats.chapterCount} ch
            </p>
            <div className="flex items-center gap-1.5 max-w-xs">
              <div className="flex-1 h-1 bg-stone-200 dark:bg-stone-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-800 dark:bg-amber-600"
                  style={{ width: `${book.progressPercent}%` }}
                />
              </div>
              <span className="text-[9.5px] text-stone-500 tabular-nums">
                {book.progressPercent}%
              </span>
            </div>
          </div>
        </button>

        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() => onOpenBook(book.id, true)}
            aria-label={`Nghe sách nói ${book.title}`}
            className="p-1.5 rounded-lg text-stone-500 hover:text-amber-800 dark:hover:text-amber-400 hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            <Headphones className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={(e) => openBookOptionsMenu(book, e, collectionId)}
            aria-label={`Tùy chọn cho ${book.title}`}
            className="p-1.5 rounded-lg text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
        </div>
      </article>
    );
  };

  const renderCompactBookCard = (book: Book, collectionId?: string) => {
    const stats = estimateBookStats(book.chapters);

    return (
      <article
        key={`${collectionId || 'shelf'}-${book.id}`}
        className="ios-tap-card group relative flex flex-col justify-between border border-stone-200/90 dark:border-stone-800 rounded-xl bg-white dark:bg-[#16181C] overflow-hidden shadow-xs hover:shadow-md hover:border-stone-400 dark:hover:border-stone-600"
      >
        <button
          type="button"
          onClick={() => onOpenBook(book.id)}
          className="text-left focus:outline-none block w-full"
          aria-label={`Mở sách ${book.title}`}
        >
          <div className="aspect-[3/4] w-full bg-stone-100 dark:bg-stone-900 overflow-hidden relative">
            {book.coverUrl ? (
              <img
                src={book.coverUrl}
                alt={`Bìa ${book.title}`}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
              />
            ) : (
              <div className="w-full h-full p-2 flex flex-col justify-between bg-gradient-to-br from-[#EDE8DC] to-[#DFD7C5] dark:from-stone-800 dark:to-stone-900 text-stone-900 dark:text-stone-100">
                <span className="text-[8px] uppercase tracking-wider text-stone-500 dark:text-stone-400 truncate">
                  {SOURCE_LABELS[book.sourceType]}
                </span>
                <span className="font-display text-[10.5px] font-semibold line-clamp-3 leading-snug">
                  {book.title}
                </span>
                <span className="text-[8.5px] text-stone-600 dark:text-stone-400 truncate">
                  {book.author}
                </span>
              </div>
            )}

            {/* Compact progress badge overlay */}
            <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-black/65 text-white text-[8.5px] font-medium tabular-nums backdrop-blur-xs">
              {book.progressPercent}%
            </span>
          </div>
        </button>

        {/* Title + Corner 3-dot Menu Trigger (compact typography so mobile cards stay readable) */}
        <div className="px-2 py-2 flex items-start justify-between gap-1">
          <button
            type="button"
            onClick={() => onOpenBook(book.id)}
            className="text-left min-w-0 flex-1 focus:outline-none"
          >
            <h3 className="text-[11px] sm:text-[11.5px] font-semibold text-stone-900 dark:text-stone-100 line-clamp-2 leading-snug break-words">
              {book.title}
            </h3>
            <p className="text-[9.5px] text-stone-500 dark:text-stone-400 truncate mt-0.5 tabular-nums">
              {stats.chapterCount} ch · {book.author}
            </p>
          </button>

          <button
            type="button"
            onClick={(e) => openBookOptionsMenu(book, e, collectionId)}
            aria-label={`Tùy chọn cho ${book.title}`}
            className="w-6 h-6 -mr-1 -mt-0.5 rounded-full flex items-center justify-center text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-100 dark:hover:bg-stone-800 shrink-0"
          >
            <MoreVertical className="w-3 h-3" />
          </button>
        </div>
      </article>
    );
  };

  return (
    <main className="max-w-7xl mx-auto px-3.5 sm:px-6 lg:px-8 pt-3 pb-4 sm:pt-5 sm:pb-6 space-y-4">
      {/* 1. TRÊN CÙNG: CHIA ĐÔI 2 Ô VUÔNG — GIỜ ĐỌC (3 DÒNG) & SÁCH MỚI ĐỌC */}
      <section aria-label="Thời gian đọc và Sách mới đọc" className="grid grid-cols-2 gap-2.5 sm:gap-3.5">
        {/* Ô VUÔNG 1: THỜI GIAN ĐỌC (3 DÒNG ĐƠN GIẢN) */}
        <div
          data-testid="reading-time-square"
          className="ios-floating-shadow rounded-2xl border border-stone-200/90 dark:border-stone-800 bg-white dark:bg-[#16181C] p-3 sm:p-4 flex flex-col justify-between min-h-[154px] sm:min-h-[168px] min-w-0"
        >
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-800 dark:text-amber-400">
            <Clock className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Thời gian đọc</span>
          </div>

          <div className="space-y-2 mt-1.5 min-w-0">
            {/* Dòng 1: Tổng thời gian đọc (100h / 1kh / 10kh / 10mh — ấn để xem chi tiết) */}
            <div className="min-w-0">
              <div className="text-[10px] text-stone-500 dark:text-stone-400 leading-tight">
                Tổng thời gian đọc
              </div>
              <button
                type="button"
                data-testid="reading-total-toggle"
                onClick={() => setShowExactReadingHours((prev) => !prev)}
                title="Ấn để xem chi tiết giờ đọc chính xác"
                className="mt-0.5 text-left inline-flex items-baseline gap-1.5 group focus:outline-none"
              >
                <span className="text-lg sm:text-xl font-display font-bold text-stone-900 dark:text-stone-100 tabular-nums underline decoration-dotted decoration-amber-700/50 underline-offset-4 group-hover:text-amber-800 dark:group-hover:text-amber-300 transition-colors">
                  {showExactReadingHours ? readingSummary.totalExact : readingSummary.totalCompact}
                </span>
                <span className="text-[9.5px] text-stone-400 shrink-0">
                  {showExactReadingHours ? '(thu gọn)' : '(chi tiết)'}
                </span>
              </button>
            </div>

            {/* Dòng 2: Ngày / Tuần / Tháng / Tháng trước */}
            <div className="min-w-0">
              <div className="text-[9.5px] text-stone-500 dark:text-stone-400 leading-tight truncate">
                Ngày / Tuần / Tháng / T.trước
              </div>
              <div className="text-[11px] sm:text-xs font-semibold text-stone-800 dark:text-stone-200 tabular-nums leading-snug break-words">
                {readingSummary.todayLabel} / {readingSummary.weekLabel} / {readingSummary.thisMonthLabel} / {readingSummary.prevMonthLabel}
              </div>
            </div>

            {/* Dòng 3: Trung bình 1 ngày (tính đến thời điểm hiện tại trong ngày) */}
            <div className="pt-1 border-t border-stone-100 dark:border-stone-800/80 flex items-baseline justify-between gap-1 text-[10.5px] sm:text-[11px]">
              <span className="text-stone-500 dark:text-stone-400 truncate">TB 1 ngày:</span>
              <span className="font-bold text-amber-800 dark:text-amber-400 tabular-nums shrink-0">
                {readingSummary.dailyAverageLabel}
              </span>
            </div>
          </div>
        </div>

        {/* Ô VUÔNG 2: SÁCH MỚI ĐỌC */}
        <div
          data-testid="recent-books-list"
          className="ios-floating-shadow rounded-2xl border border-stone-200/90 dark:border-stone-800 bg-white dark:bg-[#16181C] p-3 sm:p-4 flex flex-col justify-between min-h-[154px] sm:min-h-[168px] min-w-0 relative"
        >
          <div className="flex items-center justify-between gap-1 min-w-0">
            <h1 className="text-[11px] font-semibold text-stone-800 dark:text-stone-200 truncate">
              Sách mới đọc
            </h1>
            {featuredBook && (
              <button
                type="button"
                onClick={(e) => openBookOptionsMenu(featuredBook, e)}
                aria-label={`Tùy chọn cho ${featuredBook.title}`}
                className="p-1 -mr-1 rounded-full text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 shrink-0"
              >
                <MoreVertical className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {featuredBook ? (
            <button
              type="button"
              onClick={() => onOpenBook(featuredBook.id)}
              className="mt-1.5 flex-1 flex flex-col justify-between text-left focus:outline-none min-w-0 group"
            >
              <div className="flex items-start gap-2 min-w-0">
                <div className="w-11 h-16 sm:w-12 sm:h-16 rounded-lg overflow-hidden bg-stone-200 dark:bg-stone-800 shrink-0 shadow-xs">
                  {featuredBook.coverUrl ? (
                    <img
                      src={featuredBook.coverUrl}
                      alt={featuredBook.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[9px] font-display font-bold p-1 text-center">
                      {featuredBook.title.slice(0, 2)}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[11.5px] sm:text-xs font-semibold text-stone-900 dark:text-stone-100 line-clamp-2 leading-snug group-hover:text-amber-800 dark:group-hover:text-amber-300 transition-colors">
                    {featuredBook.title}
                  </div>
                  <div className="text-[10px] text-stone-500 truncate mt-0.5">
                    {featuredBook.author}
                  </div>
                </div>
              </div>

              <div className="mt-2 space-y-1 w-full">
                <div className="flex items-center gap-1.5">
                  <div className="flex-1 h-1.5 bg-stone-200 dark:bg-stone-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-800 dark:bg-amber-600 rounded-full"
                      style={{ width: `${featuredBook.progressPercent}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-semibold text-stone-600 dark:text-stone-300 tabular-nums">
                    {featuredBook.progressPercent}%
                  </span>
                </div>
                <div className="text-[10px] font-semibold text-amber-800 dark:text-amber-400">
                  Đọc tiếp →
                </div>
              </div>
            </button>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-1.5 py-2">
              <BookOpen className="w-6 h-6 text-stone-300 dark:text-stone-700" />
              <p className="text-[10.5px] text-stone-500">Chưa có sách nào</p>
              <button
                type="button"
                onClick={onOpenImportModal}
                className="text-[10.5px] font-semibold text-amber-800 dark:text-amber-400 hover:underline"
              >
                + Thêm sách
              </button>
            </div>
          )}
        </div>
      </section>

      {/* 2. TIẾP THEO: KHO SÁCH RIÊNG & BỘ SƯU TẬP */}
      <section aria-label="Thư viện riêng và Bộ sưu tập" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
          <h2 className="text-[13.5px] sm:text-[15px] font-display font-semibold text-stone-900 dark:text-stone-100 whitespace-nowrap">
            Kho sách riêng
          </h2>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onOpenCongDongSach}
              className="ios-liquid-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-full ios-liquid-bar border border-white/75 dark:border-zinc-700/60 text-[11px] font-semibold text-stone-700 dark:text-stone-200 hover:text-amber-800 whitespace-nowrap"
            >
              <Shield className="w-3 h-3 shrink-0 text-amber-800 dark:text-amber-400" />
              <span>Ẩn danh</span>
            </button>
            <button
              type="button"
              onClick={onOpenImportModal}
              className="ios-liquid-btn inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-800 text-white text-[11px] font-semibold hover:bg-amber-900 whitespace-nowrap"
            >
              <Plus className="w-3 h-3 shrink-0" />
              <span>Thêm sách</span>
            </button>
          </div>
        </div>

        {/* Liquid-Glass Sliding Water-Drop Tabs + Search / Sort Controls */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div
            ref={shelfTabsRef}
            className="relative grid grid-cols-2 sm:inline-flex p-1 ios-liquid-bar border border-white/75 dark:border-zinc-700/60 rounded-[22px] sm:rounded-full gap-1"
          >
            <LiquidDropThumb
              thumb={shelfThumb}
              isGliding={shelfGliding}
              roundedClass="rounded-full"
            />
            {(
              [
                { id: 'all', label: `Tất cả (${books.length})` },
                {
                  id: 'imported',
                  label: `Sách đã cho vào (${books.filter((b) => b.sourceType !== 'web').length})`,
                },
                {
                  id: 'downloaded',
                  label: `Sách tải về (${books.filter((b) => b.sourceType === 'web').length})`,
                },
                { id: 'collections', label: `Bộ sưu tập (${collections.length})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                data-liquid-key={tab.id}
                onClick={() => setShelfTab(tab.id)}
                className={`relative z-10 ios-liquid-pill min-w-0 truncate px-2.5 sm:px-3.5 py-1.5 text-[11px] sm:text-xs font-medium rounded-full whitespace-nowrap min-h-[34px] text-center ${
                  shelfTab === tab.id
                    ? 'text-amber-800 dark:text-amber-300 font-semibold'
                    : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <div className="relative flex-1 min-w-[130px] sm:w-48">
              <Search className="w-3 h-3 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  shelfTab === 'collections' ? 'Tìm bộ sưu tập...' : 'Tìm sách, tác giả...'
                }
                aria-label="Tìm kiếm sách trong tủ"
                className="w-full pl-8 pr-3 py-1.5 text-[11px] rounded-full ios-liquid-bar border border-white/75 dark:border-zinc-700/60 text-stone-900 dark:text-stone-100 focus:outline-none min-h-[34px]"
              />
            </div>

            {shelfTab === 'collections' ? (
              <div className="w-[162px] shrink-0">
                <GlassSelect<CollectionSortMode>
                  ariaLabel="Sắp xếp bộ sưu tập"
                  title="Sắp xếp bộ sưu tập"
                  value={collectionSortMode}
                  onChange={setCollectionSortMode}
                  buttonClassName="!py-1.5 !px-3 !rounded-full !text-[11px] min-h-[34px]"
                  options={[
                    { value: 'name_asc', label: 'Bộ sưu tập A → Z' },
                    { value: 'recent_read', label: 'Mới đọc gần đây' },
                    { value: 'recent_added', label: 'Mới thêm gần đây' },
                    { value: 'name_desc', label: 'Bộ sưu tập Z → A' },
                  ]}
                />
              </div>
            ) : (
              <div className="w-[162px] shrink-0">
                <GlassSelect<BookSortMode>
                  ariaLabel="Sắp xếp sách"
                  title="Sắp xếp sách"
                  value={sortMode}
                  onChange={setSortMode}
                  buttonClassName="!py-1.5 !px-3 !rounded-full !text-[11px] min-h-[34px]"
                  options={[
                    { value: 'recent', label: 'Mới đọc gần đây' },
                    { value: 'added_desc', label: 'Mới thêm gần đây' },
                    { value: 'title_asc', label: 'Tên A → Z' },
                    { value: 'title_desc', label: 'Tên Z → A' },
                    { value: 'author_asc', label: 'Tác giả A → Z' },
                    { value: 'progress_desc', label: 'Tiến độ cao nhất' },
                  ]}
                />
              </div>
            )}

            {/* 4-Mode Library Display Switcher (Grid, List, 3D Circular Carousel, 3D Swipe Stack) */}
            <div
              ref={viewModeBarRef}
              role="group"
              aria-label="Kiểu hiển thị kệ sách"
              className="relative inline-flex items-center p-0.5 rounded-full ios-liquid-bar border border-white/75 dark:border-zinc-700/60"
            >
              <LiquidDropThumb
                thumb={viewModeThumb}
                isGliding={viewModeGliding}
                roundedClass="rounded-full"
              />
              {(
                [
                  { id: 'grid', label: 'Bìa & tên', icon: LayoutGrid },
                  { id: 'list', label: 'Danh sách', icon: List },
                  { id: 'carousel3d', label: '3D vòng tròn', icon: Orbit },
                  { id: 'stack3d', label: '3D xếp chồng', icon: Layers },
                ] as const
              ).map((item) => {
                const Icon = item.icon;
                const active = viewMode === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-liquid-key={item.id}
                    onClick={() => handleSetViewMode(item.id)}
                    title={item.label}
                    aria-label={`Hiển thị kiểu ${item.label}`}
                    aria-pressed={active}
                    className={`relative z-10 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-medium transition-colors min-h-[32px] ${
                      active
                        ? 'text-amber-800 dark:text-amber-300 font-semibold'
                        : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="hidden xl:inline">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* User-Created Collections View OR Multi-Mode Book Showcase */}
        {shelfTab === 'collections' ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-stone-500 dark:text-stone-400">
                Tự tạo bộ sưu tập theo chủ đề của bạn — hỗ trợ sắp xếp A → Z, mới đọc &amp; mới thêm
              </p>
              <button
                type="button"
                onClick={() => {
                  setEditingCollection(null);
                  setPreselectBookIds([]);
                  setIsColModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-800 text-white text-xs font-semibold hover:bg-amber-900"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                <span>Tạo bộ sưu tập mới</span>
              </button>
            </div>

            {collections.length === 0 ? (
              <div className="border border-dashed border-stone-300 dark:border-stone-700 rounded-2xl p-8 sm:p-10 text-center bg-white/60 dark:bg-stone-900/40 space-y-3">
                <div className="w-11 h-11 rounded-2xl bg-amber-100/80 dark:bg-amber-950/50 text-amber-800 dark:text-amber-400 flex items-center justify-center mx-auto">
                  <FolderPlus className="w-5 h-5" />
                </div>
                <p className="text-sm font-semibold text-stone-800 dark:text-stone-200">
                  Chưa có bộ sưu tập nào
                </p>
                <p className="text-xs text-stone-500 max-w-md mx-auto">
                  Mục bộ sưu tập đang để trống để bạn tự đặt tên, tìm kiếm và tích chọn các cuốn sách yêu thích thêm vào.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setEditingCollection(null);
                    setPreselectBookIds([]);
                    setIsColModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-xs font-medium"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Tạo bộ sưu tập đầu tiên</span>
                </button>
              </div>
            ) : !activeCollection ? (
              <div className="border border-stone-200 dark:border-stone-800 rounded-2xl p-8 text-center text-xs text-stone-500">
                Không tìm thấy bộ sưu tập hoặc sách nào khớp với từ khóa tìm kiếm.
              </div>
            ) : (
              <div className="space-y-4">
                {/* 1 Compact Collection Selector Card (tapping opens iPhone Frosted-Glass Popover) */}
                <div className="ios-floating-shadow rounded-[22px] border border-stone-200/90 dark:border-stone-800 bg-white/85 dark:bg-[#16181C]/95 p-3 sm:p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      data-testid="collection-selector-trigger"
                      onClick={() => setShowCollectionPicker(true)}
                      aria-haspopup="dialog"
                      aria-expanded={showCollectionPicker}
                      className="ios-liquid-pill flex-1 min-w-[180px] px-3 py-2 rounded-2xl ios-liquid-bar border border-white/80 dark:border-zinc-700/60 flex items-center justify-between gap-2 text-left"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <FolderOpen className="w-4 h-4 text-amber-800 dark:text-amber-400 shrink-0" />
                        <span className="text-[13px] font-display font-semibold text-stone-900 dark:text-stone-100 truncate">
                          {activeCollection.name}
                        </span>
                        <span className="text-[10.5px] text-stone-500 tabular-nums shrink-0">
                          ({activeCollection.resolvedBooks.length})
                        </span>
                      </span>
                      <ChevronDown className="w-4 h-4 text-stone-500 shrink-0" />
                    </button>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingCollection(activeCollection);
                          setPreselectBookIds([]);
                          setIsColModalOpen(true);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-stone-300 dark:border-stone-700 text-[11px] font-medium hover:bg-stone-100 dark:hover:bg-stone-800"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Thêm / Sửa</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingCollection(activeCollection);
                          setPreselectBookIds([]);
                          setIsColModalOpen(true);
                        }}
                        aria-label={`Đổi tên bộ sưu tập ${activeCollection.name}`}
                        className="p-1.5 rounded-xl text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <TwoTapDeleteButton
                        variant="icon"
                        title={`Xóa bộ sưu tập ${activeCollection.name}`}
                        onConfirmDelete={() => handleDeleteCollection(activeCollection.id)}
                      />
                    </div>
                  </div>

                  {activeCollection.resolvedBooks.length === 0 ? (
                    <div className="py-5 text-center text-xs text-stone-500">
                      Bộ sưu tập này chưa có sách nào. Nhấn &quot;Thêm / Sửa&quot; để chọn sách thêm vào.
                    </div>
                  ) : viewMode === 'list' ? (
                    <div className="space-y-2">
                      {activeCollection.resolvedBooks.map((book) =>
                        renderListBookRow(book, activeCollection.id)
                      )}
                    </div>
                  ) : viewMode === 'carousel3d' || viewMode === 'stack3d' ? (
                    <BookShowcase3D
                      books={activeCollection.resolvedBooks}
                      mode={viewMode}
                      onOpenBook={onOpenBook}
                      onOpenMenu={(book, e) => openBookOptionsMenu(book, e, activeCollection.id)}
                    />
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 sm:gap-4">
                      {activeCollection.resolvedBooks.map((book) =>
                        renderCompactBookCard(book, activeCollection.id)
                      )}
                    </div>
                  )}
                </div>

                {/* iPhone Frosted-Glass Collection Picker Popover */}
                {showCollectionPicker &&
                  typeof document !== 'undefined' &&
                  createPortal(
                    <div
                      className="fixed inset-0 z-[95] ios-frosted-backdrop flex items-end sm:items-center justify-center p-0 sm:p-4"
                      onClick={(e) => {
                        if (e.target === e.currentTarget) setShowCollectionPicker(false);
                      }}
                    >
                      <div
                        role="dialog"
                        aria-modal="true"
                        aria-label="Chọn bộ sưu tập"
                        className="ios-sheet-enter ios-frosted-surface w-full sm:max-w-sm rounded-t-[26px] sm:rounded-[24px] text-stone-900 dark:text-stone-100 overflow-hidden max-h-[78dvh] flex flex-col"
                      >
                        <div className="sm:hidden flex justify-center pt-2 shrink-0">
                          <span className="w-10 h-1 rounded-full bg-stone-400/50 dark:bg-stone-600/70" />
                        </div>
                        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-stone-300/40 dark:border-white/10 shrink-0">
                          <h3 className="text-[13.5px] font-display font-semibold">
                            Bộ sưu tập ({sortedCollections.length})
                          </h3>
                          <button
                            type="button"
                            onClick={() => setShowCollectionPicker(false)}
                            aria-label="Đóng danh sách bộ sưu tập"
                            className="w-7 h-7 rounded-full bg-black/5 dark:bg-white/10 flex items-center justify-center text-stone-600 dark:text-stone-300"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="overflow-y-auto overscroll-contain p-2 space-y-1">
                          {sortedCollections.map((col) => {
                            const selected = col.id === activeCollection.id;
                            return (
                              <button
                                key={col.id}
                                type="button"
                                onClick={() => {
                                  setSelectedCollectionId(col.id);
                                  setShowCollectionPicker(false);
                                }}
                                className={`w-full px-3 py-2.5 rounded-[16px] text-left flex items-center justify-between gap-2.5 transition-colors ${
                                  selected
                                    ? 'bg-amber-800/12 dark:bg-amber-500/20 text-amber-900 dark:text-amber-200 font-semibold'
                                    : 'hover:bg-black/5 dark:hover:bg-white/10 text-stone-800 dark:text-stone-200'
                                }`}
                              >
                                <span className="flex items-center gap-2 min-w-0">
                                  <FolderOpen className="w-4 h-4 text-amber-800 dark:text-amber-400 shrink-0" />
                                  <span className="text-[12.5px] truncate">{col.name}</span>
                                </span>
                                <span className="flex items-center gap-2 shrink-0">
                                  <span className="text-[11px] text-stone-500 tabular-nums">
                                    {col.resolvedBooks.length} cuốn
                                  </span>
                                  {selected && (
                                    <Check className="w-4 h-4 text-amber-800 dark:text-amber-400" />
                                  )}
                                </span>
                              </button>
                            );
                          })}
                        </div>

                        <div className="p-3 border-t border-stone-300/40 dark:border-white/10 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setShowCollectionPicker(false);
                              setEditingCollection(null);
                              setPreselectBookIds([]);
                              setIsColModalOpen(true);
                            }}
                            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-2xl bg-amber-800 text-white text-xs font-semibold hover:bg-amber-900"
                          >
                            <FolderPlus className="w-3.5 h-3.5" />
                            <span>Tạo bộ sưu tập mới</span>
                          </button>
                        </div>
                      </div>
                    </div>,
                    document.body
                  )}
              </div>
            )}
          </div>
        ) : filteredAndSortedBooks.length === 0 ? (
          <div className="border border-stone-200 dark:border-stone-800 rounded-2xl p-10 text-center bg-white/50 dark:bg-stone-900/30 space-y-3">
            <p className="text-sm font-medium text-stone-800 dark:text-stone-200">
              Chưa có cuốn sách nào khớp với bộ lọc hiện tại.
            </p>
            <p className="text-xs text-stone-500">
              Bạn có thể tải lên tệp EPUB, PDF, ảnh trang sách cần dịch hoặc quét trực tiếp từ trang web truyện.
            </p>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={onOpenImportModal}
                className="px-4 py-2 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-xs font-medium"
              >
                Thêm sách mới
              </button>
              {books.length === 0 && (
                <button
                  type="button"
                  onClick={onRestoreSamples}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-stone-300 dark:border-stone-700 text-xs font-medium"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Khôi phục sách mẫu</span>
                </button>
              )}
            </div>
          </div>
        ) : viewMode === 'list' ? (
          <div data-testid="book-list" className="space-y-2">
            {filteredAndSortedBooks.map((book) => renderListBookRow(book))}
          </div>
        ) : viewMode === 'carousel3d' || viewMode === 'stack3d' ? (
          <BookShowcase3D
            books={filteredAndSortedBooks}
            mode={viewMode}
            onOpenBook={onOpenBook}
            onOpenMenu={(book, e) => openBookOptionsMenu(book, e)}
          />
        ) : (
          <div
            data-testid="book-grid"
            className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 sm:gap-4"
          >
            {filteredAndSortedBooks.map((book) => renderCompactBookCard(book))}
          </div>
        )}
      </section>

      {/* Three-Dot Corner Action Sheet Menu for Selected Book */}
      {menuContext &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/45 backdrop-blur-xs p-0 sm:p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) setMenuContext(null);
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`Tùy chọn cho ${menuContext.book.title}`}
              className="ios-sheet-enter w-full sm:max-w-sm bg-[#FBF9F5] dark:bg-[#191B1F] rounded-t-[26px] sm:rounded-[24px] border border-white/60 dark:border-stone-800 shadow-2xl overflow-hidden"
            >
              <div className="sm:hidden flex justify-center pt-2.5">
                <div className="w-10 h-1 rounded-full bg-stone-300 dark:bg-stone-700" />
              </div>

              <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-stone-200/80 dark:border-stone-800">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-12 rounded-md overflow-hidden bg-stone-200 dark:bg-stone-800 shrink-0">
                    {menuContext.book.coverUrl ? (
                      <img
                        src={menuContext.book.coverUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[9px] font-bold">
                        {menuContext.book.title.slice(0, 2)}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-stone-900 dark:text-stone-100 truncate">
                      {menuContext.book.title}
                    </div>
                    <div className="text-[11px] text-stone-500 truncate">
                      {menuContext.book.author} · {menuContext.book.progressPercent}%
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMenuContext(null)}
                  aria-label="Đóng menu tùy chọn"
                  className="w-7 h-7 rounded-full bg-stone-200/70 dark:bg-stone-800 flex items-center justify-center text-stone-600 dark:text-stone-300"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <input
                ref={coverInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handlePickBookCover(e.target.files)}
              />

              {menuSubView === 'main' ? (
                <div className="p-2 pb-4 sm:pb-2 space-y-1 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      const id = menuContext.book.id;
                      setMenuContext(null);
                      onOpenBook(id);
                    }}
                    className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl hover:bg-stone-200/60 dark:hover:bg-stone-800 text-left font-medium text-stone-900 dark:text-stone-100"
                  >
                    <BookOpen className="w-4 h-4 text-amber-800 dark:text-amber-400" />
                    <span>Đọc sách ngay</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const id = menuContext.book.id;
                      setMenuContext(null);
                      onOpenBook(id, true);
                    }}
                    className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl hover:bg-stone-200/60 dark:hover:bg-stone-800 text-left font-medium text-stone-900 dark:text-stone-100"
                  >
                    <Headphones className="w-4 h-4 text-amber-800 dark:text-amber-400" />
                    <span>Nghe sách nói AI</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setRenameTitleInput(menuContext.book.title);
                      setRenameAuthorInput(menuContext.book.author);
                      setMenuSubView('rename');
                    }}
                    className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl hover:bg-stone-200/60 dark:hover:bg-stone-800 text-left font-medium text-stone-900 dark:text-stone-100"
                  >
                    <Edit3 className="w-4 h-4 text-amber-800 dark:text-amber-400" />
                    <span>Đổi tên sách &amp; tác giả</span>
                  </button>

                  <button
                    type="button"
                    disabled={isUpdatingCover}
                    onClick={() => coverInputRef.current?.click()}
                    className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl hover:bg-stone-200/60 dark:hover:bg-stone-800 text-left font-medium text-stone-900 dark:text-stone-100 disabled:opacity-50"
                  >
                    <ImageIcon className="w-4 h-4 text-amber-800 dark:text-amber-400" />
                    <span>
                      {isUpdatingCover
                        ? 'Đang xử lý ảnh bìa...'
                        : 'Đổi bìa sách (Chọn ảnh từ máy)'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setMenuSubView('collections')}
                    className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl hover:bg-stone-200/60 dark:hover:bg-stone-800 text-left font-medium text-stone-900 dark:text-stone-100"
                  >
                    <FolderPlus className="w-4 h-4 text-amber-800 dark:text-amber-400" />
                    <span>Thêm vào bộ sưu tập</span>
                  </button>

                  {menuContext.collectionId && (
                    <button
                      type="button"
                      onClick={() => {
                        handleToggleBookInCollection(
                          menuContext.collectionId!,
                          menuContext.book.id
                        );
                        setMenuContext(null);
                      }}
                      className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl hover:bg-stone-200/60 dark:hover:bg-stone-800 text-left font-medium text-stone-700 dark:text-stone-300"
                    >
                      <X className="w-4 h-4" />
                      <span>Gỡ khỏi bộ sưu tập này</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      const report = cleanBookChaptersOnDevice(menuContext.book);
                      setCleanReport(report);
                      setMenuSubView('clean');
                    }}
                    className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl hover:bg-stone-200/60 dark:hover:bg-stone-800 text-left font-medium text-stone-900 dark:text-stone-100"
                  >
                    <Sparkles className="w-4 h-4 text-amber-800 dark:text-amber-400" />
                    <span>AI Lọc rác &amp; Chuẩn hóa EPUB</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const b = menuContext.book;
                      setMenuContext(null);
                      handleExportEpub(b);
                    }}
                    className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl hover:bg-stone-200/60 dark:hover:bg-stone-800 text-left font-medium text-stone-900 dark:text-stone-100"
                  >
                    <Download className="w-4 h-4 text-stone-600 dark:text-stone-400" />
                    <span>
                      {exportingId === menuContext.book.id ? 'Đang tạo EPUB...' : 'Xuất file .EPUB'}
                    </span>
                  </button>

                  <div className="my-1 border-t border-stone-200/80 dark:border-stone-800" />

                  <TwoTapDeleteButton
                    variant="row"
                    label="Xóa sách khỏi tủ"
                    confirmLabel="Ấn lần nữa để xác nhận xóa sách"
                    onConfirmDelete={() => {
                      const id = menuContext.book.id;
                      setMenuContext(null);
                      onDeleteBook(id);
                    }}
                  />
                </div>
              ) : menuSubView === 'clean' && cleanReport ? (
                <div className="p-3.5 pb-5 sm:pb-3.5 space-y-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-stone-800 dark:text-stone-200 inline-flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-amber-800 dark:text-amber-400" />
                      <span>AI Lọc rác &amp; Chuẩn hóa EPUB</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setMenuSubView('main')}
                      className="text-[11px] text-stone-500 hover:text-stone-900 dark:hover:text-stone-200"
                    >
                      ← Quay lại
                    </button>
                  </div>

                  <div className="p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/25 border border-amber-800/25 space-y-1.5">
                    <div className="font-medium text-stone-900 dark:text-stone-100">
                      Đã phát hiện &amp; lọc{' '}
                      <strong className="text-amber-800 dark:text-amber-400">
                        {cleanReport.removedCount}
                      </strong>{' '}
                      dòng rác HTML/quảng cáo và chuẩn hóa{' '}
                      <strong className="text-amber-800 dark:text-amber-400">
                        {cleanReport.cleanedCount}
                      </strong>{' '}
                      đoạn văn.
                    </div>
                    {cleanReport.removedSamples.length > 0 ? (
                      <ul className="max-h-28 overflow-y-auto space-y-1 text-[11px] text-stone-600 dark:text-stone-400 font-mono">
                        {cleanReport.removedSamples.map((s, idx) => (
                          <li key={idx} className="truncate">
                            ✕ {s}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                        Cuốn sách này hiện đã sạch mã HTML và quảng cáo web!
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        onUpdateBook(cleanReport.cleanedBook);
                        setMenuContext(null);
                        setMenuSubView('main');
                      }}
                      className="w-full py-2.5 px-3 rounded-xl bg-amber-800 text-white font-semibold hover:bg-amber-900"
                    >
                      Ghi đè lên file cũ
                    </button>
                    <button
                      type="button"
                      disabled={isSavingCleanedEpub}
                      onClick={async () => {
                        setIsSavingCleanedEpub(true);
                        try {
                          const newCopy: Book = {
                            ...cleanReport.cleanedBook,
                            id: `book-clean-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                            title: `${cleanReport.cleanedBook.title} (Bản sạch)`,
                            addedAt: Date.now(),
                            lastReadAt: Date.now(),
                          };
                          onDuplicateAsNewBook?.(newCopy);
                          const blob = await buildEpubBlob(newCopy);
                          downloadBlob(blob, `${slugifyFilename(newCopy.title)}.epub`);
                          setMenuContext(null);
                          setMenuSubView('main');
                        } finally {
                          setIsSavingCleanedEpub(false);
                        }
                      }}
                      className="w-full py-2.5 px-3 rounded-xl border border-stone-300 dark:border-stone-700 font-medium hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-50"
                    >
                      {isSavingCleanedEpub ? 'Đang xuất EPUB sạch...' : 'Lưu thành file EPUB mới'}
                    </button>
                  </div>
                </div>
              ) : menuSubView === 'rename' ? (
                <form onSubmit={handleSaveBookRename} className="p-3.5 pb-5 sm:pb-3.5 space-y-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-stone-800 dark:text-stone-200">
                      Đổi tên sách
                    </span>
                    <button
                      type="button"
                      onClick={() => setMenuSubView('main')}
                      className="text-[11px] text-stone-500 hover:text-stone-900 dark:hover:text-stone-200"
                    >
                      ← Quay lại
                    </button>
                  </div>

                  <label className="block space-y-1">
                    <span className="text-[11px] text-stone-500">Tên sách</span>
                    <input
                      type="text"
                      value={renameTitleInput}
                      onChange={(e) => setRenameTitleInput(e.target.value)}
                      placeholder="Nhập tên sách mới..."
                      aria-label="Tên sách mới"
                      required
                      autoFocus
                      className="w-full px-3 py-2 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 focus:outline-none focus:border-amber-700"
                    />
                  </label>

                  <label className="block space-y-1">
                    <span className="text-[11px] text-stone-500">Tác giả</span>
                    <input
                      type="text"
                      value={renameAuthorInput}
                      onChange={(e) => setRenameAuthorInput(e.target.value)}
                      placeholder="Tên tác giả..."
                      aria-label="Tên tác giả mới"
                      className="w-full px-3 py-2 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 focus:outline-none focus:border-amber-700"
                    />
                  </label>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setMenuSubView('main')}
                      className="flex-1 px-3 py-2 rounded-xl border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-300 font-medium"
                    >
                      Hủy
                    </button>
                    <button
                      type="submit"
                      className="flex-1 px-3 py-2 rounded-xl bg-amber-800 text-white font-semibold hover:bg-amber-900"
                    >
                      Lưu tên mới
                    </button>
                  </div>
                </form>
              ) : (
                <div className="p-3 pb-5 sm:pb-3 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-stone-800 dark:text-stone-200">
                      Chọn bộ sưu tập
                    </span>
                    <button
                      type="button"
                      onClick={() => setMenuSubView('main')}
                      className="text-[11px] text-stone-500 hover:text-stone-900"
                    >
                      ← Quay lại
                    </button>
                  </div>

                  {collections.length === 0 ? (
                    <p className="text-[11px] text-stone-500 py-2">
                      Chưa có bộ sưu tập nào. Hãy tạo bộ sưu tập mới cho cuốn sách này:
                    </p>
                  ) : (
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {[...collections]
                        .sort((a, b) => a.name.localeCompare(b.name, 'vi'))
                        .map((col) => {
                          const checked = col.bookIds.includes(menuContext.book.id);
                          return (
                            <button
                              key={col.id}
                              type="button"
                              onClick={() =>
                                handleToggleBookInCollection(col.id, menuContext.book.id)
                              }
                              className="w-full flex items-center justify-between px-3 py-2 rounded-xl border border-stone-200 dark:border-stone-800 hover:bg-stone-100 dark:hover:bg-stone-800 text-left"
                            >
                              <span className="font-medium truncate">{col.name}</span>
                              <span
                                className={`w-5 h-5 rounded-md flex items-center justify-center border ${
                                  checked
                                    ? 'bg-amber-800 border-amber-800 text-white'
                                    : 'border-stone-300 dark:border-stone-600'
                                }`}
                              >
                                {checked && <Check className="w-3 h-3" />}
                              </span>
                            </button>
                          );
                        })}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      const targetBookId = menuContext.book.id;
                      setMenuContext(null);
                      setEditingCollection(null);
                      setPreselectBookIds([targetBookId]);
                      setIsColModalOpen(true);
                    }}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-amber-800 text-white font-medium hover:bg-amber-900"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Tạo bộ sưu tập mới với sách này</span>
                  </button>
                </div>
              )}
            </div>
          </div>,
          document.body
        )}

      {/* User-Created Collection Creation / Book Selection Checklist Modal */}
      <CollectionModal
        isOpen={isColModalOpen}
        editingCollection={editingCollection}
        books={books}
        initialSelectedBookIds={preselectBookIds}
        onClose={() => setIsColModalOpen(false)}
        onSave={handleSaveCollection}
      />
    </main>
  );
};
