import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, FolderPlus, Search, X } from 'lucide-react';
import type { Book, UserCollection } from '../types/book';

interface CollectionModalProps {
  isOpen: boolean;
  editingCollection: UserCollection | null;
  books: Book[];
  initialSelectedBookIds?: string[];
  onClose: () => void;
  onSave: (name: string, bookIds: string[], existingId?: string) => void;
}

export const CollectionModal: React.FC<CollectionModalProps> = ({
  isOpen,
  editingCollection,
  books,
  initialSelectedBookIds = [],
  onClose,
  onSave,
}) => {
  const [name, setName] = useState('');
  const [searchText, setSearchText] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setName(editingCollection?.name || '');
    setSelectedIds(
      editingCollection
        ? editingCollection.bookIds.filter((id) => books.some((b) => b.id === id))
        : initialSelectedBookIds
    );
    setSearchText('');
    setErrorMsg('');
  }, [isOpen, editingCollection, initialSelectedBookIds, books]);

  const filteredBooks = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return books;
    return books.filter(
      (b) =>
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q)
    );
  }, [books, searchText]);

  if (!isOpen || typeof document === 'undefined') return null;

  const toggleBook = (bookId: string) => {
    setSelectedIds((prev) =>
      prev.includes(bookId) ? prev.filter((id) => id !== bookId) : [...prev, bookId]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      setErrorMsg('Vui lòng nhập tên bộ sưu tập.');
      return;
    }
    onSave(cleanName, selectedIds, editingCollection?.id);
    onClose();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/45 backdrop-blur-md p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={editingCollection ? 'Chỉnh sửa bộ sưu tập' : 'Tạo bộ sưu tập mới'}
        className="ios-sheet-enter w-full sm:max-w-lg max-h-[88vh] bg-[#FBF9F5] dark:bg-[#16181C] rounded-t-[28px] sm:rounded-[26px] border border-white/60 dark:border-stone-800 shadow-2xl flex flex-col overflow-hidden"
      >
        <div className="sm:hidden flex justify-center pt-2.5">
          <div className="w-10 h-1 rounded-full bg-stone-300 dark:bg-stone-700" />
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200/80 dark:border-stone-800">
          <div className="flex items-center gap-2">
            <FolderPlus className="w-4 h-4 text-amber-800 dark:text-amber-400" />
            <h2 className="text-base font-display font-semibold text-stone-900 dark:text-stone-100">
              {editingCollection ? 'Cập nhật bộ sưu tập' : 'Tạo bộ sưu tập mới'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng hộp thoại bộ sưu tập"
            className="w-8 h-8 rounded-full bg-stone-200/70 dark:bg-stone-800 flex items-center justify-center text-stone-600 dark:text-stone-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
          <div className="p-5 space-y-4 flex-1 overflow-y-auto">
            <div>
              <label
                htmlFor="collection-name-input"
                className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1.5"
              >
                Tên bộ sưu tập
              </label>
              <input
                id="collection-name-input"
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setErrorMsg('');
                }}
                placeholder="VD: Tiểu thuyết yêu thích, Sách học tập..."
                autoFocus
                className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 focus:outline-none focus:border-amber-800"
              />
              {errorMsg && (
                <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{errorMsg}</p>
              )}
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-stone-700 dark:text-stone-300">
                  Chọn sách thêm vào ({selectedIds.length} đã chọn)
                </span>
                {filteredBooks.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const visibleIds = filteredBooks.map((b) => b.id);
                      const allSelected = visibleIds.every((id) => selectedIds.includes(id));
                      if (allSelected) {
                        setSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
                      } else {
                        setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
                      }
                    }}
                    className="text-[11px] font-medium text-amber-800 dark:text-amber-400 hover:underline"
                  >
                    {filteredBooks.every((b) => selectedIds.includes(b.id))
                      ? 'Bỏ chọn tất cả'
                      : 'Chọn tất cả'}
                  </button>
                )}
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Tìm sách theo tên hoặc tác giả..."
                  aria-label="Tìm kiếm sách để thêm vào bộ sưu tập"
                  className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 focus:outline-none focus:border-amber-800"
                />
              </div>

              <div className="max-h-60 overflow-y-auto divide-y divide-stone-200/70 dark:divide-stone-800 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/60">
                {filteredBooks.length === 0 ? (
                  <div className="p-6 text-center text-xs text-stone-500">
                    Không tìm thấy sách phù hợp với từ khóa.
                  </div>
                ) : (
                  filteredBooks.map((book) => {
                    const checked = selectedIds.includes(book.id);
                    return (
                      <button
                        key={book.id}
                        type="button"
                        role="checkbox"
                        aria-checked={checked}
                        onClick={() => toggleBook(book.id)}
                        className={`w-full flex items-center gap-3 p-2.5 text-left transition-colors ${
                          checked
                            ? 'bg-amber-50/80 dark:bg-amber-950/30'
                            : 'hover:bg-stone-100/70 dark:hover:bg-stone-800/60'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`w-5 h-5 rounded-md flex items-center justify-center border shrink-0 transition-colors ${
                            checked
                              ? 'bg-amber-800 border-amber-800 text-white'
                              : 'border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800'
                          }`}
                        >
                          {checked && <Check className="w-3.5 h-3.5" />}
                        </span>
                        <div className="w-8 h-11 rounded overflow-hidden bg-stone-200 dark:bg-stone-800 shrink-0">
                          {book.coverUrl ? (
                            <img
                              src={book.coverUrl}
                              alt=""
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[9px] font-display font-bold text-stone-600 dark:text-stone-300">
                              {book.title.slice(0, 2)}
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-stone-900 dark:text-stone-100 truncate">
                            {book.title}
                          </div>
                          <div className="text-[11px] text-stone-500 truncate">
                            {book.author} · {book.progressPercent}%
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <div className="px-5 py-3.5 border-t border-stone-200/80 dark:border-stone-800 flex items-center justify-end gap-2.5 bg-white/60 dark:bg-stone-900/50">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-stone-300 dark:border-stone-700 text-xs font-medium text-stone-700 dark:text-stone-300"
            >
              Hủy
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-amber-800 text-white text-xs font-semibold hover:bg-amber-900"
            >
              {editingCollection ? 'Lưu thay đổi' : 'Tạo bộ sưu tập'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
