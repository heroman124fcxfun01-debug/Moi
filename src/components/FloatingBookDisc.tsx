import React, { memo } from 'react';
import { BookOpen, Pause, Play, SkipForward, X } from 'lucide-react';
import type { Book } from '../types/book';

interface FloatingBookDiscProps {
  book: Book | null;
  isAudioPlaying: boolean;
  isAudioSessionActive: boolean;
  isReaderOpen: boolean;
  onClick: () => void;
  onToggleAudio?: () => void;
  onNextAudio?: () => void;
  onStopAudio?: () => void;
}

/**
 * Unified Floating Vinyl Book Disc on the main screen (outside ReaderView):
 * - When audio session is active (playing or paused): merges into a sleek pill showing
 *   the book title + 3 controls (Play/Pause, Next, Close) + spinning disc on the right.
 * - When NOT listening to audio: shows ONLY the compact spinning vinyl disc.
 * - Inside ReaderView (`isReaderOpen === true`): returns null (ReaderView shows only its compact disc).
 */
export const FloatingBookDisc: React.FC<FloatingBookDiscProps> = memo(
  ({
    book,
    isAudioPlaying,
    isAudioSessionActive,
    isReaderOpen,
    onClick,
    onToggleAudio,
    onNextAudio,
    onStopAudio,
  }) => {
    if (!book || isReaderOpen) return null;

    const showMergedAudioPill = isAudioPlaying || isAudioSessionActive;
    const spinClass = isAudioPlaying ? 'vinyl-spin-playing' : 'vinyl-spin-reading';

    const discGraphic = (
      <div
        className={`relative w-[32px] h-[32px] sm:w-[36px] sm:h-[36px] rounded-full overflow-hidden border border-stone-900/20 dark:border-white/20 shadow-inner shrink-0 ${spinClass}`}
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
    );

    if (showMergedAudioPill) {
      return (
        <div
          role="region"
          data-testid="floating-disc-audio-bar"
          aria-label="Thanh nghe sách gộp cùng đĩa xoay"
          className="fixed z-40 right-3 bottom-[68px] sm:right-5 sm:bottom-[82px] max-w-[calc(100vw-1.5rem)] ios-sheet-enter"
        >
          <div className="rounded-full bg-white dark:bg-[#16181C] border border-stone-200 dark:border-zinc-700 pl-3 pr-1.5 py-1 shadow-xl flex items-center gap-2 text-stone-900 dark:text-stone-100">
            {/* Book Title (tap to jump back into book) */}
            <button
              type="button"
              onClick={onClick}
              title={`Mở sách ${book.title}`}
              className="min-w-0 max-w-[125px] sm:max-w-[165px] text-left focus:outline-none"
            >
              <div className="text-[11px] font-semibold truncate flex items-center gap-1.5 leading-tight">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    isAudioPlaying ? 'bg-amber-600 animate-pulse' : 'bg-stone-400'
                  }`}
                />
                <span className="truncate">{book.title}</span>
              </div>
            </button>

            {/* 3 Integrated Audio Controls: Play/Pause, Next, Close/Stop */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                data-testid="floating-disc-play-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleAudio?.();
                }}
                aria-label={isAudioPlaying ? 'Tạm dừng nghe sách' : 'Tiếp tục nghe sách'}
                className="w-7 h-7 rounded-full bg-amber-800 text-white flex items-center justify-center hover:bg-amber-900 shadow-xs active:scale-90 transition-transform"
              >
                {isAudioPlaying ? (
                  <Pause className="w-3.5 h-3.5" />
                ) : (
                  <Play className="w-3.5 h-3.5 ml-0.5" />
                )}
              </button>

              <button
                type="button"
                data-testid="floating-disc-next-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onNextAudio?.();
                }}
                aria-label="Đoạn đọc tiếp theo"
                className="w-7 h-7 rounded-full bg-stone-100 dark:bg-zinc-800 text-stone-700 dark:text-stone-200 flex items-center justify-center hover:text-amber-800 active:scale-90 transition-transform"
              >
                <SkipForward className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                data-testid="floating-disc-stop-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onStopAudio?.();
                }}
                aria-label="Tắt nghe sách"
                className="w-7 h-7 rounded-full bg-stone-100 dark:bg-zinc-800 text-stone-500 dark:text-stone-400 flex items-center justify-center hover:text-red-600 active:scale-90 transition-transform"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Integrated Spinning Vinyl Disc on Right End */}
            <button
              type="button"
              onClick={onClick}
              aria-label={`Mở trình đọc sách ${book.title}`}
              className="relative p-0.5 rounded-full focus:outline-none active:scale-90 transition-transform shrink-0"
            >
              {discGraphic}
              {isAudioPlaying && (
                <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-amber-600 border-[1.5px] border-white dark:border-zinc-900 shadow-xs" />
              )}
            </button>
          </div>
        </div>
      );
    }

    // Idle (not listening): show ONLY the compact spinning disc
    return (
      <button
        type="button"
        data-testid="floating-disc-only"
        onClick={onClick}
        aria-label={`Quay lại đọc nhanh sách ${book.title}`}
        title={`Đang đọc: ${book.title} (${book.progressPercent}%)`}
        className="fixed z-40 right-3 bottom-[68px] sm:right-5 sm:bottom-[82px] group focus:outline-none touch-manipulation"
      >
        <div className="relative w-[42px] h-[42px] sm:w-[46px] sm:h-[46px] rounded-full bg-white dark:bg-[#16181C] border border-stone-200 dark:border-zinc-700 flex items-center justify-center shadow-lg transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-105 group-active:scale-90">
          {discGraphic}
        </div>
      </button>
    );
  }
);

FloatingBookDisc.displayName = 'FloatingBookDisc';
