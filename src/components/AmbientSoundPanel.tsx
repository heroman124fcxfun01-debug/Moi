import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Music,
  Pause,
  Play,
  Search,
  Square,
  Trash2,
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

interface AmbientSoundPanelProps {
  customTracks: CustomAmbientTrack[];
  onAddCustomTrack: (track: CustomAmbientTrack) => Promise<void>;
  onDeleteCustomTrack: (trackId: string) => Promise<void>;
  compact?: boolean;
}

type FilterTab = 'all' | AmbientSoundCategory | 'custom';

export const AmbientSoundPanel: React.FC<AmbientSoundPanelProps> = ({
  customTracks,
  onAddCustomTrack,
  onDeleteCustomTrack,
  compact = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<FilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isImporting, setIsImporting] = useState(false);

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
    <div className="space-y-4">
      {/* Master Volume & Active Mixer Header */}
      <div className="p-3.5 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white/80 dark:bg-stone-900/70 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-stone-900 dark:text-stone-100">
            <Volume2 className="w-4 h-4 text-amber-800 dark:text-amber-400" />
            <span>
              Âm thanh nền đang trộn ({activeCount})
            </span>
          </div>

          <div className="flex items-center gap-2">
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
              className="ios-liquid-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-800 text-white text-[11px] font-semibold hover:bg-amber-900"
            >
              <Upload className="w-3 h-3" />
              <span>{isImporting ? 'Đang nạp...' : 'Import nhạc'}</span>
            </button>

            {activeCount > 0 && (
              <button
                type="button"
                onClick={() => ambientSoundManager.stopAll()}
                className="ios-liquid-pill inline-flex items-center gap-1 px-3 py-1.5 rounded-full ios-liquid-bar border border-white/75 dark:border-zinc-700/60 text-[11px] font-medium text-stone-700 dark:text-stone-200"
              >
                <Square className="w-3 h-3" />
                <span>Tắt hết</span>
              </button>
            )}
          </div>
        </div>

        <label className="flex items-center gap-3 text-[11px] text-stone-600 dark:text-stone-400">
          <span className="shrink-0 w-24">Âm lượng tổng</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(playbackSnap.masterVolume * 100)}
            onChange={(e) =>
              ambientSoundManager.setMasterVolume(Number(e.target.value) / 100)
            }
            aria-label="Âm lượng tổng nhạc nền"
            className="flex-1 accent-amber-800"
          />
          <span className="w-9 text-right tabular-nums font-medium">
            {Math.round(playbackSnap.masterVolume * 100)}%
          </span>
        </label>
      </div>

      {/* Category Filter Liquid-Glass Pills & Search */}
      <div className="space-y-2.5">
        <div className="inline-flex flex-wrap gap-1 p-1 rounded-[20px] ios-liquid-bar border border-white/75 dark:border-zinc-700/60">
          {(
            ['all', 'nature', 'space', 'chill', 'custom'] as FilterTab[]
          ).map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`ios-liquid-pill px-3 py-1.5 rounded-full text-[11px] font-medium ${
                category === cat
                  ? 'ios-liquid-pill-active text-amber-800 dark:text-amber-300 font-semibold'
                  : 'text-stone-600 dark:text-stone-300 hover:bg-white/45 dark:hover:bg-white/10'
              }`}
            >
              {cat === 'custom'
                ? `Nhạc đã Import (${customTracks.length})`
                : AMBIENT_CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm tiếng mưa, lửa trại, lo-fi, piano..."
            aria-label="Tìm kiếm âm thanh và nhạc nền"
            className="w-full pl-9 pr-4 py-2 text-xs rounded-full ios-liquid-bar border border-white/75 dark:border-zinc-700/60 text-stone-900 dark:text-stone-100 focus:outline-none focus:border-amber-800"
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
                  <div
                    key={track.id}
                    className={`p-3 rounded-xl border transition-colors space-y-2 ${
                      isPlaying
                        ? 'border-amber-700 bg-amber-50/70 dark:bg-amber-950/30'
                        : 'border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => ambientSoundManager.toggleCustomTrack(track)}
                        className="flex items-center gap-2.5 min-w-0 flex-1 text-left"
                      >
                        <span
                          className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                            isPlaying
                              ? 'bg-amber-800 text-white'
                              : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300'
                          }`}
                        >
                          {isPlaying ? (
                            <Pause className="w-3.5 h-3.5" />
                          ) : (
                            <Play className="w-3.5 h-3.5" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-stone-900 dark:text-stone-100 truncate">
                            {track.name}
                          </div>
                          <div className="text-[10px] text-stone-500 truncate">
                            {track.fileName} · Lặp liên tục
                          </div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (isPlaying) ambientSoundManager.stopTrack(track.id);
                          onDeleteCustomTrack(track.id);
                        }}
                        aria-label={`Xóa nhạc ${track.name}`}
                        className="p-1.5 rounded-lg text-stone-400 hover:text-red-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {isPlaying && (
                      <div className="flex items-center gap-2 text-[10px] text-stone-600 dark:text-stone-400 pt-1">
                        <span>Mức tiếng</span>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={Math.round(trackVol * 100)}
                          onChange={(e) =>
                            ambientSoundManager.setTrackVolume(
                              track.id,
                              Number(e.target.value) / 100
                            )
                          }
                          aria-label={`Âm lượng ${track.name}`}
                          className="flex-1 accent-amber-800"
                        />
                        <span className="w-8 text-right tabular-nums">
                          {Math.round(trackVol * 100)}%
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 20 Built-in Ambient & Chill Presets */}
      {category !== 'custom' && (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
            Âm thanh có sẵn ({filteredBuiltin.length})
          </div>
          <div className={compact ? 'space-y-2' : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5'}>
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
                    <div className="flex items-center gap-2 text-[10px] text-stone-600 dark:text-stone-400 pt-1">
                      <span>Mức tiếng</span>
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
                        className="flex-1 accent-amber-800"
                      />
                      <span className="w-8 text-right tabular-nums">
                        {Math.round(trackVol * 100)}%
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
