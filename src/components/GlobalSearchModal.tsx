import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowRight,
  BookOpen,
  Cloud,
  FolderOpen,
  Globe,
  Languages,
  Mic2,
  Search,
  Settings,
  Upload,
  X,
} from 'lucide-react';
import type { Book, UserCollection } from '../types/book';
import {
  searchEntireApp,
  type GlobalSearchAction,
  type GlobalSearchCategory,
} from '../utils/globalSearch';

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  books: Book[];
  collections: UserCollection[];
  onSelectAction: (action: GlobalSearchAction) => void;
}

const QUICK_CHIPS = [
  'Cài đặt',
  'Google Drive',
  'Tải sách',
  'Gói ngôn ngữ',
  'Giọng AI',
  'Quét Web',
];

function CategoryIcon({ category }: { category: GlobalSearchCategory }) {
  switch (category) {
    case 'book':
      return <BookOpen className="w-4 h-4 text-amber-800 dark:text-amber-400 shrink-0" />;
    case 'collection':
      return <FolderOpen className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />;
    case 'sync':
      return <Cloud className="w-4 h-4 text-sky-700 dark:text-sky-400 shrink-0" />;
    case 'settings':
      return <Settings className="w-4 h-4 text-stone-700 dark:text-stone-300 shrink-0" />;
    case 'import':
      return <Upload className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />;
    case 'web':
      return <Globe className="w-4 h-4 text-indigo-700 dark:text-indigo-400 shrink-0" />;
    case 'language':
      return <Languages className="w-4 h-4 text-amber-800 dark:text-amber-400 shrink-0" />;
    case 'studio':
      return <Mic2 className="w-4 h-4 text-rose-700 dark:text-rose-400 shrink-0" />;
  }
}

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({
  isOpen,
  onClose,
  books,
  collections,
  onSelectAction,
}) => {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    const t = window.setTimeout(() => inputRef.current?.focus(), 40);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onClose]);

  const results = useMemo(
    () => searchEntireApp(query, books, collections, 24),
    [query, books, collections]
  );

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[85] bg-black/45 backdrop-blur-xs flex items-start justify-center p-3 sm:p-6 pt-12 sm:pt-16"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Tìm kiếm toàn ứng dụng"
        className="ios-sheet-enter w-full max-w-xl h-auto max-h-[82dvh] rounded-2xl bg-[#FBF9F5] dark:bg-[#181A1F] border border-stone-200 dark:border-stone-800 shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Search Input Header */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-stone-200 dark:border-stone-800 bg-white dark:bg-[#14161A]">
          <Search className="w-4 h-4 text-amber-800 dark:text-amber-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            role="searchbox"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm sách, bộ sưu tập, cài đặt, Google Drive, tải sách, giọng AI..."
            aria-label="Ô tìm kiếm mọi nội dung trong ứng dụng"
            className="flex-1 min-w-0 bg-transparent text-sm text-stone-900 dark:text-stone-100 placeholder:text-stone-400 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Xóa từ khóa tìm kiếm"
              className="text-xs px-2 py-1 rounded-md text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
            >
              Xóa
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng tìm kiếm toàn ứng dụng"
            className="w-8 h-8 rounded-full bg-stone-100 dark:bg-stone-800 flex items-center justify-center text-stone-600 dark:text-stone-300 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Quick-filter suggestion chips */}
        <div className="px-4 py-2.5 border-b border-stone-200/70 dark:border-stone-800/80 flex items-center gap-1.5 flex-wrap bg-stone-50/70 dark:bg-stone-900/40">
          <span className="text-[11px] text-stone-500 mr-1">Gợi ý nhanh:</span>
          {QUICK_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => setQuery(chip)}
              className="px-2.5 py-1 rounded-lg bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-[11px] font-medium text-stone-700 dark:text-stone-200 hover:border-amber-700 transition-colors"
            >
              {chip}
            </button>
          ))}
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {results.length === 0 ? (
            <div className="py-10 text-center space-y-1">
              <p className="text-sm font-medium text-stone-700 dark:text-stone-300">
                Không tìm thấy kết quả cho &ldquo;{query}&rdquo;
              </p>
              <p className="text-xs text-stone-500">
                Thử tìm bằng từ khóa khác như: Cài đặt, Đồng bộ, Tải sách, Giọng AI, hoặc tên sách.
              </p>
            </div>
          ) : (
            results.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelectAction(item.action);
                  onClose();
                }}
                className="w-full flex items-center justify-between gap-3 p-3 rounded-xl bg-white dark:bg-[#1E2026] border border-stone-200/80 dark:border-stone-800 hover:border-amber-700 dark:hover:border-amber-500 text-left transition-colors group"
              >
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className="mt-0.5 p-2 rounded-lg bg-stone-100 dark:bg-stone-900 shrink-0">
                    <CategoryIcon category={item.category} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-stone-900 dark:text-stone-100 leading-snug break-words">
                        {item.title}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 shrink-0">
                        {item.categoryLabel}
                      </span>
                    </div>
                    <p className="text-[11px] text-stone-500 dark:text-stone-400 line-clamp-1 mt-0.5">
                      {item.subtitle}
                    </p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-stone-400 group-hover:text-amber-700 dark:group-hover:text-amber-400 shrink-0" />
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
