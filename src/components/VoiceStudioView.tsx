import React, { useRef, useState } from 'react';
import {
  Type,
  Upload,
  Trash2,
  Volume2,
  Sparkles,
  Loader2,
  Sliders,
  Play,
  Square,
  Plus,
  Check,
  Music,
} from 'lucide-react';
import type {
  CustomAmbientTrack,
  CustomFontAsset,
  ExternalVoiceAsset,
  GeminiVoiceName,
  VoiceToneSettings,
} from '../types/book';
import {
  GEMINI_VOICES,
  createCustomFontFromFile,
  createExternalVoiceFromFile,
} from '../utils/fileHelpers';
import {
  DEFAULT_VOICE_TONE,
  FilteredAudioPlayer,
  VOICE_TONE_PRESETS,
} from '../utils/audioFilterEngine';
import { AmbientSoundPanel } from './AmbientSoundPanel';
import { resolveApiUrl } from '../utils/apiClient';

interface VoiceStudioViewProps {
  customFonts: CustomFontAsset[];
  onAddCustomFont: (font: CustomFontAsset) => Promise<void>;
  onDeleteCustomFont: (fontId: string) => Promise<void>;
  externalVoices: ExternalVoiceAsset[];
  onAddExternalVoice: (voice: ExternalVoiceAsset) => Promise<void>;
  onDeleteExternalVoice: (voiceId: string) => Promise<void>;
  customAmbientTracks: CustomAmbientTrack[];
  onAddCustomAmbientTrack: (track: CustomAmbientTrack) => Promise<void>;
  onDeleteCustomAmbientTrack: (trackId: string) => Promise<void>;
}

