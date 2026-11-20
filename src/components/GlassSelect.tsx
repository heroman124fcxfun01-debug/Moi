import React, { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, X } from 'lucide-react';

export interface GlassSelectOption<T extends string = string> {
  value: T;
  label: string;
  subtitle?: string;
  swatch?: string;
}

interface GlassSelectProps<T extends string = string> {
  value: T;
  onChange: (value: T) => void;
  options: Array<GlassSelectOption<T>>;
  title?: string;
  ariaLabel?: string;
  placeholder?: string;
  leadingIcon?: React.ReactNode;
  className?: string;
  buttonClassName?: string;
  disabled?: boolean;
  align?: 'left' | 'center';
}

export function GlassSelect<T extends string = string>({
  value,
  onChange,
  options,
  title,
  ariaLabel,
  placeholder = 'Chọn...',
  leadingIcon,
  className = '',
  buttonClassName = '',
  disabled = false,
  align = 'left',
}: GlassSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const labelId = useId();
  const activeOpt = options.find((opt) => opt.value === value);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel || title}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={`w-full min-w-0 px-3 py-2 rounded-2xl ios-liquid-bar border border-white/75 dark:border-zinc-700/60 flex items-center justify-between gap-2 text-left text-[11.5px] font-medium text-stone-900 dark:text-stone-100 hover:border-amber-700/60 transition-all disabled:opacity-50 ${buttonClassName} ${className}`}
      >
        <span className={`flex items-center gap-1.5 min-w-0 flex-1 ${align === 'center' ? 'justify-center' : ''}`}>
          {leadingIcon && <span className="shrink-0 flex items-center">{leadingIcon}</span>}
          {activeOpt?.swatch && (
            <span
              style={{ backgroundColor: activeOpt.swatch }}
              className="w-3 h-3 rounded-full shrink-0 border border-white/80 shadow-xs"
            />
          )}
          <span className="truncate">{activeOpt ? activeOpt.label : placeholder}</span>
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-stone-500 dark:text-stone-400 shrink-0" />
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[95] ios-frosted-backdrop flex items-end sm:items-center justify-center p-0 sm:p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) setOpen(false);
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby={labelId}
              className="ios-sheet-enter ios-frosted-surface w-full sm:max-w-sm rounded-t-[26px] sm:rounded-[24px] text-stone-900 dark:text-stone-100 overflow-hidden max-h-[78dvh] flex flex-col"
            >
              <div className="sm:hidden flex justify-center pt-2 shrink-0">
                <span className="w-10 h-1 rounded-full bg-stone-400/50 dark:bg-stone-600/70" />
              </div>

              <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-stone-300/40 dark:border-white/10 shrink-0">
                <h3
                  id={labelId}
                  className="text-[13px] font-display font-semibold truncate"
                >
                  {title || ariaLabel || 'Chọn tùy chọn'}
                </h3>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Đóng danh sách chọn"
                  className="w-7 h-7 rounded-full bg-black/5 dark:bg-white/10 flex items-center justify-center text-stone-600 dark:text-stone-300 shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div
                role="listbox"
                aria-label={ariaLabel || title || 'Tùy chọn'}
                className="overflow-y-auto overscroll-contain p-2 space-y-1"
              >
                {options.map((opt) => {
                  const selected = opt.value === value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        onChange(opt.value);
                        setOpen(false);
                      }}
                      className={`w-full px-3 py-2.5 rounded-[16px] text-left flex items-center justify-between gap-2.5 transition-colors ${
                        selected
                          ? 'bg-amber-800/12 dark:bg-amber-500/20 text-amber-900 dark:text-amber-200 font-semibold'
                          : 'hover:bg-black/5 dark:hover:bg-white/10 text-stone-800 dark:text-stone-200'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        {opt.swatch && (
                          <span
                            style={{ backgroundColor: opt.swatch }}
                            className="w-4 h-4 rounded-full shrink-0 border border-white/80 shadow-xs"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-[12.5px] leading-snug truncate">{opt.label}</div>
                          {opt.subtitle && (
                            <div className="text-[10.5px] text-stone-500 dark:text-stone-400 leading-snug line-clamp-2 mt-0.5">
                              {opt.subtitle}
                            </div>
                          )}
                        </div>
                      </div>
                      {selected && (
                        <Check className="w-4 h-4 text-amber-800 dark:text-amber-400 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
