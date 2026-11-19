import React from 'react';
import { BookOpen, Headphones } from 'lucide-react';
import type { Book } from '../types/book';

interface FloatingBookDiscProps {
  book: Book | null;
  isAudioPlaying: boolean;
  isReaderOpen: boolean;
  onClickDisc: () => void;
}

export const FloatingBookDisc: React.FC<FloatingBookDiscProps> = ({
  book,
  isAudioPlaying,
  isReaderOpen,
  onClickDisc,
}) => {
  if (!book) return null;

  const progress = Math.min(100, Math.max(0, book.progressPercent || 0));
  const radius = 26.5;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (progress / 100) * circumference;

  return (
    <div className="fixed right-3 bottom-[80px] md:right-5 md:bottom-5 z-40 flex flex-col items-center gap-0.5 select-none">
      <button
        type="button"
        onClick={onClickDisc}
        aria-label={
          isAudioPlaying
            ? `Đang nghe ${book.title} — mở trình phát`
            : `Đang đọc ${book.title} (${progress}%) — mở sách`
        }
        title={`${book.title} · ${progress}%`}
        className="group relative w-[52px] h-[52px] sm:w-[60px] sm:h-[60px] rounded-full flex items-center justify-center ios-tap-card focus:outline-none"
      >
        {/* Frosted halo backdrop */}
        <span className="absolute inset-0 rounded-full bg-white/85 dark:bg-zinc-900/90 backdrop-blur-xl shadow-[0_10px_22px_rgba(28,20,10,0.22)] dark:shadow-[0_10px_24px_rgba(0,0,0,0.6)] border border-white/80 dark:border-zinc-700/80" />

        {/* Circular SVG reading progress ring */}
        <svg
          className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none"
          viewBox="0 0 60 60"
          aria-hidden="true"
        >
          <circle
            cx="30"
            cy="30"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            className="text-stone-200 dark:text-zinc-800"
          />
          <circle
            cx="30"
            cy="30"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.75"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            className="text-amber-700 dark:text-amber-500 transition-all duration-500"
          />
        </svg>

        {/* Spinning LaziBook Cover / Vinyl Disc */}
        <span
          className={`relative w-[40px] h-[40px] sm:w-[46px] sm:h-[46px] rounded-full overflow-hidden border border-stone-900/25 shadow-inner ${
            isAudioPlaying ? 'vinyl-spin-playing' : 'vinyl-spin-reading'
          }`}
        >
          {book.coverUrl ? (
            <img
              src={book.coverUrl}
              alt={`Đĩa sách ${book.title}`}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="w-full h-full flex items-center justify-center bg-gradient-to-br from-amber-700 via-amber-900 to-stone-900 text-[9px] font-display font-bold text-amber-50 p-1 text-center leading-tight">
              {book.title.slice(0, 8)}
            </span>
          )}
          {/* Subtle vinyl sheen */}
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full bg-gradient-to-tr from-black/20 via-transparent to-white/25 pointer-events-none"
          />
          {/* Vinyl center spindle hole */}
          <span
            aria-hidden="true"
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-[#F7F4EE] dark:bg-zinc-900 border-[1.5px] border-stone-800/40 dark:border-zinc-500/60 shadow-xs"
          />
        </span>

        {/* Active state badge (Headphones when listening, Book when reading) */}
        <span
          className={`absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full flex items-center justify-center shadow-md border border-white dark:border-zinc-900 text-white ${
            isAudioPlaying
              ? 'bg-emerald-600 animate-pulse'
              : isReaderOpen
              ? 'bg-amber-700'
              : 'bg-stone-900 dark:bg-amber-700'
          }`}
        >
          {isAudioPlaying ? (
            <Headphones className="w-2.5 h-2.5" />
          ) : (
            <BookOpen className="w-2.5 h-2.5" />
          )}
        </span>
      </button>

      {/* Compact status label pill */}
      <span className="px-1.5 py-[1px] rounded-full bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md border border-stone-200/80 dark:border-zinc-700/80 shadow-xs text-[9px] font-medium text-stone-700 dark:text-stone-300 max-w-[78px] truncate">
        {isAudioPlaying ? 'Đang nghe' : `${progress}% · Đọc`}
      </span>
    </div>
  );
};