export const VoiceStudioView: React.FC<VoiceStudioViewProps> = ({
  customFonts,
  onAddCustomFont,
  onDeleteCustomFont,
  externalVoices,
  onAddExternalVoice,
  onDeleteExternalVoice,
  customAmbientTracks,
  onAddCustomAmbientTrack,
  onDeleteCustomAmbientTrack,
}) => {
  const fontInputRef = useRef<HTMLInputElement>(null);
  const voiceInputRef = useRef<HTMLInputElement>(null);
  const playerRef = useRef<FilteredAudioPlayer | null>(null);

  const [isUploadingVoice, setIsUploadingVoice] = useState(false);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);

  // Voice Studio Builder State
  const [studioName, setStudioName] = useState('Giọng Kể Chuyện Ấm Trầm');
  const [baseGeminiVoice, setBaseGeminiVoice] = useState<GeminiVoiceName>('Charon');
  const [tone, setTone] = useState<VoiceToneSettings>(VOICE_TONE_PRESETS[0].tone);
  const [sampleText, setSampleText] = useState(
    'Đêm khuya thanh vắng, từng trang sách mở ra như một hành trình kỳ diệu đưa tâm trí đi xa.'
  );
  const [isTestingEq, setIsTestingEq] = useState(false);
  const [isSavingVoice, setIsSavingVoice] = useState(false);
  const [studioFeedback, setStudioFeedback] = useState('');

  const getPlayer = () => {
    if (!playerRef.current) {
      playerRef.current = new FilteredAudioPlayer();
    }
    return playerRef.current;
  };

  const handleUploadFonts = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      const asset = await createCustomFontFromFile(file);
      await onAddCustomFont(asset);
    }
  };

  const handleUploadVoices = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsUploadingVoice(true);
    try {
      for (const file of Array.from(files)) {
        const asset = await createExternalVoiceFromFile(file);
        asset.toneSettings = { ...DEFAULT_VOICE_TONE };
        const [, b64] = asset.dataUrl.split(',');
        try {
          const resp = await fetch(resolveApiUrl('/api/ai/analyze-voice-sample'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              audioBase64: b64,
              mimeType: asset.mimeType,
              fileName: asset.fileName,
            }),
          });
          if (resp.ok) {
            asset.analyzedProfile = await resp.json();
          }
        } catch {
          // Non-fatal if AI audio profiling fails
        }
        await onAddExternalVoice(asset);
      }
    } finally {
      setIsUploadingVoice(false);
    }
  };

  const togglePreviewVoice = async (voice: ExternalVoiceAsset) => {
    const player = getPlayer();
    if (playingVoiceId === voice.id) {
      player.stop();
      setPlayingVoiceId(null);
      return;
    }
    setPlayingVoiceId(voice.id);
    await player.play(voice.dataUrl, voice.toneSettings || DEFAULT_VOICE_TONE, 1.0);
    setPlayingVoiceId(null);
  };

  const handleTestStudioEq = async () => {
    const player = getPlayer();
    if (isTestingEq) {
      player.stop();
      setIsTestingEq(false);
      return;
    }
    setStudioFeedback('');
    setIsTestingEq(true);
    try {
      const resp = await fetch(resolveApiUrl('/api/ai/tts'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: sampleText,
          voiceName: baseGeminiVoice,
          stylePrompt: tone.styleDirection,
          expressive: true,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.audioBase64) {
        throw new Error(data.error || 'Chưa kết nối máy chủ TTS, đang phát bằng giọng trình duyệt.');
      }
      const dataUrl = `data:${data.mimeType || 'audio/wav'};base64,${data.audioBase64}`;
      await player.play(dataUrl, tone, 1.0);
    } catch (err) {
      // Browser SpeechSynthesis fallback
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(sampleText);
        utter.lang = 'vi-VN';
        utter.pitch = tone.pitch;
        utter.rate = tone.rate;
        await new Promise<void>((resolve) => {
          utter.onend = () => resolve();
          utter.onerror = () => resolve();
          window.speechSynthesis.speak(utter);
        });
      } else {
        setStudioFeedback(err instanceof Error ? err.message : 'Không thể phát thử âm thanh.');
      }
    } finally {
      setIsTestingEq(false);
    }
  };

  const handleSaveStudioVoice = async () => {
    setStudioFeedback('');
    setIsSavingVoice(true);
    try {
      let dataUrl = '';
      try {
        const resp = await fetch(resolveApiUrl('/api/ai/tts'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: sampleText,
            voiceName: baseGeminiVoice,
            stylePrompt: tone.styleDirection,
            expressive: true,
          }),
        });
        const data = await resp.json();
        if (resp.ok && data.audioBase64) {
          dataUrl = `data:${data.mimeType || 'audio/wav'};base64,${data.audioBase64}`;
        }
      } catch {
        // Save tone profile even without audio synthesis
      }

      const newVoice: ExternalVoiceAsset = {
        id: `voice-studio-${Date.now()}`,
        name: studioName.trim() || 'Giọng Studio Tùy Chỉnh',
        fileName: `${baseGeminiVoice.toLowerCase()}-studio-profile.wav`,
        mimeType: 'audio/wav',
        dataUrl,
        toneSettings: { ...tone },
        analyzedProfile: {
          description: `Giọng tạo từ Studio (Ấm trầm ${tone.warmthDb >= 0 ? '+' : ''}${tone.warmthDb}dB · Sáng rõ ${tone.clarityDb >= 0 ? '+' : ''}${tone.clarityDb}dB).`,
          stylePrompt: tone.styleDirection,
          recommendedBaseVoice: baseGeminiVoice,
          pitchHint: tone.pitch,
          rateHint: tone.rate,
        },
        addedAt: Date.now(),
      };

      await onAddExternalVoice(newVoice);
      setStudioFeedback(`Đã lưu giọng "${newVoice.name}" vào thư viện Studio để gán cho mọi nhân vật!`);
    } finally {
      setIsSavingVoice(false);
    }
  };

  const handleAdjustExistingVoiceTone = async (
    voice: ExternalVoiceAsset,
    patch: Partial<VoiceToneSettings>
  ) => {
    const nextTone = { ...(voice.toneSettings || DEFAULT_VOICE_TONE), ...patch };
    await onAddExternalVoice({ ...voice, toneSettings: nextTone });
  };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-8">
      <header className="space-y-2 pb-5 border-b border-stone-200 dark:border-stone-800">
        <p className="text-xs uppercase tracking-widest text-stone-500">
          Phòng Thu & Cá Nhân Hóa
        </p>
        <h1 className="text-2xl sm:text-3xl font-display font-semibold text-stone-900 dark:text-stone-100">
          Studio Giọng Đọc & Kho Phông Chữ
        </h1>
        <p className="text-xs sm:text-sm text-stone-600 dark:text-stone-400 max-w-3xl">
          Tinh chỉnh âm sắc ấm trầm, độ sáng rõ, cao độ để tạo giọng đọc riêng hoặc import tệp voice ngoài & phông chữ cho trình đọc sách.
        </p>
      </header>

      {/* Studio Voice Equalizer & Custom Profile Builder */}
      <section
        aria-label="Phòng chỉnh giọng đọc và âm sắc"
        className="border border-stone-200 dark:border-stone-800 rounded-2xl bg-white dark:bg-[#16181C] p-5 sm:p-6 space-y-6"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold flex items-center gap-2 text-stone-900 dark:text-stone-100">
              <Sliders className="w-4 h-4 text-amber-800 dark:text-amber-400" />
              <span>Chế tác Giọng Đọc (Ấm trầm · Truyền cảm · Nhấn nhá)</span>
            </h2>
            <p className="text-xs text-stone-500 mt-0.5">
              Chọn mẫu âm sắc có sẵn hoặc kéo thanh Equalizer để tạo bộ giọng mới dùng cho sách nói
            </p>
          </div>
          <div className="inline-flex flex-wrap gap-1.5 p-1 rounded-[22px] ios-liquid-bar border border-white/75 dark:border-zinc-700/60">
            {VOICE_TONE_PRESETS.map((preset) => {
              const isSelected = studioName === preset.label;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    setTone({ ...preset.tone });
                    setStudioName(preset.label);
                  }}
                  className={`ios-liquid-pill px-3.5 py-1.5 rounded-full text-[11px] font-medium min-h-[34px] ${
                    isSelected
                      ? 'ios-liquid-pill-active text-amber-800 dark:text-amber-300 font-semibold'
                      : 'text-stone-600 dark:text-stone-300 hover:bg-white/45 dark:hover:bg-white/10'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-stone-500 mb-1">
                  Tên giọng mới
                </label>
                <input
                  type="text"
                  value={studioName}
                  onChange={(e) => setStudioName(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-stone-300 dark:border-stone-700 bg-transparent"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-stone-500 mb-1">
                  Chất giọng AI nền
                </label>
                <select
                  value={baseGeminiVoice}
                  onChange={(e) => setBaseGeminiVoice(e.target.value as GeminiVoiceName)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900"
                >
                  {GEMINI_VOICES.map((gv) => (
                    <option key={gv.name} value={gv.name}>
                      {gv.label} — {gv.tone}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-stone-500 mb-1">
                Chỉ dẫn diễn cảm AI
              </label>
              <input
                type="text"
                value={tone.styleDirection}
                onChange={(e) => setTone((t) => ({ ...t, styleDirection: e.target.value }))}
                className="w-full px-3 py-2 text-xs rounded-lg border border-stone-300 dark:border-stone-700 bg-transparent"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-stone-500 mb-1">
                Câu đọc thử
              </label>
              <textarea
                rows={2}
                value={sampleText}
                onChange={(e) => setSampleText(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-stone-300 dark:border-stone-700 bg-transparent"
              />
            </div>
          </div>

          <div className="lg:col-span-6 space-y-4 bg-stone-50 dark:bg-stone-900/50 p-4 rounded-xl border border-stone-200 dark:border-stone-800">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="font-medium">Độ ấm trầm (Bass 240Hz)</span>
                  <span className="tabular-nums text-amber-800 dark:text-amber-400 font-semibold">
                    {tone.warmthDb >= 0 ? '+' : ''}
                    {tone.warmthDb} dB
                  </span>
                </div>
                <input
                  type="range"
                  aria-label="Độ ấm trầm"
                  min={-6}
                  max={12}
                  step={1}
                  value={tone.warmthDb}
                  onChange={(e) => setTone((t) => ({ ...t, warmthDb: Number(e.target.value) }))}
                  className="w-full accent-amber-800 h-2"
                />
              </label>

              <label className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="font-medium">Độ sáng rõ (Clarity 3.2kHz)</span>
                  <span className="tabular-nums text-amber-800 dark:text-amber-400 font-semibold">
                    {tone.clarityDb >= 0 ? '+' : ''}
                    {tone.clarityDb} dB
                  </span>
                </div>
                <input
                  type="range"
                  aria-label="Độ sáng rõ"
                  min={-6}
                  max={10}
                  step={1}
                  value={tone.clarityDb}
                  onChange={(e) => setTone((t) => ({ ...t, clarityDb: Number(e.target.value) }))}
                  className="w-full accent-amber-800 h-2"
                />
              </label>

              <label className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="font-medium">Cao độ (Pitch)</span>
                  <span className="tabular-nums font-semibold">{tone.pitch.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  aria-label="Cao độ giọng"
                  min={0.7}
                  max={1.4}
                  step={0.05}
                  value={tone.pitch}
                  onChange={(e) => setTone((t) => ({ ...t, pitch: Number(e.target.value) }))}
                  className="w-full accent-amber-800 h-2"
                />
              </label>

              <label className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="font-medium">Nhịp đọc (Tốc độ)</span>
                  <span className="tabular-nums font-semibold">{tone.rate.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  aria-label="Nhịp đọc giọng"
                  min={0.75}
                  max={1.45}
                  step={0.05}
                  value={tone.rate}
                  onChange={(e) => setTone((t) => ({ ...t, rate: Number(e.target.value) }))}
                  className="w-full accent-amber-800 h-2"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleTestStudioEq}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-xs font-medium hover:bg-stone-100 dark:hover:bg-stone-800 min-h-[44px]"
              >
                {isTestingEq ? (
                  <>
                    <Square className="w-3.5 h-3.5 text-red-600" />
                    <span>Dừng nghe thử</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400" />
                    <span>Nghe thử qua bộ lọc EQ</span>
                  </>
                )}
              </button>

              <button
                type="button"
                disabled={isSavingVoice}
                onClick={handleSaveStudioVoice}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-amber-800 text-white text-xs font-medium hover:bg-amber-900 disabled:opacity-50 min-h-[44px]"
              >
                {isSavingVoice ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Plus className="w-3.5 h-3.5" />
                )}
                <span>Lưu thành Voice mới</span>
              </button>
            </div>

            {studioFeedback && (
              <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400">
                <Check className="w-4 h-4 shrink-0" />
                <span>{studioFeedback}</span>
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* External & Saved Studio Voices Section */}
        <section className="border border-stone-200 dark:border-stone-800 rounded-2xl bg-white dark:bg-[#16181C] p-5 sm:p-6 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-amber-800 dark:text-amber-400" />
                <span>Voice đã thêm & Studio ({externalVoices.length})</span>
              </h2>
              <p className="text-xs text-stone-500 mt-0.5">
                Import .MP3, .WAV, .OGG, .M4A hoặc giọng tự tạo để gán nhân vật
              </p>
            </div>
            <input
              ref={voiceInputRef}
              type="file"
              accept="audio/*,.mp3,.wav,.ogg,.m4a"
              multiple
              className="hidden"
              onChange={(e) => handleUploadVoices(e.target.files)}
            />
            <button
              type="button"
              disabled={isUploadingVoice}
              onClick={() => voiceInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-800 text-white text-xs font-medium hover:bg-amber-900 whitespace-nowrap disabled:opacity-50 min-h-[44px]"
            >
              {isUploadingVoice ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              <span>Import file voice</span>
            </button>
          </div>

          {externalVoices.length === 0 ? (
            <div className="py-10 text-center text-xs text-stone-500 border border-dashed border-stone-200 dark:border-stone-800 rounded-lg">
              Chưa có giọng ngoài nào. Hãy nhấn &ldquo;Lưu thành Voice mới&rdquo; ở trên hoặc tải lên tệp .mp3/.wav từ máy.
            </div>
          ) : (
            <div className="space-y-3">
              {externalVoices.map((voice) => {
                const vTone = voice.toneSettings || DEFAULT_VOICE_TONE;
                return (
                  <div
                    key={voice.id}
                    className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{voice.name}</div>
                        <div className="text-[11px] text-stone-500 truncate">{voice.fileName}</div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {voice.dataUrl && (
                          <button
                            type="button"
                            onClick={() => togglePreviewVoice(voice)}
                            className="px-3 py-1.5 rounded-md border border-stone-300 dark:border-stone-700 text-xs hover:bg-stone-100 dark:hover:bg-stone-800 min-h-[36px]"
                          >
                            {playingVoiceId === voice.id ? 'Dừng' : 'Nghe mẫu'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onDeleteExternalVoice(voice.id)}
                          aria-label={`Xóa file voice ${voice.name}`}
                          className="p-2 rounded text-stone-400 hover:text-red-600"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Per-voice Bass/Warmth & Rate fine tuner */}
                    <div className="grid grid-cols-2 gap-3 pt-2 border-t border-stone-100 dark:border-stone-800 text-[11px]">
                      <label className="space-y-1">
                        <span className="text-stone-500 tabular-nums">
                          Ấm trầm: {vTone.warmthDb >= 0 ? '+' : ''}
                          {vTone.warmthDb} dB
                        </span>
                        <input
                          type="range"
                          min={-6}
                          max={12}
                          step={1}
                          value={vTone.warmthDb}
                          onChange={(e) =>
                            handleAdjustExistingVoiceTone(voice, {
                              warmthDb: Number(e.target.value),
                            })
                          }
                          className="w-full accent-amber-800"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-stone-500 tabular-nums">
                          Tốc độ: {vTone.rate.toFixed(2)}x
                        </span>
                        <input
                          type="range"
                          min={0.75}
                          max={1.45}
                          step={0.05}
                          value={vTone.rate}
                          onChange={(e) =>
                            handleAdjustExistingVoiceTone(voice, {
                              rate: Number(e.target.value),
                            })
                          }
                          className="w-full accent-amber-800"
                        />
                      </label>
                    </div>

                    {voice.analyzedProfile && (
                      <div className="pt-2 border-t border-stone-100 dark:border-stone-800 text-[11px] text-stone-600 dark:text-stone-400 space-y-1">
                        <div className="flex items-center gap-1 font-medium text-amber-800 dark:text-amber-400">
                          <Sparkles className="w-3 h-3" />
                          <span>
                            Giọng nền {voice.analyzedProfile.recommendedBaseVoice} · Cao độ{' '}
                            {voice.analyzedProfile.pitchHint}
                          </span>
                        </div>
                        <p>{voice.analyzedProfile.description}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Custom Fonts Section */}
        <section className="border border-stone-200 dark:border-stone-800 rounded-2xl bg-white dark:bg-[#16181C] p-5 sm:p-6 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Type className="w-4 h-4 text-amber-800 dark:text-amber-400" />
                <span>Phông chữ đã import ({customFonts.length})</span>
              </h2>
              <p className="text-xs text-stone-500 mt-0.5">
                Hỗ trợ .TTF, .OTF, .WOFF, .WOFF2 — tự động nạp vào Trình đọc
              </p>
            </div>
            <input
              ref={fontInputRef}
              type="file"
              accept=".ttf,.otf,.woff,.woff2"
              multiple
              className="hidden"
              onChange={(e) => handleUploadFonts(e.target.files)}
            />
            <button
              type="button"
              onClick={() => fontInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-xs font-medium whitespace-nowrap min-h-[44px]"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Import phông</span>
            </button>
          </div>

          {customFonts.length === 0 ? (
            <div className="py-10 text-center text-xs text-stone-500 border border-dashed border-stone-200 dark:border-stone-800 rounded-lg">
              Chưa có phông chữ ngoài nào. Nhấn &ldquo;Import phông&rdquo; để thêm bộ chữ yêu thích của bạn.
            </div>
          ) : (
            <div className="space-y-3">
              {customFonts.map((font) => (
                <div
                  key={font.id}
                  className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold">{font.name}</div>
                      <div className="text-[11px] text-stone-500">
                        {font.fileName} · .{font.format}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onDeleteCustomFont(font.id)}
                      aria-label={`Xóa phông ${font.name}`}
                      className="p-2 rounded text-stone-400 hover:text-red-600"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <p
                    style={{ fontFamily: `"${font.fontFamily}", serif` }}
                    className="text-base text-stone-700 dark:text-stone-300 pt-1 border-t border-stone-100 dark:border-stone-800"
                  >
                    Trăm năm trong cõi người ta, chữ tài chữ mệnh khéo là ghét nhau.
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Ambient Sound & Chill Music Mixer Section */}
      <section
        aria-label="Kho âm thanh nền và nhạc chill khi đọc nghe"
        className="border border-stone-200 dark:border-stone-800 rounded-2xl bg-white dark:bg-[#16181C] p-5 sm:p-6 space-y-5"
      >
        <div>
          <h2 className="text-lg font-display font-semibold flex items-center gap-2 text-stone-900 dark:text-stone-100">
            <Music className="w-5 h-5 text-amber-800 dark:text-amber-400" />
            <span>Âm thanh nền & Nhạc Chill khi đọc / nghe sách (20+)</span>
          </h2>
          <p className="text-xs text-stone-500 mt-0.5">
            Chọn tiếng mưa, lửa trại, sóng biển, nhạc lo-fi chill hoặc import file nhạc MP3/WAV từ thiết bị để phát nền cùng lúc.
          </p>
        </div>

        <AmbientSoundPanel
          customTracks={customAmbientTracks}
          onAddCustomTrack={onAddCustomAmbientTrack}
          onDeleteCustomTrack={onDeleteCustomAmbientTrack}
        />
      </section>
    </main>
  );
};
