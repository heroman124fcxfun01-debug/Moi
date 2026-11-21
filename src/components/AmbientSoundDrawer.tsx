import React, { useEffect, useState } from 'react';
import { ChevronLeft, Music, X } from 'lucide-react';
import type { CustomAmbientTrack } from '../types/book';
import { AmbientSoundPanel } from './AmbientSoundPanel';
import { IosSheet } from './IosSheet';

interface AmbientSoundDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onBackToToolsMenu?: () => void;
  customTracks: CustomAmbientTrack[];
  onAddCustomTrack: (track: CustomAmbientTrack) => Promise<void>;
  onDeleteCustomTrack: (trackId: string) => Promise<void>;
}

export const AmbientSoundDrawer: React.FC<AmbientSoundDrawerProps> = ({
  isOpen,
  onClose,
  onBackToToolsMenu,
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

  const content = (
    <>
      <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-3 border-b border-stone-300/40 dark:border-white/10 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {onBackToToolsMenu && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onBackToToolsMenu();
              }}
              aria-label="Quay lại tùy chọn đọc sách"
              className="inline-flex items-center gap-0.5 px-2 py-1 -ml-1 rounded-full bg-black/5 dark:bg-white/10 text-[11px] font-semibold text-stone-700 dark:text-stone-200 hover:bg-black/10 shrink-0"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Quay lại</span>
            </button>
          )}
          <div className="min-w-0">
            <h2 className="text-[14px] font-display font-semibold flex items-center gap-1.5">
              <Music className="w-4 h-4 text-amber-800 dark:text-amber-400 shrink-0" />
              <span className="truncate">Âm thanh &amp; Nhạc nền</span>
            </h2>
            <p className="text-[10.5px] text-stone-500 mt-0.5 leading-snug truncate">
              20 âm thanh thư giãn &amp; trộn nhiều tiếng cùng lúc
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng bảng âm thanh nền"
          className="w-8 h-8 rounded-full bg-black/5 dark:bg-white/10 flex items-center justify-center text-stone-600 dark:text-stone-300 shrink-0"
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

  return (
    <IosSheet
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Âm thanh và nhạc nền khi đọc hoặc nghe sách"
      testId="reader-ambient-drawer"
      variant={isDesktop ? 'drawer-right' : 'bottom-sheet'}
      inlineDesktop={isDesktop}
      showGrabHandle={!isDesktop}
      zIndexClass="z-[75]"
      panelClassName={
        isDesktop
          ? 'w-[400px] shrink-0 sticky top-[52px] self-start h-auto max-h-[calc(100vh-52px)] text-stone-900 dark:text-stone-100 rounded-bl-[24px] flex flex-col overflow-hidden'
          : 'w-full max-w-lg h-auto max-h-[84dvh] rounded-t-[26px] text-stone-900 dark:text-stone-100 flex flex-col overflow-hidden'
      }
    >
      {content}
    </IosSheet>
  );
};
