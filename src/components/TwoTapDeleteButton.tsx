import { useEffect, useState, type MouseEvent } from 'react';
import { Trash2 } from 'lucide-react';

interface TwoTapDeleteButtonProps {
  onConfirmDelete: () => void | Promise<void>;
  /** Label shown when not armed (e.g. "Xóa", or omit for icon-only) */
  label?: string;
  /** Label shown after Tap 1 turns the button red */
  confirmLabel?: string;
  /** Accessible title/aria-label */
  title?: string;
  /** Visual density preset */
  variant?: 'icon' | 'pill' | 'row';
  /** Auto-reset timeout in ms after Tap 1 */
  resetMs?: number;
  disabled?: boolean;
  className?: string;
  stopPropagation?: boolean;
  iconClassName?: string;
}

/**
 * Universal BOOKHAD 2-tap red delete confirmation button:
 * - Tap 1: arms into bright red confirmation state ("Xác nhận xóa?" / red icon badge).
 * - Tap 2: executes deletion immediately.
 * - Automatically resets to idle if the user does not confirm within `resetMs`.
 */
export function TwoTapDeleteButton({
  onConfirmDelete,
  label,
  confirmLabel = 'Xác nhận xóa',
  title = 'Xóa (ấn 2 lần để xác nhận)',
  variant = 'icon',
  resetMs = 3500,
  disabled = false,
  className = '',
  stopPropagation = true,
  iconClassName = 'w-3.5 h-3.5',
}: TwoTapDeleteButtonProps) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), resetMs);
    return () => window.clearTimeout(timer);
  }, [armed, resetMs]);

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (stopPropagation) e.stopPropagation();
    if (disabled) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    void onConfirmDelete();
  };

  if (variant === 'row') {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={handleClick}
        title={armed ? 'Ấn lần nữa để xóa vĩnh viễn' : title}
        data-delete-armed={armed ? 'true' : 'false'}
        className={`w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-semibold transition-all active:scale-[0.98] disabled:opacity-45 ${
          armed
            ? 'bg-red-600 text-white shadow-sm shadow-red-600/30 ring-2 ring-red-400/50'
            : 'bg-stone-100/90 dark:bg-zinc-800/90 text-stone-700 dark:text-stone-200 hover:text-red-600 dark:hover:text-red-400 border border-stone-200/80 dark:border-zinc-700/80'
        } ${className}`}
      >
        <Trash2 className={iconClassName} />
        <span>{armed ? confirmLabel : label || 'Xóa'}</span>
      </button>
    );
  }

  if (variant === 'pill') {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={handleClick}
        title={armed ? 'Ấn lần nữa để xác nhận xóa' : title}
        data-delete-armed={armed ? 'true' : 'false'}
        className={`inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold transition-all active:scale-95 disabled:opacity-45 whitespace-nowrap shrink-0 ${
          armed
            ? 'bg-red-600 text-white shadow-xs ring-1 ring-red-400/60'
            : 'bg-stone-100 dark:bg-zinc-800 text-stone-600 dark:text-stone-300 hover:text-red-600 border border-stone-200 dark:border-zinc-700'
        } ${className}`}
      >
        <Trash2 className={iconClassName} />
        <span>{armed ? confirmLabel : label || 'Xóa'}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={handleClick}
      aria-label={armed ? confirmLabel : title}
      title={armed ? 'Ấn lần nữa để xác nhận xóa' : title}
      data-delete-armed={armed ? 'true' : 'false'}
      className={`inline-flex items-center justify-center gap-1 rounded-lg transition-all active:scale-95 disabled:opacity-45 shrink-0 ${
        armed
          ? 'px-2 py-1 bg-red-600 text-white text-[10px] font-bold shadow-xs ring-1 ring-red-400/60'
          : 'p-1.5 text-stone-400 hover:text-red-500 hover:bg-red-50/70 dark:hover:bg-red-950/30'
      } ${className}`}
    >
      <Trash2 className={iconClassName} />
      {armed && <span className="whitespace-nowrap leading-none">Xóa?</span>}
    </button>
  );
}
