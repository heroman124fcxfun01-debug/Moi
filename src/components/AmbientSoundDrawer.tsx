import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Music, X } from 'lucide-react';
import type { CustomAmbientTrack } from '../types/book';
import { AmbientSoundPanel } from './AmbientSoundPanel';

interface AmbientSoundDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  customTracks: CustomAmbientTrack[];
  onAddCustomTrack: (track: CustomAmbientTrack) => Promise<void>;
  onDeleteCustomTrack: (trackId: string) => Promise<void>;
}

export const AmbientSoundDrawer: React.FC<AmbientSoundDrawerProps> = ({
  isOpen,
  onClose,
  customTracks,
  onAddCustomTrack,
  onDeleteCustomTrack,
}) => {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setIsDesktop(window.innerWidth >= 1024);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!isOpen) return null;

  const content = (
    <>
      {!isDesktop && (
        <div className="flex justify-center pt-2 pb-1 shrink-0">
          <span className="w-10 h-1 rounded-full bg-stone-300 dark:bg-stone-700" />
        </div>
      )}
      <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-3.5 border-b border-stone-200 dark:border-stone-800 shrink-0">
        <div className="min-w-0">
          <h2 className="text-base font-display font-semibold flex items-center gap-2">
            <Music className="w-4 h-4 text-amber-800 dark:text-amber-400 shrink-0" />
            <span className="truncate">Âm thanh &amp; Nhạc nền Chill</span>
          </h2>
          <p className="text-[11px] text-stone-500 mt-0.5 leading-snug">
            20 âm thanh thư giãn có sẵn &amp; nhập nhạc ngoài — trộn nhiều tiếng cùng lúc
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng bảng âm thanh nền"
          className="w-8 h-8 rounded-full bg-stone-200/70 dark:bg-stone-800 flex items-center justify-center text-stone-600 dark:text-stone-300 shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="overflow-y-auto overscroll-contain min-h-0 p-4 sm:p-5">
        <AmbientSoundPanel
          compact
          customTracks={customTracks}
          onAddCustomTrack={onAddCustomTrack}
          onDeleteCustomTrack={onDeleteCustomTrack}
        />
      </div>
    </>
  );

  if (!isDesktop && typeof document !== 'undefined') {
    return createPortal(
      <div className="fixed inset-0 z-[75] flex items-end justify-center">
        <div
          className="fixed inset-0 bg-black/45 backdrop-blur-xs"
          onClick={onClose}
          aria-hidden="true"
        />
        <aside
          aria-label="Âm thanh và nhạc nền khi đọc hoặc nghe sách"
          className="ios-sheet-enter relative z-10 w-full max-w-lg h-auto max-h-[82dvh] rounded-t-[28px] bg-[#FBF9F5]/98 dark:bg-[#16181C]/98 backdrop-blur-xl text-stone-900 dark:text-stone-100 border-t border-x border-stone-200/90 dark:border-stone-800 shadow-2xl flex flex-col overflow-hidden"
        >
          {content}
        </aside>
      </div>,
      document.body
    );
  }

  return (
    <aside
      aria-label="Âm thanh và nhạc nền khi đọc hoặc nghe sách"
      className="ios-drawer-right w-[400px] shrink-0 sticky top-[52px] self-start h-auto max-h-[calc(100vh-52px)] bg-[#FBF9F5]/95 dark:bg-[#16181C]/95 backdrop-blur-xl text-stone-900 dark:text-stone-100 border-l border-b border-stone-200/80 dark:border-stone-800 rounded-bl-2xl shadow-lg flex flex-col overflow-hidden"
    >
      {content}
    </aside>
  );
};
