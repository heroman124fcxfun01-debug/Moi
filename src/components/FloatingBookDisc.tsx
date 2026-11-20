import React, { memo } from 'react';
import { BookOpen } from 'lucide-react';
import type { Book } from '../types/book';

interface FloatingBookDiscProps {
  book: Book | null;
  isAudioPlaying: boolean;
  isReaderOpen: boolean;
  onClick: () => void;
}

/**
 * Compact floating vinyl spinning disc anchored at bottom-right outside ReaderView.
 * Never overlaps the half-width left-anchored background audio mini-player.
 */
export const FloatingBookDisc: React.FC<FloatingBookDiscProps> = memo(
  ({ book, isAudioPlaying, isReaderOpen, onClick }) => {
    if (!book || isReaderOpen) return null;

    const spinClass = isAudioPlaying ? 'vinyl-spin-playing' : 'vinyl-spin-reading';

    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`Quay lại đọc nhanh sách ${book.title}`}
        title={`Đang đọc: ${book.title} (${book.progressPercent}%)`}
        className="fixed z-40 right-3 bottom-[78px] sm:right-5 sm:bottom-[86px] group focus:outline-none touch-manipulation"
      >
        <div className="relative w-[42px] h-[42px] sm:w-[46px] sm:h-[46px] rounded-full ios-glass-dock border border-white/80 dark:border-zinc-700/80 flex items-center justify-center shadow-lg transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-105 group-active:scale-90">
          {isAudioPlaying && (
            <span className="absolute -inset-1 rounded-full border border-amber-600/50 animate-ping opacity-35 pointer-events-none" />
          )}

          {/* Compact Spinning Vinyl Disc */}
          <div
            className={`relative w-[32px] h-[32px] sm:w-[36px] sm:h-[36px] rounded-full overflow-hidden border border-stone-900/20 dark:border-white/20 shadow-inner ${spinClass}`}
          >
            {book.coverUrl ? (
              <img
                src={book.coverUrl}
                alt={`Đĩa sách ${book.title}`}
                referrerPolicy="no-referrer"
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-amber-800 via-stone-800 to-stone-950 flex items-center justify-center text-amber-200">
                <BookOpen className="w-3.5 h-3.5" />
              </div>
            )}

            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-2.5 h-2.5 rounded-full bg-[#FBF9F5] dark:bg-[#16181C] border border-stone-900/25 dark:border-white/25" />
            </div>
          </div>

          {isAudioPlaying && (
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-amber-600 border-[1.5px] border-white dark:border-zinc-900 shadow-xs" />
          )}
        </div>
      </button>
    );
  }
);

FloatingBookDisc.displayName = 'FloatingBookDisc';
