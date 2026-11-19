import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BookOpen,
  Check,
  Clock,
  Download,
  Edit3,
  FolderOpen,
  FolderPlus,
  Globe,
  Headphones,
  MoreVertical,
  Plus,
  RotateCcw,
  Search,
  Trash2,
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
import { buildLibraryCollectionZip } from '../utils/webCrawlerEngine';
import { downloadBlob, slugifyFilename } from '../utils/fileHelpers';
import { getMonthlyReadingChart, getWeeklyReadingChart } from '../utils/syncAndStats';
import { CollectionModal } from './CollectionModal';

interface LibraryViewProps {
  books: Book[];
  collections: UserCollection[];
  readingLogs: ReadingLogEntry[];
  onOpenBook: (bookId: string, openAudioStudio?: boolean) => void;
  onUpdateBook: (book: Book) => void;
  onDeleteBook: (bookId: string) => void;
  onUpdateCollections: (collections: UserCollection[]) => void;
  onOpenImportModal: () => void;
  onGoToWebScraper: () => void;
  onRestoreSamples: () => void;
}

type LibraryShelfTab = 'all' | 'imported' | 'downloaded' | 'collections';
type SortMode = 'recent' | 'title_asc' | 'title_desc' | 'author_asc' | 'progress_desc';

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
  onDeleteBook,
  onUpdateCollections,
  onOpenImportModal,
  onGoToWebScraper,
  onRestoreSamples,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [shelfTab, setShelfTab] = useState<LibraryShelfTab>('all');
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [chartPeriod, setChartPeriod] = useState<'week' | 'month'>('week');
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [isExportingArchive, setIsExportingArchive] = useState(false);

  // Three-dot action menu state
  const [menuContext, setMenuContext] = useState<{
    book: Book;
    collectionId?: string;
  } | null>(null);
  const [showAddToColPicker, setShowAddToColPicker] = useState(false);

  // User-created Collection Modal state
  const [isColModalOpen, setIsColModalOpen] = useState(false);
  const [editingCollection, setEditingCollection] = useState<UserCollection | null>(null);
  const [preselectBookIds, setPreselectBookIds] = useState<string[]>([]);

  const recentBooks = useMemo(
    () => [...books].sort((a, b) => b.lastReadAt - a.lastReadAt).slice(0, 4),
    [books]
  );

  const featuredBook = recentBooks[0];

  const chartData = useMemo(() => {
    return chartPeriod === 'week'
      ? getWeeklyReadingChart(readingLogs)
      : getMonthlyReadingChart(readingLogs);
  }, [chartPeriod, readingLogs]);

  const maxBucketMinutes = Math.max(10, ...chartData.buckets.map((b) => b.minutes));

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

    return [...filtered].sort((a, b) => {
      if (sortMode === 'title_asc') return a.title.localeCompare(b.title, 'vi');
      if (sortMode === 'title_desc') return b.title.localeCompare(a.title, 'vi');
      if (sortMode === 'author_asc') return a.author.localeCompare(b.author, 'vi');
      if (sortMode === 'progress_desc') return b.progressPercent - a.progressPercent;
      return b.lastReadAt - a.lastReadAt;
    });
  }, [books, searchQuery, shelfTab, sortMode]);

  // User-created collections sorted A -> Z (empty until user creates them)
  const sortedCollections = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return [...collections]
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'))
      .map((col) => {
        const colBooks = col.bookIds
          .map((id) => books.find((b) => b.id === id))
          .filter((b): b is Book => Boolean(b))
          .filter(
            (b) =>
              !q ||
              col.name.toLowerCase().includes(q) ||
              b.title.toLowerCase().includes(q) ||
              b.author.toLowerCase().includes(q)
          );
        return {
          ...col,
          resolvedBooks: colBooks,
        };
      })
      .filter((col) => !q || col.name.toLowerCase().includes(q) || col.resolvedBooks.length > 0);
  }, [collections, books, searchQuery]);

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

  const handleExportLibraryZip = async () => {
    if (books.length === 0) return;
    setIsExportingArchive(true);
    try {
      const bookCollectionMap = new Map<string, string>();
      for (const col of collections) {
        for (const id of col.bookIds) {
          if (!bookCollectionMap.has(id)) bookCollectionMap.set(id, col.name);
        }
      }
      const booksForZip = books.map((b) => ({
        ...b,
        collection: bookCollectionMap.get(b.id) || 'Kho-sach-rieng',
      }));
      const zipBlob = await buildLibraryCollectionZip(booksForZip);
      const dateTag = new Date().toISOString().slice(0, 10);
      downloadBlob(zipBlob, `LaziRead-ThuVien-BoSuuTap-${dateTag}.zip`);
    } finally {
      setIsExportingArchive(false);
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
    setShowAddToColPicker(false);
    setMenuContext({ book, collectionId });
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
              <div className="w-full h-full p-2.5 flex flex-col justify-between bg-gradient-to-br from-[#EDE8DC] to-[#DFD7C5] dark:from-stone-800 dark:to-stone-900 text-stone-900 dark:text-stone-100">
                <span className="text-[8px] sm:text-[9px] uppercase tracking-wider text-stone-500 dark:text-stone-400 truncate">
                  {SOURCE_LABELS[book.sourceType]}
                </span>
                <span className="font-display text-[11px] sm:text-xs font-semibold line-clamp-3 leading-snug">
                  {book.title}
                </span>
                <span className="text-[9px] text-stone-600 dark:text-stone-400 truncate">
                  {book.author}
                </span>
              </div>
            )}

            {/* Compact progress badge overlay */}
            <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-black/65 text-white text-[9px] font-medium tabular-nums backdrop-blur-xs">
              {book.progressPercent}%
            </span>
          </div>
        </button>

        {/* Title + Corner 3-dot Menu Trigger */}
        <div className="px-2 py-2 flex items-start justify-between gap-1">
          <button
            type="button"
            onClick={() => onOpenBook(book.id)}
            className="text-left min-w-0 flex-1 focus:outline-none"
          >
            <h3 className="text-[11px] sm:text-xs font-semibold text-stone-900 dark:text-stone-100 line-clamp-2 leading-snug">
              {book.title}
            </h3>
            <p className="text-[9.5px] sm:text-[10px] text-stone-500 dark:text-stone-400 truncate mt-0.5 tabular-nums">
              {stats.chapterCount} ch · {book.author}
            </p>
          </button>

          <button
            type="button"
            onClick={(e) => openBookOptionsMenu(book, e, collectionId)}
            aria-label={`Tùy chọn cho ${book.title}`}
            className="w-6 h-6 -mr-1 -mt-0.5 rounded-full flex items-center justify-center text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-100 dark:hover:bg-stone-800 shrink-0"
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
        </div>
      </article>
    );
  };

  return (
    <main className="max-w-7xl mx-auto px-3.5 sm:px-6 lg:px-8 py-5 sm:py-7 space-y-8">
      {/* 1. TRÊN CÙNG: SÁCH MỚI ĐỌC */}
      {recentBooks.length > 0 && (
        <section aria-label="Sách mới đọc" className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-sm sm:text-base font-display font-semibold text-stone-900 dark:text-stone-100">
              Sách mới đọc
            </h1>
            {featuredBook && (
              <button
                type="button"
                onClick={() => onOpenBook(featuredBook.id)}
                className="text-xs font-medium text-amber-800 dark:text-amber-400 hover:underline"
              >
                Đọc tiếp ngay →
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
            {recentBooks.map((b) => (
              <div
                key={b.id}
                className="ios-tap-card relative flex items-center gap-2.5 p-2.5 rounded-2xl border border-stone-200/90 dark:border-stone-800 bg-white dark:bg-[#16181C] shadow-xs hover:shadow-md hover:border-amber-800"
              >
                <button
                  type="button"
                  onClick={() => onOpenBook(b.id)}
                  className="flex items-center gap-2.5 min-w-0 flex-1 text-left focus:outline-none"
                >
                  <div className="w-10 h-14 rounded-lg overflow-hidden bg-stone-200 dark:bg-stone-800 shrink-0">
                    {b.coverUrl ? (
                      <img
                        src={b.coverUrl}
                        alt={b.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[10px] font-display font-bold p-1 text-center">
                        {b.title.slice(0, 2)}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-stone-900 dark:text-stone-100 truncate">
                      {b.title}
                    </div>
                    <div className="text-[10.5px] text-stone-500 truncate">{b.author}</div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <div className="flex-1 h-1 bg-stone-200 dark:bg-stone-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-800 dark:bg-amber-600"
                          style={{ width: `${b.progressPercent}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-stone-500 tabular-nums">
                        {b.progressPercent}%
                      </span>
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={(e) => openBookOptionsMenu(b, e)}
                  aria-label={`Tùy chọn cho ${b.title}`}
                  className="p-1 rounded-full text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-100 dark:hover:bg-stone-800 shrink-0 self-start"
                >
                  <MoreVertical className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 2. TIẾP THEO: KHO SÁCH RIÊNG & BỘ SƯU TẬP */}
      <section aria-label="Thư viện riêng và Bộ sưu tập" className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base sm:text-lg font-display font-semibold text-stone-900 dark:text-stone-100">
            Kho sách riêng
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onGoToWebScraper}
              className="ios-liquid-pill inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full ios-liquid-bar border border-white/75 dark:border-zinc-700/60 text-xs font-medium text-stone-700 dark:text-stone-200 hover:text-amber-800 whitespace-nowrap"
            >
              <Globe className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Cộng đồng Web</span>
              <span className="sm:hidden">Web</span>
            </button>
            <button
              type="button"
              onClick={onOpenImportModal}
              className="ios-liquid-btn inline-flex items-center gap-1 px-3.5 py-1.5 rounded-full bg-amber-800 text-white text-xs font-semibold hover:bg-amber-900 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Thêm sách</span>
            </button>
          </div>
        </div>

        {/* Liquid-Glass Rounded Tabs + Search / Sort Controls */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="grid grid-cols-2 sm:inline-flex p-1 ios-liquid-bar border border-white/75 dark:border-zinc-700/60 rounded-[22px] sm:rounded-full gap-1">
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
                onClick={() => setShelfTab(tab.id)}
                className={`ios-liquid-pill px-3 sm:px-3.5 py-1.5 text-[11px] sm:text-xs font-medium rounded-full whitespace-nowrap min-h-[34px] text-center ${
                  shelfTab === tab.id
                    ? 'ios-liquid-pill-active text-amber-800 dark:text-amber-300 font-semibold'
                    : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white hover:bg-white/45 dark:hover:bg-white/10'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:w-56">
              <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm sách, tác giả..."
                aria-label="Tìm kiếm sách trong tủ"
                className="w-full pl-9 pr-3.5 py-2 text-xs rounded-full ios-liquid-bar border border-white/75 dark:border-zinc-700/60 text-stone-900 dark:text-stone-100 focus:outline-none min-h-[38px]"
              />
            </div>

            {shelfTab !== 'collections' && (
              <select
                aria-label="Sắp xếp sách"
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                className="ios-liquid-pill px-3.5 py-2 text-xs font-medium rounded-full ios-liquid-bar border border-white/75 dark:border-zinc-700/60 text-stone-800 dark:text-stone-100 min-h-[38px]"
              >
                <option value="recent">Đọc gần đây</option>
                <option value="title_asc">Tên A → Z</option>
                <option value="title_desc">Tên Z → A</option>
                <option value="author_asc">Tác giả A → Z</option>
                <option value="progress_desc">Tiến độ cao nhất</option>
              </select>
            )}
          </div>
        </div>

        {/* User-Created Collections View OR 3-up Horizontal Book Grid */}
        {shelfTab === 'collections' ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-stone-500 dark:text-stone-400">
                Tự tạo bộ sưu tập theo chủ đề của bạn (tự động xếp theo A → Z)
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
            ) : sortedCollections.length === 0 ? (
              <div className="border border-stone-200 dark:border-stone-800 rounded-2xl p-8 text-center text-xs text-stone-500">
                Không tìm thấy bộ sưu tập hoặc sách nào khớp với từ khóa tìm kiếm.
              </div>
            ) : (
              <div className="space-y-6">
                {sortedCollections.map((col) => (
                  <div
                    key={col.id}
                    className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white/75 dark:bg-[#16181C] p-4 space-y-3.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-stone-200/80 dark:border-stone-800">
                      <div className="flex items-center gap-2 min-w-0">
                        <FolderOpen className="w-4 h-4 text-amber-800 dark:text-amber-400 shrink-0" />
                        <h3 className="text-sm sm:text-base font-display font-semibold text-stone-900 dark:text-stone-100 truncate">
                          {col.name}
                        </h3>
                        <span className="text-[11px] text-stone-500 tabular-nums shrink-0">
                          ({col.resolvedBooks.length} cuốn)
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingCollection(col);
                            setPreselectBookIds([]);
                            setIsColModalOpen(true);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-stone-300 dark:border-stone-700 text-[11px] font-medium hover:bg-stone-100 dark:hover:bg-stone-800"
                        >
                          <Plus className="w-3 h-3" />
                          <span>Thêm / Sửa sách</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingCollection(col);
                            setPreselectBookIds([]);
                            setIsColModalOpen(true);
                          }}
                          aria-label={`Đổi tên bộ sưu tập ${col.name}`}
                          className="p-1.5 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteCollection(col.id)}
                          aria-label={`Xóa bộ sưu tập ${col.name}`}
                          className="p-1.5 rounded-lg text-stone-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {col.resolvedBooks.length === 0 ? (
                      <div className="py-5 text-center text-xs text-stone-500">
                        Bộ sưu tập này chưa có sách nào. Nhấn &quot;Thêm / Sửa sách&quot; để chọn sách thêm vào.
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2.5 sm:gap-4">
                        {col.resolvedBooks.map((book) => renderCompactBookCard(book, col.id))}
                      </div>
                    )}
                  </div>
                ))}
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
        ) : (
          <div
            data-testid="book-grid"
            className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2.5 sm:gap-4"
          >
            {filteredAndSortedBooks.map((book) => renderCompactBookCard(book))}
          </div>
        )}
      </section>

      {/* 3. XUỐNG PHÍA DƯỚI: CÁC MỤC CÒN LẠI (ĐỌC TIẾP CHI TIẾT, THỜI GIAN ĐỌC & TRÍCH XUẤT KHO ZIP) */}
      <section
        aria-label="Thông tin đọc, thời gian đọc và kho lưu trữ"
        className="pt-6 border-t border-stone-200 dark:border-stone-800 space-y-6"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {featuredBook && (
            <div
              aria-label="Sách đang đọc gần đây"
              className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-12 gap-5 items-center border border-stone-200 dark:border-stone-800 rounded-2xl bg-white/75 dark:bg-[#16181C] p-5"
            >
              <div className="sm:col-span-8 space-y-3">
                <p className="text-[11px] uppercase tracking-widest text-stone-500 dark:text-stone-400">
                  Tiếp tục đọc · {SOURCE_LABELS[featuredBook.sourceType]} ·{' '}
                  {STYLE_LABELS[featuredBook.readingStyle || 'novel']}
                </p>
                <h2 className="text-xl sm:text-2xl font-display font-semibold text-stone-900 dark:text-stone-100 leading-tight">
                  {featuredBook.title}
                </h2>
                <p className="text-xs text-stone-600 dark:text-stone-400 line-clamp-2 leading-relaxed">
                  {featuredBook.description}
                </p>

                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-stone-500 dark:text-stone-400 tabular-nums">
                  <span>{featuredBook.author}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Chương {featuredBook.currentChapterIndex + 1}/{featuredBook.chapters.length}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>Đã đọc {featuredBook.progressPercent}%</span>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => onOpenBook(featuredBook.id)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-xs font-medium hover:opacity-90 whitespace-nowrap"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>Đọc tiếp ngay</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenBook(featuredBook.id, true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-800 text-white text-xs font-medium hover:bg-amber-900 whitespace-nowrap"
                  >
                    <Headphones className="w-3.5 h-3.5" />
                    <span>Nghe tiếp giọng AI</span>
                  </button>
                </div>
              </div>

              <div className="sm:col-span-4 flex justify-start sm:justify-end">
                <button
                  type="button"
                  onClick={() => onOpenBook(featuredBook.id)}
                  aria-label={`Mở đọc sách ${featuredBook.title}`}
                  className="group relative w-28 sm:w-full max-w-[140px] aspect-[3/4] rounded-xl overflow-hidden border border-stone-200 dark:border-stone-800 shadow-md"
                >
                  {featuredBook.coverUrl ? (
                    <img
                      src={featuredBook.coverUrl}
                      alt={`Bìa sách ${featuredBook.title}`}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-stone-200 to-stone-300 dark:from-stone-800 dark:to-stone-900 p-3 flex flex-col justify-between">
                      <span className="text-[10px] text-stone-500">{featuredBook.author}</span>
                      <span className="font-display text-sm font-semibold">
                        {featuredBook.title}
                      </span>
                    </div>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Weekly / Monthly Reading Time Chart */}
          <div
            aria-label="Thống kê thời gian đọc sách"
            className="lg:col-span-5 border border-stone-200 dark:border-stone-800 rounded-2xl bg-white dark:bg-[#16181C] p-5 flex flex-col justify-between space-y-4"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-stone-800 dark:text-stone-200">
                  <Clock className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400" />
                  <span>Thời gian đọc</span>
                </div>
                <div className="text-2xl font-display font-bold text-stone-900 dark:text-stone-100 tabular-nums mt-1">
                  {chartData.totalMinutes} phút
                </div>
              </div>

              <div className="inline-flex p-1 rounded-full ios-liquid-bar border border-white/75 dark:border-zinc-700/60 text-[11px] font-medium gap-1">
                <button
                  type="button"
                  onClick={() => setChartPeriod('week')}
                  className={`ios-liquid-pill px-3 py-1 rounded-full ${
                    chartPeriod === 'week'
                      ? 'ios-liquid-pill-active text-amber-800 dark:text-amber-300 font-semibold'
                      : 'text-stone-600 dark:text-stone-300'
                  }`}
                >
                  Tuần
                </button>
                <button
                  type="button"
                  onClick={() => setChartPeriod('month')}
                  className={`ios-liquid-pill px-3 py-1 rounded-full ${
                    chartPeriod === 'month'
                      ? 'ios-liquid-pill-active text-amber-800 dark:text-amber-300 font-semibold'
                      : 'text-stone-600 dark:text-stone-300'
                  }`}
                >
                  Tháng
                </button>
              </div>
            </div>

            <div
              className="grid items-end gap-2 h-24 pt-2"
              style={{ gridTemplateColumns: `repeat(${chartData.buckets.length}, minmax(0, 1fr))` }}
            >
              {chartData.buckets.map((bucket) => {
                const pct = Math.max(8, Math.round((bucket.minutes / maxBucketMinutes) * 100));
                return (
                  <div key={bucket.label} className="flex flex-col items-center justify-end h-full gap-1">
                    <span className="text-[10px] text-stone-500 tabular-nums">{bucket.minutes}p</span>
                    <div className="w-full flex-1 flex items-end">
                      <div
                        className="w-full rounded-t-md bg-amber-800/85 dark:bg-amber-600/85 transition-all"
                        style={{ height: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-stone-500 whitespace-nowrap">
                      {bucket.label === 'Hôm nay' ? 'Nay' : bucket.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Archive Export Footer Banner */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-white/80 dark:bg-[#16181C]">
          <div className="flex items-start sm:items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-lg bg-amber-100/80 dark:bg-amber-950/50 text-amber-800 dark:text-amber-400 shrink-0">
              <FolderOpen className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-stone-900 dark:text-stone-100 truncate">
                Kho lưu trữ: Thư viện / Bộ sưu tập sách
              </div>
              <div className="text-[11px] text-stone-500 dark:text-stone-400">
                Xuất toàn bộ {books.length} cuốn sách và {collections.length} bộ sưu tập thành file .ZIP chứa các EPUB
              </div>
            </div>
          </div>
          <button
            type="button"
            disabled={isExportingArchive || books.length === 0}
            onClick={handleExportLibraryZip}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg border border-amber-800 text-amber-900 dark:text-amber-300 text-xs font-medium hover:bg-amber-50 dark:hover:bg-amber-950/30 whitespace-nowrap disabled:opacity-40 min-h-[40px]"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isExportingArchive ? 'Đang nén kho...' : 'Trích xuất kho (.ZIP)'}</span>
          </button>
        </div>
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

              {!showAddToColPicker ? (
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
                    onClick={() => setShowAddToColPicker(true)}
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

                  <button
                    type="button"
                    onClick={() => {
                      const id = menuContext.book.id;
                      setMenuContext(null);
                      onDeleteBook(id);
                    }}
                    className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl hover:bg-red-50 dark:hover:bg-red-950/40 text-left font-medium text-red-600 dark:text-red-400"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Xóa sách khỏi tủ</span>
                  </button>
                </div>
              ) : (
                <div className="p-3 pb-5 sm:pb-3 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-stone-800 dark:text-stone-200">
                      Chọn bộ sưu tập
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowAddToColPicker(false)}
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
