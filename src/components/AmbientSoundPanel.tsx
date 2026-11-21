import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Music,
  Pause,
  Play,
  Search,
  Square,
  Upload,
  Volume2,
} from 'lucide-react';
import type { AmbientSoundCategory, CustomAmbientTrack } from '../types/book';
import {
  AMBIENT_CATEGORY_LABELS,
  BUILTIN_AMBIENT_SOUNDS,
  ambientSoundManager,
  filterAmbientSounds,
} from '../utils/ambientSoundEngine';
import { readFileAsDataUrl } from '../utils/fileHelpers';
import { LiquidDropThumb, useLiquidDropIndicator } from './LiquidGlassBar';
import { useLongPress } from '../hooks/useLongPress';
import { LongPressActionSheet } from './LongPressActionSheet';
import { TwoTapDeleteButton } from './TwoTapDeleteButton';

interface AmbientSoundPanelProps {
  customTracks: CustomAmbientTrack[];
  onAddCustomTrack: (track: CustomAmbientTrack) => Promise<void>;
  onDeleteCustomTrack: (trackId: string) => Promise<void>;
  compact?: boolean;
}

interface CustomTrackRowProps {
  track: CustomAmbientTrack;
  trackVol: number | undefined;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onLongPressOpen: () => void;
  onDelete: () => void;
}

