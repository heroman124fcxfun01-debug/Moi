import React, { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Headphones,
  MoreVertical,
} from 'lucide-react';
import type { Book } from '../types/book';
import { estimateBookStats } from '../utils/textProcessing';

interface BookShowcase3DProps {
  books: Book[];
  mode: 'carousel3d' | 'stack3d';
  onOpenBook: (bookId: string, openAudioStudio?: boolean) => void;
  onOpenMenu: (book: Book, e: React.MouseEvent) => void;
}

function getCircularOffset(index: number, activeIndex: number, total: number): number {
  let diff = index - activeIndex;
  if (total <= 1) return 0;
  const half = Math.floor(total / 2);
  if (diff > half) diff -= total;
  if (diff < -half) diff += total;
  return diff;
}

export const BookShowcase3D: React.FC<BookShowcase3DProps> = ({
  books,
  mode,
  onOpenBook,
  onOpenMenu,
}) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [dragOffsetX, setDragOffsetX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef<number | null>(null);
  const movedRef = useRef(false);

  useEffect(() => {
    if (activeIndex >= books.length) {
      setActiveIndex(0);
    }
  }, [books.length, activeIndex]);

  if (books.length === 0) return null;

  const activeBook = books[activeIndex] || books[0];
  const stats = estimateBookStats(activeBook.chapters);

  const goNext = () => {
    setActiveIndex((prev) => (prev + 1) % books.length);
  };

  const goPrev = () => {
    setActiveIndex((prev) => (prev - 1 + books.length) % books.length);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    startXRef.current = e.clientX;
    movedRef.current = false;
    setIsDragging(true);
    setDragOffsetX(0);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (startXRef.current === null) return;
    const dx = e.clientX - startXRef.current;
    if (Math.abs(dx) > 6) movedRef.current = true;
    setDragOffsetX(Math.max(-180, Math.min(180, dx)));
  };

  const handlePointerEnd = () => {
    if (startXRef.current === null) return;
    const dx = dragOffsetX;
    startXRef.current = null;
    setIsDragging(false);
    setDragOffsetX(0);
    if (books.length > 1) {
      if (dx <= -44) {
        goNext();
      } else if (dx >= 44) {
        goPrev();
      }
    }
  };

  const renderStandingBookFace = (book: Book, isCenter: boolean) => (
    <div
      className="relative w-full h-full rounded-r-xl rounded-l-[4px] overflow-hidden select-none"
      style={{
        boxShadow: isCenter
          ? '10px 18px 34px rgba(15, 12, 8, 0.34), -4px 0 0 rgba(120, 105, 88, 0.45), inset 6px 0 12px rgba(0,0,0,0.22)'
          : '6px 12px 22px rgba(15, 12, 8, 0.24), -3px 0 0 rgba(120, 105, 88, 0.35), inset 5px 0 10px rgba(0,0,0,0.2)',
      }}
    >
      {/* Realistic 3D left book spine crease */}
      <div
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-3 z-20 pointer-events-none"
        style={{
          background:
            'linear-gradient(90deg, rgba(0,0,0,0.34) 0%, rgba(255,255,255,0.22) 38%, rgba(0,0,0,0.12) 72%, transparent 100%)',
        }}
      />
      {/* Realistic right stacked-paper edge */}
      <div
        aria-hidden="true"
        className="absolute inset-y-[3px] right-0 w-[4px] z-20 pointer-events-none"
        style={{
          background:
            'repeating-linear-gradient(90deg, #f3ede0 0px, #d8ccb8 1px, #fbf7ef 2px)',
        }}
      />

      {book.coverUrl ? (
        <img
          src={book.coverUrl}
          alt={book.title}
          draggable={false}
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover pointer-events-none"
        />
      ) : (
        <div className="w-full h-full p-4 pl-5 flex flex-col justify-between bg-gradient-to-br from-[#EDE8DC] to-[#D8CEBA] dark:from-stone-800 dark:to-stone-900 text-stone-900 dark:text-stone-100">
          <span className="text-[9px] uppercase tracking-widest text-stone-500 dark:text-stone-400">
            LaziRead
          </span>
          <span className="font-display text-sm font-semibold line-clamp-4 leading-snug">
            {book.title}
          </span>
          <span className="text-[10px] text-stone-600 dark:text-stone-400 truncate">
            {book.author}
          </span>
        </div>
      )}

      <span className="absolute bottom-2 left-3.5 z-20 px-1.5 py-0.5 rounded-md bg-black/65 text-white text-[10px] font-medium tabular-nums backdrop-blur-xs">
        {book.progressPercent}%
      </span>
    </div>
  );

  return (
    <div
      data-testid={mode === 'carousel3d' ? 'book-carousel-3d' : 'book-stack-3d'}
      className="rounded-2xl border border-stone-200/90 dark:border-stone-800 bg-white/80 dark:bg-[#16181C]/90 overflow-hidden px-3 py-5 sm:p-6 space-y-5"
    >
      {/* 3D Interactive Stage */}
      <div
        className="relative h-[270px] sm:h-[310px] w-full flex items-center justify-center overflow-hidden touch-pan-y cursor-grab active:cursor-grabbing"
        style={{ perspective: '1250px' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onPointerLeave={() => {
          if (isDragging) handlePointerEnd();
        }}
      >
        {/* Subtle circular floor shadow */}
        <div
          aria-hidden="true"
          className="absolute bottom-3 w-56 sm:w-72 h-7 rounded-full pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse at center, rgba(28, 22, 16, 0.22) 0%, rgba(28, 22, 16, 0) 72%)',
          }}
        />

        {mode === 'carousel3d' ? (
          /* 3D Circular Standing Book Carousel */
          <div
            className="relative w-full h-full flex items-center justify-center"
            style={{ transformStyle: 'preserve-3d' }}
          >
            {books.map((book, idx) => {
              const offset = getCircularOffset(idx, activeIndex, books.length);
              const abs = Math.abs(offset);
              if (abs > 3) return null;

              const dragRatio = dragOffsetX / 150;
              const effectiveOffset = offset + dragRatio;
              const angleRad = effectiveOffset * 0.56;
              const radiusX = 165;
              const radiusZ = 140;
              const tx = Math.sin(angleRad) * radiusX;
              const tz = (Math.cos(angleRad) - 1) * radiusZ;
              const rotateY = -effectiveOffset * 28;
              const scale = Math.max(0.68, 1 - Math.abs(effectiveOffset) * 0.13);
              const opacity = Math.max(0.28, 1 - Math.abs(effectiveOffset) * 0.24);
              const zIndex = 40 - Math.round(Math.abs(effectiveOffset) * 10);
              const isCenter = offset === 0;

              return (
                <button
                  key={book.id}
                  type="button"
                  aria-label={isCenter ? `Mở sách ${book.title}` : `Xoay tới ${book.title}`}
                  onClick={() => {
                    if (movedRef.current) return;
                    if (isCenter) {
                      onOpenBook(book.id);
                    } else {
                      setActiveIndex(idx);
                    }
                  }}
                  className="absolute w-[142px] sm:w-[164px] h-[202px] sm:h-[234px] focus:outline-none"
                  style={{
                    transform: `translate3d(${tx}px, ${Math.abs(effectiveOffset) * 8}px, ${tz}px) rotateY(${rotateY}deg) scale(${scale})`,
                    opacity,
                    zIndex,
                    transition: isDragging
                      ? 'none'
                      : 'transform 420ms cubic-bezier(0.22, 1, 0.36, 1), opacity 320ms ease',
                  }}
                >
                  {renderStandingBookFace(book, isCenter)}
                </button>
              );
            })}
          </div>
        ) : (
          /* 3D Layered Swipeable Book Stack */
          <div
            className="relative w-full h-full flex items-center justify-center"
            style={{ transformStyle: 'preserve-3d' }}
          >
            {books.map((book, idx) => {
              const forwardPos = (idx - activeIndex + books.length) % books.length;
              const isTop = forwardPos === 0;
              if (forwardPos > 4 && forwardPos < books.length - 1) return null;

              const isPreviousBehind = forwardPos === books.length - 1 && books.length > 1;
              const depth = isPreviousBehind ? 4 : forwardPos;
              const tiltSign = depth % 2 === 0 ? 1 : -1;
              const baseTx = isTop
                ? dragOffsetX
                : isPreviousBehind
                  ? -28
                  : depth * 16;
              const baseTy = isTop ? Math.abs(dragOffsetX) * 0.06 : depth * 6;
              const baseTz = -depth * 42;
              const rotateZ = isTop
                ? dragOffsetX * 0.06
                : isPreviousBehind
                  ? -6
                  : tiltSign * Math.min(8, depth * 2.6);
              const rotateY = isTop ? -dragOffsetX * 0.08 : -depth * 4;
              const scale = isTop ? 1 : Math.max(0.8, 1 - depth * 0.055);
              const opacity = isTop ? 1 : isPreviousBehind ? 0.35 : Math.max(0.45, 1 - depth * 0.16);
              const zIndex = isTop ? 50 : 40 - depth * 6;

              return (
                <button
                  key={book.id}
                  type="button"
                  aria-label={isTop ? `Mở sách ${book.title}` : `Chọn sách ${book.title}`}
                  onClick={() => {
                    if (movedRef.current) return;
                    if (isTop) {
                      onOpenBook(book.id);
                    } else {
                      setActiveIndex(idx);
                    }
                  }}
                  className="absolute w-[152px] sm:w-[172px] h-[214px] sm:h-[244px] focus:outline-none"
                  style={{
                    transform: `translate3d(${baseTx}px, ${baseTy}px, ${baseTz}px) rotateZ(${rotateZ}deg) rotateY(${rotateY}deg) scale(${scale})`,
                    opacity,
                    zIndex,
                    transition: isDragging
                      ? 'none'
                      : 'transform 380ms cubic-bezier(0.22, 1, 0.36, 1), opacity 280ms ease',
                  }}
                >
                  {renderStandingBookFace(book, isTop)}
                </button>
              );
            })}
          </div>
        )}

        {/* Left / Right Navigation Arrows */}
        {books.length > 1 && (
          <>
            <button
              type="button"
              onClick={goPrev}
              aria-label="Sách trước trong chế độ 3D"
              className="absolute left-1.5 sm:left-3 top-1/2 -translate-y-1/2 z-[60] w-9 h-9 rounded-full ios-liquid-bar border border-white/80 dark:border-zinc-700 flex items-center justify-center text-stone-700 dark:text-stone-200 hover:scale-105 transition-transform"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={goNext}
              aria-label="Sách tiếp theo trong chế độ 3D"
              className="absolute right-1.5 sm:right-3 top-1/2 -translate-y-1/2 z-[60] w-9 h-9 rounded-full ios-liquid-bar border border-white/80 dark:border-zinc-700 flex items-center justify-center text-stone-700 dark:text-stone-200 hover:scale-105 transition-transform"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </>
        )}
      </div>

      {/* Focused Book Metadata & Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-stone-200/80 dark:border-stone-800">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-amber-800 dark:text-amber-400 tabular-nums">
              {activeIndex + 1} / {books.length}
            </span>
            <span className="text-[11px] text-stone-400">·</span>
            <span className="text-[11px] text-stone-500">
              {mode === 'carousel3d'
                ? 'Vuốt ngang hoặc bấm bìa để xoay vòng 3D'
                : 'Vuốt ngang để lật chồng sách 3D'}
            </span>
          </div>
          <h3 className="text-base font-display font-semibold text-stone-900 dark:text-stone-100 truncate mt-0.5">
            {activeBook.title}
          </h3>
          <p className="text-xs text-stone-500 dark:text-stone-400 truncate">
            {activeBook.author} · {stats.chapterCount} chương · Đã đọc {activeBook.progressPercent}%
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onOpenBook(activeBook.id)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-xs font-medium whitespace-nowrap"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Đọc ngay</span>
          </button>
          <button
            type="button"
            onClick={() => onOpenBook(activeBook.id, true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-800 text-white text-xs font-medium whitespace-nowrap"
          >
            <Headphones className="w-3.5 h-3.5" />
            <span>Nghe AI</span>
          </button>
          <button
            type="button"
            onClick={(e) => onOpenMenu(activeBook, e)}
            aria-label={`Tùy chọn cho ${activeBook.title}`}
            className="w-9 h-9 rounded-xl border border-stone-200 dark:border-stone-700 flex items-center justify-center text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
