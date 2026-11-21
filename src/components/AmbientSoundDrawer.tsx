import React, { useEffect, useState } from 'react';
import { ChevronLeft, Music, X } from 'lucide-react';
import type { CustomAmbientTrack } from '../types/book';
import { useI18n } from '../contexts/LanguageContext';
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
  const { strings } = useI18n();
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
      <div className="flex items-center justify-between gap-2 px-3.5 sm:px-4 py-2 border-b border-stone-300/40 dark:border-white/10 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          {onBackToToolsMenu && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onBackToToolsMenu();
              }}
              aria-label={strings.back}
              className="inline-flex items-center gap-0.5 px-2 py-1 -ml-1 rounded-full bg-black/5 dark:bg-white/10 text-[11px] font-semibold text-stone-700 dark:text-stone-200 hover:bg-black/10 shrink-0"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>{strings.back}</span>
            </button>
          )}
          <h2 className="text-[13px] font-display font-semibold flex items-center gap-1.5 min-w-0">
            <Music className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400 shrink-0" />
            <span className="truncate">{strings.ambientDrawerTitle}</span>
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={strings.close}
          className="p-1.5 rounded-md text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-200/60 dark:hover:bg-stone-800 shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="overflow-y-auto overscroll-contain min-h-0 px-3.5 sm:px-4 py-2.5">
        <AmbientSoundPanel
          compact
          readerMinimal
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
      ariaLabel={strings.ambientDrawerTitle}
      testId="reader-ambient-drawer"
      variant={isDesktop ? 'drawer-right' : 'bottom-sheet'}
      inlineDesktop={isDesktop}
      showGrabHandle={!isDesktop}
      backdropClassName={!isDesktop ? '!bg-black/15 !backdrop-blur-none' : ''}
      zIndexClass="z-[75]"
      panelClassName={
        isDesktop
          ? 'w-[370px] shrink-0 sticky top-[52px] self-start h-auto max-h-[calc(100vh-52px)] text-stone-900 dark:text-stone-100 rounded-bl-[24px] flex flex-col overflow-hidden'
          : 'w-full max-w-lg h-auto max-h-[48dvh] rounded-t-[24px] text-stone-900 dark:text-stone-100 flex flex-col overflow-hidden'
      }
    >
      {content}
    </IosSheet>
  );
};
