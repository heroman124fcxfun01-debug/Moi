import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Sparkles, X } from 'lucide-react';
import type {
  BookCleanupReport,
  CleanupCategory,
  CleanupSelection,
} from '../utils/aiContentCleaner';

interface BookCleanupReviewModalProps {
  isOpen: boolean;
  bookTitle: string;
  report: BookCleanupReport;
  confirmLabel?: string;
  keepOriginalLabel?: string;
  onConfirm: (selection: CleanupSelection) => void;
  onKeepOriginal: () => void;
}

const CATEGORY_META: Array<{
  key: CleanupCategory;
  title: string;
  subtitle: string;
}> = [
  {
    key: 'addressesAndHeaders',
    title: 'Xóa địa chỉ thừa & tiêu đề',
    subtitle: 'Link http, vtbook, cuối trang, dấu gạch & ký hiệu thừa',
  },
  {
    key: 'typosAndCensored',
    title: 'Sửa chữ sai & từ bị che',
    subtitle: 'Khôi phục l*n đ*nh → lên đỉnh, ci → chị, lỗi cú pháp',
  },
  {
    key: 'repeatedNotes',
    title: 'Xóa chú thích lặp lại',
    subtitle: 'Dòng chú thích, lời nhắn & chân trang lặp nhiều lần',
  },
];

export const BookCleanupReviewModal: React.FC<BookCleanupReviewModalProps> = ({
  isOpen,
  bookTitle,
  report,
  confirmLabel = 'Áp dụng',
  keepOriginalLabel = 'Giữ nguyên',
  onConfirm,
  onKeepOriginal,
}) => {
  const [selection, setSelection] = useState<CleanupSelection>(() => ({
    addressesAndHeaders: report.categoryCounts.addressesAndHeaders > 0,
    typosAndCensored: report.categoryCounts.typosAndCensored > 0,
    repeatedNotes: report.categoryCounts.repeatedNotes > 0,
  }));
  const [expandedKey, setExpandedKey] = useState<CleanupCategory | null>(null);

  if (!isOpen || typeof document === 'undefined') return null;

  const selectedCount =
    (selection.addressesAndHeaders ? report.categoryCounts.addressesAndHeaders : 0) +
    (selection.typosAndCensored ? report.categoryCounts.typosAndCensored : 0) +
    (selection.repeatedNotes ? report.categoryCounts.repeatedNotes : 0);

  const toggleCategory = (key: CleanupCategory) => {
    setSelection((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[90] ios-frosted-backdrop flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Xác nhận AI quét sạch nội dung sách"
      data-testid="book-cleanup-review-modal"
    >
      <div className="ios-sheet-enter ios-frosted-surface w-full max-w-md rounded-t-[24px] sm:rounded-[22px] text-stone-900 dark:text-stone-100 overflow-hidden max-h-[86dvh] flex flex-col">
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
                AI Quét &amp; Sửa sách
              </h2>
              <p className="text-[10.5px] text-stone-500 dark:text-stone-400 truncate">
                {bookTitle} · {report.totalIssues} mục phát hiện
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

        {/* 3 Toggleable Cleanup Categories */}
        <div className="p-3.5 space-y-2.5 overflow-y-auto overscroll-contain text-xs">
          <p className="text-[11px] text-stone-600 dark:text-stone-400 leading-snug">
            Tích chọn mục bạn đồng ý xóa hoặc sửa trước khi lưu sách:
          </p>

          {CATEGORY_META.map((cat) => {
            const count = report.categoryCounts[cat.key];
            const samples = report.categorySamples[cat.key];
            const checked = selection[cat.key] && count > 0;
            const isExpanded = expandedKey === cat.key;
            const disabled = count === 0;

            return (
              <div
                key={cat.key}
                data-testid={`cleanup-cat-${cat.key}`}
                className={`rounded-2xl border transition-colors ${
                  checked
                    ? 'border-amber-700/50 bg-amber-50/70 dark:bg-amber-950/25'
                    : 'border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900'
                } ${disabled ? 'opacity-55' : ''}`}
              >
                <div className="p-3 flex items-start gap-2.5">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    aria-label={cat.title}
                    disabled={disabled}
                    data-testid={`cleanup-checkbox-${cat.key}`}
                    onClick={() => toggleCategory(cat.key)}
                    className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                      checked
                        ? 'bg-amber-800 border-amber-800 text-white'
                        : 'border-stone-300 dark:border-zinc-600 bg-white dark:bg-zinc-950'
                    }`}
                  >
                    {checked && <Check className="w-3.5 h-3.5 stroke-[2.5]" />}
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => toggleCategory(cat.key)}
                        className="text-left text-[12px] font-semibold text-stone-900 dark:text-stone-100 leading-tight"
                      >
                        {cat.title}
                      </button>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold tabular-nums bg-stone-100 dark:bg-zinc-800 text-stone-700 dark:text-stone-300 shrink-0">
                        {count}
                      </span>
                    </div>
                    <p className="text-[10.5px] text-stone-500 dark:text-stone-400 mt-0.5 leading-snug">
                      {cat.subtitle}
                    </p>

                    {samples.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setExpandedKey(isExpanded ? null : cat.key)}
                        className="mt-1.5 inline-flex items-center gap-1 text-[10.5px] font-medium text-amber-800 dark:text-amber-300"
                      >
                        <span>{isExpanded ? 'Ẩn mẫu' : 'Xem mẫu'}</span>
                        <ChevronDown
                          className={`w-3 h-3 transition-transform ${
                            isExpanded ? 'rotate-180' : ''
                          }`}
                        />
                      </button>
                    )}
                  </div>
                </div>

                {isExpanded && samples.length > 0 && (
                  <div className="px-3 pb-3 pt-1 border-t border-stone-200/70 dark:border-zinc-800 space-y-1.5">
                    {samples.map((s, idx) => (
                      <div
                        key={idx}
                        className="p-2 rounded-xl bg-white dark:bg-zinc-950 border border-stone-200/70 dark:border-zinc-800 text-[10.5px] space-y-0.5"
                      >
                        <div className="text-red-700 dark:text-red-300 line-through break-words">
                          {s.original}
                        </div>
                        {s.cleaned ? (
                          <div className="text-emerald-700 dark:text-emerald-300 font-medium break-words">
                            → {s.cleaned}
                          </div>
                        ) : (
                          <div className="text-stone-500 text-[10px]">
                            → Xóa bỏ ({s.reason})
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
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
            onClick={() => onConfirm(selection)}
            className="h-9 px-3 rounded-xl bg-amber-800 hover:bg-amber-900 text-white text-[12px] font-semibold shadow-sm"
          >
            {selectedCount > 0 ? `${confirmLabel} (${selectedCount})` : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
