import React, { memo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, MoreVertical } from 'lucide-react';
import type { Book } from '../types/book';

interface BookShowcase3DProps {
  books: Book[];
  mode: 'carousel3d' | 'stack3d';
  onOpenBook: (bookId: string, openAudio?: boolean) => void;
  onOpenMenu: (book: Book, e: React.MouseEvent) => void;
}

export const BookShowcase3D: React.FC<BookShowcase3DProps> = memo(
  ({ books, mode, onOpenBook, onOpenMenu }) => {
    const [activeIndex, setActiveIndex] = useState(0);
    const dragStartXRef = useRef<number | null>(null);
    const [dragDeltaX, setDragDeltaX] = useState(0);

    if (books.length === 0) return null;

    const safeActive = ((activeIndex % books.length) + books.length) % books.length;
    const activeBook = books[safeActive];

    const step = (delta: number) => {
      setActiveIndex((prev) => (prev + delta + books.length) % books.length);
    };

    const handlePointerDown = (e: React.PointerEvent) => {
      dragStartXRef.current = e.clientX;
      setDragDeltaX(0);
    };

    const handlePointerMove = (e: React.PointerEvent) => {
      if (dragStartXRef.current === null) return;
      setDragDeltaX(e.clientX - dragStartXRef.current);
    };

    const handlePointerUp = () => {
      if (dragStartXRef.current === null) return;
      const dx = dragDeltaX;
      dragStartXRef.current = null;
      setDragDeltaX(0);
      if (Math.abs(dx) > 34) {
        step(dx < 0 ? 1 : -1);
      }
    };

    // Compact half-size 3D circular carousel for smooth 120fps touch browsing
    const renderCarousel3D = () => {
      const count = books.length;
      const radiusX = count <= 2 ? 70 : 92;
      const radiusZ = count <= 2 ? 52 : 76;

      return (
        <div
          className="relative h-[150px] sm:h-[172px] w-full flex items-center justify-center select-none touch-pan-y overflow-hidden"
          style={{ perspective: '900px' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          aria-label="Kệ sách xoay vòng 3D"
        >
          <div
            className="relative w-full h-full flex items-center justify-center"
            style={{ transformStyle: 'preserve-3d' }}
          >
            {books.map((book, idx) => {
              let offset = idx - safeActive;
              if (offset > count / 2) offset -= count;
              if (offset < -count / 2) offset += count;

              const absOffset = Math.abs(offset);
              const visible = absOffset <= 3 || count <= 7;
              if (!visible) return null;

              const angle = (offset / Math.max(count, 4)) * Math.PI * 2;
              const dragShift = dragDeltaX * 0.22;
              const x = Math.sin(angle) * radiusX + dragShift * (1 - absOffset * 0.2);
              const z = (Math.cos(angle) - 1) * radiusZ;
              const rotateY = -Math.sin(angle) * 32;
              const scale = Math.max(0.64, 1 - absOffset * 0.14);
              const opacity = Math.max(0.28, 1 - absOffset * 0.24);
              const zIndex = 40 - Math.round(absOffset * 10);
              const isCenter = idx === safeActive;

              return (
                <div
                  key={book.id}
                  onClick={() => {
                    if (isCenter) {
                      onOpenBook(book.id);
                    } else {
                      setActiveIndex(idx);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (isCenter) onOpenBook(book.id);
                      else setActiveIndex(idx);
                    }
                  }}
                  aria-label={`${isCenter ? 'Mở sách' : 'Chọn sách'} ${book.title}`}
                  style={{
                    transform: `translate3d(${x.toFixed(1)}px, 0px, ${z.toFixed(1)}px) rotateY(${rotateY.toFixed(1)}deg) scale(${scale.toFixed(3)})`,
                    opacity,
                    zIndex,
                    transition:
                      dragStartXRef.current !== null
                        ? 'none'
                        : 'transform 380ms cubic-bezier(0.32, 0.72, 0, 1), opacity 260ms ease',
                  }}
                  className={`absolute w-[74px] sm:w-[86px] h-[106px] sm:h-[124px] rounded-xl overflow-hidden cursor-pointer border ${
                    isCenter
                      ? 'border-amber-700/70 dark:border-amber-400/70 shadow-lg ring-1 ring-amber-800/20'
                      : 'border-white/50 dark:border-stone-700/80 shadow-md'
                  }`}
                >
                  {book.coverUrl ? (
                    <img
                      src={book.coverUrl}
                      alt={`Bìa sách ${book.title}`}
                      referrerPolicy="no-referrer"
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover pointer-events-none"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-amber-100 via-stone-100 to-stone-200 dark:from-stone-800 dark:via-stone-900 dark:to-zinc-950 p-1.5 flex flex-col justify-between text-left">
                      <span className="text-[7px] uppercase tracking-wider text-amber-800 dark:text-amber-400 font-semibold truncate">
                        BOOKHAD
                      </span>
                      <span className="font-display text-[9px] font-bold leading-tight text-stone-900 dark:text-stone-100 line-clamp-3">
                        {book.title}
                      </span>
                      <span className="text-[7.5px] text-stone-500 truncate">{book.author}</span>
                    </div>
                  )}

                  {isCenter && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenMenu(book, e);
                      }}
                      aria-label={`Tùy chọn cho ${book.title}`}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/55 text-white flex items-center justify-center hover:bg-black/75 active:scale-90 transition-transform"
                    >
                      <MoreVertical className="w-2.5 h-2.5" />
                    </button>
                  )}

                  <div className="absolute inset-x-0 bottom-0 h-1 bg-black/25">
                    <div
                      className="h-full bg-amber-500"
                      style={{ width: `${Math.max(4, book.progressPercent)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {count > 1 && (
            <>
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Sách trước"
                className="absolute left-1 sm:left-2.5 z-50 w-7 h-7 rounded-full ios-glass-dock border border-white/60 dark:border-stone-700 flex items-center justify-center text-stone-800 dark:text-stone-100 active:scale-90 transition-transform"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Sách tiếp theo"
                className="absolute right-1 sm:right-2.5 z-50 w-7 h-7 rounded-full ios-glass-dock border border-white/60 dark:border-stone-700 flex items-center justify-center text-stone-800 dark:text-stone-100 active:scale-90 transition-transform"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      );
    };

    // Compact half-size iPhone 3D Stack / Coverflow
    const renderStack3D = () => {
      const count = books.length;
      return (
        <div
          className="relative h-[152px] sm:h-[172px] w-full flex items-center justify-center select-none touch-pan-y overflow-hidden"
          style={{ perspective: '900px' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          aria-label="Ngăn xếp sách 3D kiểu iPhone"
        >
          {books.map((book, idx) => {
            let rel = idx - safeActive;
            if (rel < -2) rel += count;
            if (rel > count - 2 && count > 3) rel -= count;

            const isFront = rel === 0;
            const visible = rel >= -1 && rel <= 3;
            if (!visible) return null;

            const translateX = isFront ? dragDeltaX * 0.55 : rel * 24;
            const translateY = isFront ? 0 : Math.abs(rel) * 5;
            const scale = isFront ? 1 : Math.max(0.76, 1 - Math.abs(rel) * 0.08);
            const rotateZ = isFront ? dragDeltaX * 0.03 : rel * 2.5;
            const opacity = isFront ? 1 : Math.max(0.32, 1 - Math.abs(rel) * 0.25);
            const zIndex = isFront ? 40 : 35 - Math.abs(rel) * 6;

            return (
              <div
                key={book.id}
                onClick={() => {
                  if (isFront) onOpenBook(book.id);
                  else setActiveIndex(idx);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (isFront) onOpenBook(book.id);
                    else setActiveIndex(idx);
                  }
                }}
                aria-label={`${isFront ? 'Mở sách' : 'Đưa lên trước'} ${book.title}`}
                style={{
                  transform: `translate3d(${translateX.toFixed(1)}px, ${translateY}px, 0) scale(${scale.toFixed(3)}) rotateZ(${rotateZ.toFixed(1)}deg)`,
                  opacity,
                  zIndex,
                  transition:
                    dragStartXRef.current !== null
                      ? 'none'
                      : 'transform 340ms cubic-bezier(0.32, 0.72, 0, 1), opacity 240ms ease',
                }}
                className={`absolute w-[78px] sm:w-[90px] h-[110px] sm:h-[126px] rounded-xl overflow-hidden cursor-pointer border ${
                  isFront
                    ? 'border-amber-700/70 dark:border-amber-400/70 shadow-lg'
                    : 'border-white/50 dark:border-stone-700 shadow-md'
                }`}
              >
                {book.coverUrl ? (
                  <img
                    src={book.coverUrl}
                    alt={`Bìa sách ${book.title}`}
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover pointer-events-none"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-amber-100 via-stone-100 to-stone-200 dark:from-stone-800 dark:to-zinc-950 p-2 flex flex-col justify-between text-left">
                    <span className="text-[7px] uppercase tracking-wider text-amber-800 dark:text-amber-400 font-semibold truncate">
                      {book.author}
                    </span>
                    <span className="font-display text-[9.5px] font-bold leading-snug text-stone-900 dark:text-stone-100 line-clamp-3">
                      {book.title}
                    </span>
                    <span className="text-[7.5px] text-stone-500">{book.progressPercent}%</span>
                  </div>
                )}

                {isFront && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenMenu(book, e);
                    }}
                    aria-label={`Tùy chọn cho ${book.title}`}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/55 text-white flex items-center justify-center hover:bg-black/75 active:scale-90 transition-transform"
                  >
                    <MoreVertical className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
            );
          })}

          {count > 1 && (
            <>
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Lật thẻ trước"
                className="absolute left-1 sm:left-2.5 z-50 w-7 h-7 rounded-full ios-glass-dock border border-white/60 dark:border-stone-700 flex items-center justify-center text-stone-800 dark:text-stone-100 active:scale-90 transition-transform"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Lật thẻ tiếp"
                className="absolute right-1 sm:right-2.5 z-50 w-7 h-7 rounded-full ios-glass-dock border border-white/60 dark:border-stone-700 flex items-center justify-center text-stone-800 dark:text-stone-100 active:scale-90 transition-transform"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      );
    };

    return (
      <div className="space-y-2">
        {mode === 'carousel3d' ? renderCarousel3D() : renderStack3D()}

        {/* Compact Active Book Caption & Quick Actions */}
        <div className="flex flex-col items-center text-center space-y-1.5 px-2">
          <div className="max-w-xs">
            <h3 className="font-display text-xs sm:text-[13px] font-bold text-stone-900 dark:text-stone-100 line-clamp-1">
              {activeBook.title}
            </h3>
            <p className="text-[10.5px] text-stone-500 dark:text-stone-400 truncate">
              {activeBook.author} · {activeBook.progressPercent}%
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onOpenBook(activeBook.id)}
              className="px-3 py-1 rounded-full bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-[10.5px] font-semibold active:scale-95 transition-transform"
            >
              Đọc ngay
            </button>
            <button
              type="button"
              onClick={() => onOpenBook(activeBook.id, true)}
              className="px-3 py-1 rounded-full bg-amber-800 text-white text-[10.5px] font-semibold hover:bg-amber-900 active:scale-95 transition-transform"
            >
              Nghe AI
            </button>
          </div>
        </div>
      </div>
    );
  }
);

BookShowcase3D.displayName = 'BookShowcase3D';
