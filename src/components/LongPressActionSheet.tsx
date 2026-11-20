import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, Lock, Pencil, X } from 'lucide-react';
import { TwoTapDeleteButton } from './TwoTapDeleteButton';

interface LongPressActionSheetProps {
  open: boolean;
  itemName: string;
  itemSubtitle?: string;
  categoryLabel: string;
  canDelete: boolean;
  protectedDeleteHint?: string;
  onClose: () => void;
  onRename: (nextName: string) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
}

/**
 * iPhone frosted-glass context sheet triggered by long-pressing (nhấn dí)
 * a Voice, Font, or Imported Ambient Sound item.
 * - Allows renaming all items (including built-in Google AI voices & built-in fonts).
 * - Allows 2-tap red deletion ONLY when `canDelete` is true.
 */
export function LongPressActionSheet({
  open,
  itemName,
  itemSubtitle,
  categoryLabel,
  canDelete,
  protectedDeleteHint = 'Mục gốc hệ thống — chỉ hỗ trợ đổi tên, không cho phép xóa.',
  onClose,
  onRename,
  onDelete,
}: LongPressActionSheetProps) {
  const [draftName, setDraftName] = useState(itemName);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDraftName(itemName);
      setIsSaving(false);
    }
  }, [open, itemName]);

  if (!open) return null;

  const handleSubmitRename = async (e: FormEvent) => {
    e.preventDefault();
    const cleaned = draftName.trim();
    if (!cleaned) return;
    setIsSaving(true);
    try {
      await onRename(cleaned);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!canDelete || !onDelete) return;
    await onDelete();
    onClose();
  };

  const sheetContent = (
    <div
      className="fixed inset-0 z-50 ios-frosted-backdrop flex items-end sm:items-center justify-center p-3 sm:p-4 animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Tùy chọn ${categoryLabel}`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-[26px] ios-frosted-surface p-4 sm:p-5 space-y-4 animate-ios-sheet"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-400">
              {categoryLabel}
            </p>
            <h3 className="text-sm font-bold text-stone-900 dark:text-stone-100 truncate mt-0.5">
              {itemName}
            </h3>
            {itemSubtitle && (
              <p className="text-[11px] text-stone-500 dark:text-stone-400 truncate mt-0.5">
                {itemSubtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="p-1.5 rounded-full bg-stone-100/80 dark:bg-zinc-800/80 text-stone-500 hover:text-stone-900 dark:hover:text-white shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Rename Form */}
        <form onSubmit={handleSubmitRename} className="space-y-2.5">
          <label className="block space-y-1">
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-stone-700 dark:text-stone-300">
              <Pencil className="w-3 h-3 text-amber-700 dark:text-amber-400" />
              Đổi tên hiển thị
            </span>
            <input
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="Nhập tên mới..."
              autoFocus
              className="w-full px-3 py-2.5 rounded-2xl bg-white/80 dark:bg-zinc-900/80 border border-stone-200 dark:border-zinc-700 text-xs text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
            />
          </label>
          <button
            type="submit"
            disabled={isSaving || !draftName.trim()}
            className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-2xl bg-amber-800 hover:bg-amber-900 disabled:opacity-45 text-white text-xs font-semibold shadow-xs transition-all active:scale-[0.98]"
          >
            <Check className="w-3.5 h-3.5" />
            Lưu tên mới
          </button>
        </form>

        {/* Delete Section (2-Tap Red Confirmation or Protected Notice) */}
        <div className="pt-2 border-t border-stone-200/70 dark:border-zinc-800/80">
          {canDelete && onDelete ? (
            <div className="space-y-1.5">
              <TwoTapDeleteButton
                variant="row"
                label="Xóa mục này"
                confirmLabel="Ấn lần nữa để xác nhận xóa"
                onConfirmDelete={handleConfirmDelete}
              />
              <p className="text-[10px] text-center text-stone-400">
                Ấn lần 1 chuyển đỏ, ấn lần 2 để xác nhận xóa.
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-stone-100/75 dark:bg-zinc-800/70 text-[11px] text-stone-500 dark:text-stone-400">
              <Lock className="w-3.5 h-3.5 shrink-0 text-stone-400" />
              <span>{protectedDeleteHint}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(sheetContent, document.body) : sheetContent;
}
