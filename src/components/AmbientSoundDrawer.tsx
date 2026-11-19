import React from 'react';
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
  if (!isOpen) return null;

  return (
    <aside
      aria-label="Âm thanh và nhạc nền khi đọc hoặc nghe sách"
      className="ios-drawer-right fixed inset-y-0 right-0 z-40 w-full max-w-md lg:static lg:z-20 lg:w-[400px] lg:shrink-0 lg:sticky lg:top-[105px] lg:h-[calc(100vh-105px)] bg-[#FBF9F5]/95 dark:bg-[#16181C]/95 backdrop-blur-xl text-stone-900 dark:text-stone-100 border-l border-stone-200/80 dark:border-stone-800 rounded-l-3xl lg:rounded-none shadow-2xl lg:shadow-none flex flex-col"
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h2 className="text-base font-display font-semibold flex items-center gap-2">
            <Music className="w-4 h-4 text-amber-800 dark:text-amber-400" />
            <span>Âm thanh & Nhạc nền Chill</span>
          </h2>
          <p className="text-[11px] text-stone-500 mt-0.5">
            20 âm thanh thư giãn có sẵn & nhập nhạc ngoài — trộn được nhiều tiếng cùng lúc
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng bảng âm thanh nền"
          className="w-8 h-8 rounded-full bg-stone-200/70 dark:bg-stone-800 flex items-center justify-center text-stone-600 dark:text-stone-300"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-5">
        <AmbientSoundPanel
          compact
          customTracks={customTracks}
          onAddCustomTrack={onAddCustomTrack}
          onDeleteCustomTrack={onDeleteCustomTrack}
        />
      </div>
    </aside>
  );
};
