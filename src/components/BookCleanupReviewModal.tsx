import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Sparkles, Trash2, X } from 'lucide-react';
import type {
  BookCleanupReport,
  CleanupSelectableItem,
  CleanupSelection,
} from '../utils/aiContentCleaner';

interface BookCleanupReviewModalProps {
  isOpen: boolean;
  bookTitle: string;
  report: BookCleanupReport;
  confirmLabel?: string;
  keepOriginalLabel?: string;
  onConfirm?: (selection: CleanupSelection) => void;
  onConfirmItemIds?: (selectedItemIds: Set<string>) => void;
  onKeepOriginal: () => void;
}

export const BookCleanupReviewModal: React.FC<BookCleanupReviewModalProps> = ({
  isOpen,
  bookTitle,
  report,
  confirmLabel = 'Xóa',
  keepOriginalLabel = 'Hủy',
  onConfirm,
  onConfirmItemIds,
  onKeepOriginal,
}) => {
  const items: CleanupSelectableItem[] = useMemo(
    () => report.selectableItems || [],
    [report.selectableItems]
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(items.filter((it) => it.defaultChecked).map((it) => it.id))
  );

  if (!isOpen || typeof document === 'undefined') return null;

  const allSelected = items.length > 0 && selectedIds.size === items.length;

  const toggleItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((it) => it.id)));
    }
  };

  const totalAffectedFindings = items.reduce(
    (sum, it) => (selectedIds.has(it.id) ? sum + it.findingIds.length : sum),
    0
  );

  const handleApply = () => {
    if (onConfirmItemIds) {
      onConfirmItemIds(selectedIds);
      return;
    }
    if (onConfirm) {
      const activeCats = new Set(
        items.filter((it) => selectedIds.has(it.id)).map((it) => it.category)
      );
      onConfirm({
        addressesAndHeaders: activeCats.has('addressesAndHeaders'),
        typosAndCensored: activeCats.has('typosAndCensored'),
        repeatedNotes: activeCats.has('repeatedNotes'),
      });
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[90] ios-frosted-backdrop flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Xác nhận AI quét sạch nội dung sách"
      data-testid="book-cleanup-review-modal"
    >
      <div className="ios-sheet-enter ios-frosted-surface w-full max-w-md rounded-t-[24px] sm:rounded-[22px] text-stone-900 dark:text-stone-100 overflow-hidden max-h-[82dvh] flex flex-col">
        <div className="sm:hidden flex justify-center pt-1.5 pb-0.5 shrink-0">
          <span className="w-9 h-1 rounded-full bg-stone-300 dark:bg-stone-600" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-stone-200 dark:border-zinc-800 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-7 h-7 rounded-xl bg-amber-800/10 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[13px] font-display font-semibold truncate">
                AI Quét sạch nội dung
              </h2>
              <p className="text-[10.5px] text-stone-500 dark:text-stone-400 truncate">
                {bookTitle} · {items.length} mục phát hiện
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onKeepOriginal}
            aria-label="Đóng bảng AI quét sách"
            className="w-7 h-7 rounded-full bg-stone-100 dark:bg-zinc-800 flex items-center justify-center text-stone-500 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Select-all bar */}
        <div className="px-4 py-2 border-b border-stone-200/70 dark:border-zinc-800 flex items-center justify-between gap-2 text-[11px] bg-stone-50/70 dark:bg-zinc-900/50 shrink-0">
          <span className="text-stone-600 dark:text-stone-400">
            Tích chọn từng dòng/nhóm muốn xóa hoặc sửa:
          </span>
          <button
            type="button"
            onClick={toggleAll}
            className="font-semibold text-amber-800 dark:text-amber-300 hover:underline shrink-0"
          >
            {allSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
          </button>
        </div>

        {/* Individual Per-Line / Per-Group Selectable Checklist */}
        <div className="p-3 space-y-2 overflow-y-auto overscroll-contain text-xs flex-1 min-h-0">
          {items.map((item) => {
            const checked = selectedIds.has(item.id);
            const isRepeatGroup = Boolean(item.repeatTotalCount && item.repeatTotalCount >= 2);

            return (
              <div
                key={item.id}
                data-testid={`cleanup-item-${item.id}`}
                onClick={() => toggleItem(item.id)}
                className={`p-2.5 rounded-xl border transition-colors cursor-pointer flex items-start gap-2.5 ${
                  checked
                    ? 'border-amber-700/50 bg-amber-50/70 dark:bg-amber-950/25'
                    : 'border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900'
                }`}
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  aria-label={item.label}
                  data-testid={`cleanup-item-checkbox-${item.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleItem(item.id);
                  }}
                  className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                    checked
                      ? 'bg-amber-800 border-amber-800 text-white'
                      : 'border-stone-300 dark:border-zinc-600 bg-white dark:bg-zinc-950'
                  }`}
                >
                  {checked && <Check className="w-3 h-3 stroke-[2.6]" />}
                </button>

                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="text-[11.5px] font-semibold text-stone-900 dark:text-stone-100 leading-snug">
                    {item.label}
                  </div>
                  <div className="text-[10.5px] text-stone-600 dark:text-stone-400 break-words line-clamp-2">
                    “{item.excerpt}”
                  </div>
                  {item.cleanedPreview && (
                    <div className="text-[10.5px] text-emerald-700 dark:text-emerald-400 font-medium break-words line-clamp-2">
                      → {item.cleanedPreview}
                    </div>
                  )}
                  {isRepeatGroup && (
                    <div className="text-[10px] text-emerald-700 dark:text-emerald-400 font-medium">
                      Bảo toàn 1 bản gốc đầu tiên, chỉ xóa {item.duplicateRemoveCount} bản lặp thừa.
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer Buttons */}
        <div className="px-4 py-3 border-t border-stone-200 dark:border-zinc-800 grid grid-cols-2 gap-2 shrink-0 bg-white dark:bg-zinc-950">
          <button
            type="button"
            data-testid="cleanup-keep-original-btn"
            onClick={onKeepOriginal}
            className="h-9 px-3 rounded-xl border border-stone-300 dark:border-zinc-700 text-[12px] font-semibold text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-zinc-800"
          >
            {keepOriginalLabel}
          </button>
          <button
            type="button"
            data-testid="cleanup-apply-btn"
            disabled={selectedIds.size === 0}
            onClick={handleApply}
            className="h-9 px-3 rounded-xl bg-amber-800 hover:bg-amber-900 disabled:opacity-45 text-white text-[12px] font-semibold shadow-sm inline-flex items-center justify-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5 shrink-0" />
            <span>
              {totalAffectedFindings > 0
                ? `${confirmLabel} (${totalAffectedFindings})`
                : confirmLabel}
            </span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