const CustomTrackRow: React.FC<CustomTrackRowProps> = ({
  track,
  trackVol,
  isPlaying,
  onTogglePlay,
  onLongPressOpen,
  onDelete,
}) => {
  const { handlers, consumeLongPressClick } = useLongPress({
    onLongPress: onLongPressOpen,
  });

  return (
    <div
      className={`p-3 rounded-xl border transition-colors space-y-2 ${
        isPlaying
          ? 'border-amber-700 bg-amber-50/70 dark:bg-amber-950/30'
          : 'border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/60'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          {...handlers}
          onClick={() => {
            if (consumeLongPressClick()) return;
            onTogglePlay();
          }}
          title="Nhấn để phát · Nhấn giữ tên để đổi tên hoặc xóa"
          className="flex items-center gap-2.5 min-w-0 flex-1 text-left select-none"
        >
          <span
            className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
              isPlaying
                ? 'bg-amber-800 text-white'
                : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300'
            }`}
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </span>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-stone-900 dark:text-stone-100 truncate">
              {track.name}
            </div>
            <div className="text-[10px] text-stone-500 truncate">
              {track.fileName} · Nhấn giữ để đổi tên / xóa
            </div>
          </div>
        </button>

        <TwoTapDeleteButton
          variant="icon"
          title={`Xóa nhạc ${track.name}`}
          onConfirmDelete={onDelete}
        />
      </div>

      {isPlaying && typeof trackVol === 'number' && (
        <div className="space-y-1 text-[10px] text-stone-600 dark:text-stone-400 pt-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span>Mức tiếng</span>
            <span className="tabular-nums font-medium">{Math.round(trackVol * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(trackVol * 100)}
            onChange={(e) =>
              ambientSoundManager.setTrackVolume(track.id, Number(e.target.value) / 100)
            }
            aria-label={`Âm lượng ${track.name}`}
            className="block w-full min-w-0 max-w-full accent-amber-800"
          />
        </div>
      )}
    </div>
  );
};

type FilterTab = 'all' | AmbientSoundCategory | 'custom';

export const AmbientSoundPanel: React.FC<AmbientSoundPanelProps> = ({
  customTracks,
  onAddCustomTrack,
  onDeleteCustomTrack,
  compact = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const categoryBarRef = useRef<HTMLDivElement>(null);
  const [category, setCategory] = useState<FilterTab>('all');
  const { thumb: categoryThumb, isGliding: categoryGliding } = useLiquidDropIndicator(
    category,
    categoryBarRef
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [actionTrack, setActionTrack] = useState<CustomAmbientTrack | null>(null);

  const [playbackSnap, setPlaybackSnap] = useState(() =>
    ambientSoundManager.getSnapshot()
  );

  useEffect(() => {
    return ambientSoundManager.subscribe(setPlaybackSnap);
  }, []);

  const activeCount = Object.keys(playbackSnap.activeVolumes).length;

  const filteredBuiltin = useMemo(() => {
    if (category === 'custom') return [];
    return filterAmbientSounds(BUILTIN_AMBIENT_SOUNDS, category, searchQuery);
  }, [category, searchQuery]);

  const filteredCustom = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return customTracks.filter(
      (t) =>
        !q ||
        t.name.toLowerCase().includes(q) ||
        t.fileName.toLowerCase().includes(q)
    );
  }, [customTracks, searchQuery]);

  const handleImportAudio = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsImporting(true);
    try {
      for (const file of Array.from(files)) {
        const dataUrl = await readFileAsDataUrl(file);
        const track: CustomAmbientTrack = {
          id: `amb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: file.name.replace(/\.[^.]+$/, ''),
          fileName: file.name,
          mimeType: file.type || 'audio/mpeg',
          dataUrl,
          addedAt: Date.now(),
        };
        await onAddCustomTrack(track);
      }
      setCategory('custom');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-4 min-w-0 w-full overflow-hidden">
      {/* Master Volume & Active Mixer Header */}
      <div className="p-3.5 sm:p-4 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white/80 dark:bg-stone-900/70 space-y-3 min-w-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-stone-900 dark:text-stone-100 min-w-0">
            <Volume2 className="w-4 h-4 text-amber-800 dark:text-amber-400 shrink-0" />
            <span className="truncate">
              Âm thanh nền đang trộn ({activeCount})
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac"
              multiple
              className="hidden"
              onChange={(e) => {
                handleImportAudio(e.target.files);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              disabled={isImporting}
              onClick={() => fileInputRef.current?.click()}
              className="ios-liquid-btn inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-800 text-white text-[11px] font-semibold hover:bg-amber-900 whitespace-nowrap"
            >
              <Upload className="w-3 h-3 shrink-0" />
              <span>{isImporting ? 'Đang nạp...' : 'Import nhạc'}</span>
            </button>

            {activeCount > 0 && (
              <button
                type="button"
                onClick={() => ambientSoundManager.stopAll()}
                className="ios-liquid-pill inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-full ios-liquid-bar border border-white/75 dark:border-zinc-700/60 text-[11px] font-medium text-stone-700 dark:text-stone-200 whitespace-nowrap"
              >
                <Square className="w-3 h-3 shrink-0" />
                <span>Tắt hết</span>
              </button>
            )}
          </div>
        </div>

        <label className="block space-y-1.5 text-xs text-stone-600 dark:text-stone-400 min-w-0 w-full">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-stone-700 dark:text-stone-300">Âm lượng tổng</span>
            <span className="tabular-nums font-semibold text-stone-900 dark:text-stone-100 shrink-0">
              {Math.round(playbackSnap.masterVolume * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(playbackSnap.masterVolume * 100)}
            onChange={(e) =>
              ambientSoundManager.setMasterVolume(Number(e.target.value) / 100)
            }
            aria-label="Âm lượng tổng nhạc nền"
            className="block w-full min-w-0 max-w-full accent-amber-800 h-2"
          />
        </label>
      </div>

      {/* Category Filter Liquid-Glass Pills & Search */}
      <div className="space-y-2.5 min-w-0">
        <div
          ref={categoryBarRef}
          className="relative flex flex-wrap gap-1.5 p-1.5 rounded-2xl ios-liquid-bar border border-white/75 dark:border-zinc-700/60 w-full"
        >
          <LiquidDropThumb
            thumb={categoryThumb}
            isGliding={categoryGliding}
            roundedClass="rounded-full"
          />
          {(
            ['all', 'nature', 'space', 'chill', 'custom'] as FilterTab[]
          ).map((cat) => (
            <button
              key={cat}
              type="button"
              data-liquid-key={cat}
              onClick={() => setCategory(cat)}
              className={`relative z-10 ios-liquid-pill px-3 py-1.5 rounded-full text-[11px] font-medium ${
                category === cat
                  ? 'text-amber-800 dark:text-amber-300 font-semibold'
                  : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              {cat === 'custom'
                ? `Nhạc đã Import (${customTracks.length})`
                : AMBIENT_CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>

        <div className="relative w-full min-w-0">
          <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm tiếng mưa, lửa trại, lo-fi, piano..."
            aria-label="Tìm kiếm âm thanh và nhạc nền"
            className="w-full min-w-0 pl-9 pr-4 py-2 text-xs rounded-full ios-liquid-bar border border-white/75 dark:border-zinc-700/60 text-stone-900 dark:text-stone-100 focus:outline-none focus:border-amber-800"
          />
        </div>
      </div>

      {/* Imported Custom Audio Tracks Section */}
      {(category === 'all' || category === 'custom') && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-stone-500">
            <span>Nhạc & Tiếng đã Import ({filteredCustom.length})</span>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-amber-800 dark:text-amber-400 normal-case font-medium hover:underline"
            >
              + Thêm file nhạc
            </button>
          </div>

          {filteredCustom.length === 0 ? (
            category === 'custom' && (
              <div className="p-5 rounded-xl border border-dashed border-stone-300 dark:border-stone-700 text-center text-xs text-stone-500 space-y-2">
                <Music className="w-5 h-5 mx-auto text-stone-400" />
                <p>Chưa có nhạc hoặc âm thanh ngoài nào được nạp.</p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1.5 rounded-lg bg-amber-800 text-white text-[11px] font-medium"
                >
                  Chọn file MP3 / WAV / M4A từ máy
                </button>
              </div>
            )
          ) : (
            <div className={compact ? 'space-y-2' : 'grid grid-cols-1 sm:grid-cols-2 gap-2.5'}>
              {filteredCustom.map((track) => {
                const trackVol = playbackSnap.activeVolumes[track.id];
                const isPlaying = typeof trackVol === 'number';
                return (
                  <CustomTrackRow
                    key={track.id}
                    track={track}
                    trackVol={trackVol}
                    isPlaying={isPlaying}
                    onTogglePlay={() => ambientSoundManager.toggleCustomTrack(track)}
                    onLongPressOpen={() => setActionTrack(track)}
                    onDelete={() => {
                      if (isPlaying) ambientSoundManager.stopTrack(track.id);
                      void onDeleteCustomTrack(track.id);
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Long-Press Rename / 2-Tap Red Delete Sheet (strictly for imported custom tracks) */}
      <LongPressActionSheet
        open={Boolean(actionTrack)}
        itemName={actionTrack?.name || ''}
        itemSubtitle={actionTrack?.fileName}
        categoryLabel="Âm thanh đã Import"
        canDelete={true}
        onClose={() => setActionTrack(null)}
        onRename={async (nextName) => {
          if (!actionTrack) return;
          await onAddCustomTrack({ ...actionTrack, name: nextName });
        }}
        onDelete={async () => {
          if (!actionTrack) return;
          if (typeof playbackSnap.activeVolumes[actionTrack.id] === 'number') {
            ambientSoundManager.stopTrack(actionTrack.id);
          }
          await onDeleteCustomTrack(actionTrack.id);
        }}
      />

      {/* 20 Built-in Ambient & Chill Presets inside a Bordered Scrollable Box (2/3 height) */}
      {category !== 'custom' && (
        <div className="space-y-2">
          <div className="text-[11px] font-sans font-semibold uppercase tracking-wider text-stone-500">
            Tất cả nhạc nền ({filteredBuiltin.length})
          </div>
          <div
            data-testid="ambient-sounds-scroll-box"
            className="max-h-[245px] overflow-y-auto p-2 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-950/30"
          >
            <div className={compact ? 'space-y-2' : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2'}>
            {filteredBuiltin.map((sound) => {
              const trackVol = playbackSnap.activeVolumes[sound.id];
              const isPlaying = typeof trackVol === 'number';
              return (
                <div
                  key={sound.id}
                  className={`p-3 rounded-xl border transition-colors space-y-2 ${
                    isPlaying
                      ? 'border-amber-700 bg-amber-50/75 dark:bg-amber-950/30'
                      : 'border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/60 hover:border-stone-300 dark:hover:border-stone-700'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => ambientSoundManager.toggleBuiltin(sound.id)}
                    className="w-full flex items-center justify-between gap-2 text-left"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-8 h-8 rounded-xl bg-stone-100 dark:bg-stone-800 flex items-center justify-center text-base shrink-0">
                        {sound.emoji}
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-stone-900 dark:text-stone-100 truncate">
                          {sound.name}
                        </div>
                        <div className="text-[10.5px] text-stone-500 line-clamp-1">
                          {sound.description}
                        </div>
                      </div>
                    </div>

                    <span
                      className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                        isPlaying
                          ? 'bg-amber-800 text-white'
                          : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300'
                      }`}
                    >
                      {isPlaying ? (
                        <Pause className="w-3.5 h-3.5" />
                      ) : (
                        <Play className="w-3.5 h-3.5" />
                      )}
                    </span>
                  </button>

                  {isPlaying && (
                    <div className="space-y-1 text-[10px] text-stone-600 dark:text-stone-400 pt-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span>Mức tiếng</span>
                        <span className="tabular-nums font-medium">
                          {Math.round(trackVol * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(trackVol * 100)}
                        onChange={(e) =>
                          ambientSoundManager.setTrackVolume(
                            sound.id,
                            Number(e.target.value) / 100
                          )
                        }
                        aria-label={`Âm lượng ${sound.name}`}
                        className="block w-full min-w-0 accent-amber-800"
                      />
                    </div>
                  )}
                </div>
              );
            })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
