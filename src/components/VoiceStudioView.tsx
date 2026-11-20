import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Type,
  Upload,
  Volume2,
  Sparkles,
  Loader2,
  Sliders,
  Play,
  Square,
  Plus,
  Check,
  Music,
  FileAudio,
  X,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type {
  CustomAmbientTrack,
  CustomFontAsset,
  DefaultVoiceSelection,
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
  MAX_READING_SPEED,
  MIN_READING_SPEED,
  READING_SPEED_STEP,
  VOICE_TONE_PRESETS,
  normalizeReadingSpeed,
  stepReadingSpeed,
} from '../utils/audioFilterEngine';
import {
  analyzeVoiceSampleOnDevice,
  triggerDeviceHaptic,
  type OnDeviceVoiceProfile,
} from '../utils/deviceHardware';
import {
  DEFAULT_GLOBAL_VOICE,
  buildUnifiedFontCatalog,
} from '../utils/studioCatalog';
import { AmbientSoundPanel } from './AmbientSoundPanel';
import { GlassSelect } from './GlassSelect';
import { resolveApiUrl } from '../utils/apiClient';
import {
  getOnDeviceVoiceTone,
  speakOnDevice,
  stopOnDeviceSpeech,
  unlockAudioPlaybackSync,
} from '../utils/deviceTtsEngine';
import { installOfflineVoicePack } from '../utils/offlineVoicePacks';
import { useLongPress } from '../hooks/useLongPress';
import { LongPressActionSheet } from './LongPressActionSheet';
import { TwoTapDeleteButton } from './TwoTapDeleteButton';

const VOICE_ALIAS_STORAGE_KEY = 'bookhad_voice_aliases_v1';
const FONT_ALIAS_STORAGE_KEY = 'bookhad_font_aliases_v1';

function loadAliasMap(storageKey: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function saveAliasMap(storageKey: string, map: Record<string, string>) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(map));
  } catch {
    // ignore storage errors
  }
}

interface LongPressNameLabelProps {
  text: string;
  onLongPress: () => void;
  style?: React.CSSProperties;
  className?: string;
}

const LongPressNameLabel: React.FC<LongPressNameLabelProps> = ({
  text,
  onLongPress,
  style,
  className = '',
}) => {
  const { handlers } = useLongPress({ onLongPress });
  return (
    <div
      {...handlers}
      style={style}
      title="Nhấn giữ (dí) để đổi tên hoặc xóa"
      className={`select-none cursor-pointer ${className}`}
    >
      {text}
    </div>
  );
};

interface VoiceStudioViewProps {
  customFonts: CustomFontAsset[];
  onAddCustomFont: (font: CustomFontAsset) => Promise<void>;
  onDeleteCustomFont: (fontId: string) => Promise<void>;
  activeFontFamily?: string;
  onSelectFontFamily?: (fontFamily: string) => void;
  externalVoices: ExternalVoiceAsset[];
  onAddExternalVoice: (voice: ExternalVoiceAsset) => Promise<void>;
  onDeleteExternalVoice: (voiceId: string) => Promise<void>;
  defaultVoice?: DefaultVoiceSelection;
  onSelectDefaultVoice?: (voice: DefaultVoiceSelection) => void;
  customAmbientTracks: CustomAmbientTrack[];
  onAddCustomAmbientTrack: (track: CustomAmbientTrack) => Promise<void>;
  onDeleteCustomAmbientTrack: (trackId: string) => Promise<void>;
  standaloneDeviceMode?: boolean;
}

interface BuilderImportedVoiceDraft {
  fileName: string;
  mimeType: string;
  dataUrl: string;
  durationSec?: number;
  analyzedProfile: OnDeviceVoiceProfile;
}

type StudioDisclosureKey = 'builder-help' | 'voice-help' | 'font-help' | 'ambient-help' | null;

export const VoiceStudioView: React.FC<VoiceStudioViewProps> = ({
  customFonts,
  onAddCustomFont,
  onDeleteCustomFont,
  activeFontFamily,
  onSelectFontFamily,
  externalVoices,
  onAddExternalVoice,
  onDeleteExternalVoice,
  defaultVoice,
  onSelectDefaultVoice,
  customAmbientTracks,
  onAddCustomAmbientTrack,
  onDeleteCustomAmbientTrack,
  standaloneDeviceMode = true,
}) => {
  const fontInputRef = useRef<HTMLInputElement>(null);
  const builderVoiceInputRef = useRef<HTMLInputElement>(null);
  const playerRef = useRef<FilteredAudioPlayer | null>(null);

  const [isAnalyzingBuilderVoice, setIsAnalyzingBuilderVoice] = useState(false);
  const [builderImportedVoice, setBuilderImportedVoice] =
    useState<BuilderImportedVoiceDraft | null>(null);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);

  // Voice Studio Builder State
  const [studioName, setStudioName] = useState('Giọng Kể Chuyện Ấm Trầm');
  const [selectedPresetId, setSelectedPresetId] = useState<string>(VOICE_TONE_PRESETS[0].id);
  const [baseGeminiVoice, setBaseGeminiVoice] = useState<GeminiVoiceName>('Kore');
  const [tone, setTone] = useState<VoiceToneSettings>(VOICE_TONE_PRESETS[0].tone);
  const [sampleText, setSampleText] = useState(
    'Đêm khuya thanh vắng, từng trang sách mở ra như một hành trình kỳ diệu đưa tâm trí đi xa.'
  );
  const [isTestingEq, setIsTestingEq] = useState(false);
  const [isSavingVoice, setIsSavingVoice] = useState(false);
  const [studioFeedback, setStudioFeedback] = useState('');
  const [expandedFontIds, setExpandedFontIds] = useState<Record<string, boolean>>({});
  const [expandedVoiceIds, setExpandedVoiceIds] = useState<Record<string, boolean>>({});
  const [deviceVoices, setDeviceVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voicePreviewNotice, setVoicePreviewNotice] = useState('');
  const [activeDisclosure, setActiveDisclosure] = useState<StudioDisclosureKey>(null);
  const [voiceAliases, setVoiceAliases] = useState<Record<string, string>>(() =>
    loadAliasMap(VOICE_ALIAS_STORAGE_KEY)
  );
  const [fontAliases, setFontAliases] = useState<Record<string, string>>(() =>
    loadAliasMap(FONT_ALIAS_STORAGE_KEY)
  );
  const [longPressTarget, setLongPressTarget] = useState<{
    kind: 'external-voice' | 'gemini-voice' | 'device-voice' | 'custom-font' | 'builtin-font';
    id: string;
    name: string;
    subtitle?: string;
    canDelete: boolean;
    externalVoice?: ExternalVoiceAsset;
    customFont?: CustomFontAsset;
  } | null>(null);

  const handleRenameLongPressTarget = async (nextName: string) => {
    if (!longPressTarget) return;
    if (longPressTarget.kind === 'external-voice' && longPressTarget.externalVoice) {
      await onAddExternalVoice({ ...longPressTarget.externalVoice, name: nextName });
      return;
    }
    if (longPressTarget.kind === 'gemini-voice' || longPressTarget.kind === 'device-voice') {
      const updated = { ...voiceAliases, [longPressTarget.id]: nextName };
      setVoiceAliases(updated);
      saveAliasMap(VOICE_ALIAS_STORAGE_KEY, updated);
      return;
    }
    if (longPressTarget.kind === 'custom-font' && longPressTarget.customFont) {
      await onAddCustomFont({ ...longPressTarget.customFont, name: nextName });
      return;
    }
    if (longPressTarget.kind === 'builtin-font') {
      const updated = { ...fontAliases, [longPressTarget.id]: nextName };
      setFontAliases(updated);
      saveAliasMap(FONT_ALIAS_STORAGE_KEY, updated);
    }
  };

  const handleDeleteLongPressTarget = async () => {
    if (!longPressTarget || !longPressTarget.canDelete) return;
    if (longPressTarget.kind === 'external-voice' && longPressTarget.externalVoice) {
      await onDeleteExternalVoice(longPressTarget.externalVoice.id);
    } else if (longPressTarget.kind === 'custom-font' && longPressTarget.customFont) {
      await onDeleteCustomFont(longPressTarget.customFont.id);
    }
  };

  const toggleDisclosure = (key: Exclude<StudioDisclosureKey, null>) => {
    setActiveDisclosure((prev) => (prev === key ? null : key));
  };

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const loadDeviceVoices = () => {
      const raw = window.speechSynthesis.getVoices() || [];
      const viVoices = raw.filter((v) => v.lang.toLowerCase().startsWith('vi'));
      const otherVoices = raw.filter((v) => !v.lang.toLowerCase().startsWith('vi')).slice(0, 4);
      const dedup = new Map<string, SpeechSynthesisVoice>();
      for (const v of [...viVoices, ...otherVoices]) {
        if (!dedup.has(v.voiceURI)) dedup.set(v.voiceURI, v);
      }
      setDeviceVoices(Array.from(dedup.values()).slice(0, 6));
    };
    loadDeviceVoices();
    window.speechSynthesis.onvoiceschanged = loadDeviceVoices;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  const activeDefaultVoice = defaultVoice || DEFAULT_GLOBAL_VOICE;
  const unifiedFonts = useMemo(() => buildUnifiedFontCatalog(customFonts), [customFonts]);

  const toggleFontExpand = (fontId: string) => {
    setExpandedFontIds((prev) => ({ ...prev, [fontId]: !prev[fontId] }));
  };

  const toggleVoiceExpand = (voiceKey: string) => {
    setExpandedVoiceIds((prev) => ({ ...prev, [voiceKey]: !prev[voiceKey] }));
  };

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

  // Import original audio file directly into the Voice Builder so user can tune all options BEFORE saving
  const handleImportVoiceIntoBuilder = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setStudioFeedback('');
    setIsAnalyzingBuilderVoice(true);
    try {
      const file = files[0];
      const tempAsset = await createExternalVoiceFromFile(file);
      // 100% on-device Web Audio DSP hardware analysis (works offline on phones)
      let profile: OnDeviceVoiceProfile = await analyzeVoiceSampleOnDevice(
        tempAsset.dataUrl,
        tempAsset.fileName
      );

      if (!standaloneDeviceMode) {
        try {
          const [, b64] = tempAsset.dataUrl.split(',');
          const resp = await fetch(resolveApiUrl('/api/ai/analyze-voice-sample'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              audioBase64: b64,
              mimeType: tempAsset.mimeType,
              fileName: tempAsset.fileName,
            }),
          });
          if (resp.ok) {
            const serverProfile = await resp.json();
            if (serverProfile?.recommendedBaseVoice) {
              profile = { ...profile, ...serverProfile };
            }
          }
        } catch {
          // Keep on-device DSP result cleanly
        }
      }

      setBuilderImportedVoice({
        fileName: tempAsset.fileName,
        mimeType: tempAsset.mimeType,
        dataUrl: tempAsset.dataUrl,
        durationSec: profile.durationSec,
        analyzedProfile: profile,
      });
      setStudioName(`${tempAsset.name} (Tinh chỉnh)`);
      setBaseGeminiVoice(profile.recommendedBaseVoice);
      setTone((prev) => ({
        ...prev,
        pitch: profile.pitchHint,
        rate: profile.rateHint,
        styleDirection: profile.stylePrompt || prev.styleDirection,
      }));
      triggerDeviceHaptic('success', true);
      setStudioFeedback(
        `Đã nạp File voice gốc import "${tempAsset.fileName}". Hãy kéo thanh EQ / Cao độ / Tốc độ, nghe thử rồi bấm "Lưu thành Voice mới".`
      );
    } catch (err) {
      setStudioFeedback(
        err instanceof Error ? err.message : 'Không thể đọc tệp voice gốc từ máy.'
      );
    } finally {
      setIsAnalyzingBuilderVoice(false);
      if (builderVoiceInputRef.current) builderVoiceInputRef.current.value = '';
    }
  };

  const stopAnyPreview = () => {
    getPlayer().stop();
    stopOnDeviceSpeech();
    setPlayingVoiceId(null);
  };

  const togglePreviewVoice = async (voice: ExternalVoiceAsset) => {
    // Synchronous audio unlock inside user tap gesture before any await
    unlockAudioPlaybackSync();
    setVoicePreviewNotice('');
    const key = `external:${voice.id}`;
    if (playingVoiceId === key) {
      stopAnyPreview();
      return;
    }
    stopAnyPreview();
    setPlayingVoiceId(key);
    try {
      if (voice.dataUrl) {
        await getPlayer().play(voice.dataUrl, voice.toneSettings || DEFAULT_VOICE_TONE, 1.0);
      } else {
        const ok = await speakOnDevice({
          text: sampleText,
          lang: 'vi-VN',
          pitch: voice.toneSettings?.pitch ?? 1.0,
          rate: voice.toneSettings?.rate ?? 1.0,
        });
        if (!ok) {
          const baseVoice = voice.analyzedProfile?.recommendedBaseVoice || 'Kore';
          const pack = await installOfflineVoicePack(baseVoice);
          await getPlayer().play(
            pack.calibrationWavBase64,
            voice.toneSettings || DEFAULT_VOICE_TONE,
            1.0
          );
          setVoicePreviewNotice('Đang phát mẫu âm sắc nội bộ cho cấu hình giọng đã import.');
        }
      }
    } catch (err) {
      setVoicePreviewNotice(err instanceof Error ? err.message : 'Không thể phát thử âm thanh.');
    } finally {
      setPlayingVoiceId((curr) => (curr === key ? null : curr));
    }
  };

  const togglePreviewBuiltinVoice = async (voiceName: GeminiVoiceName) => {
    // Synchronous audio unlock inside user tap gesture before any await
    unlockAudioPlaybackSync();
    setVoicePreviewNotice('');
    const key = `gemini:${voiceName}`;
    if (playingVoiceId === key) {
      stopAnyPreview();
      return;
    }
    stopAnyPreview();
    setPlayingVoiceId(key);
    try {
      const presetTone = getOnDeviceVoiceTone(voiceName);
      if (!standaloneDeviceMode) {
        try {
          const resp = await fetch(resolveApiUrl('/api/ai/tts'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: sampleText,
              voiceName,
              stylePrompt: 'Tự nhiên, rõ ràng, truyền cảm',
              expressive: true,
            }),
          });
          const data = await resp.json().catch(() => ({}));
          if (resp.ok && data.audioBase64) {
            const dataUrl = `data:${data.mimeType || 'audio/wav'};base64,${data.audioBase64}`;
            await getPlayer().play(dataUrl, DEFAULT_VOICE_TONE, 1.0);
            return;
          }
        } catch {
          // Fall through seamlessly to on-device speech
        }
      }
      const spoke = await speakOnDevice({
        text: sampleText,
        lang: 'vi-VN',
        pitch: presetTone.pitch,
        rate: presetTone.rate,
        preferGender: presetTone.preferGender,
      });
      if (!spoke) {
        const pack = await installOfflineVoicePack(voiceName);
        await getPlayer().play(
          pack.calibrationWavBase64,
          {
            warmthDb: pack.phonemeProfile.warmthDb,
            clarityDb: pack.phonemeProfile.clarityDb,
            pitch: presetTone.pitch,
            rate: presetTone.rate,
            styleDirection: pack.displayName,
          },
          1.0
        );
        setVoicePreviewNotice(
          `Đã phát âm sắc mẫu offline (${pack.displayName}). Để đọc toàn văn trên trình duyệt web không có TTS, hãy mở bằng app APK Android.`
        );
      }
    } catch (err) {
      setVoicePreviewNotice(err instanceof Error ? err.message : 'Không thể phát thử âm thanh.');
    } finally {
      setPlayingVoiceId((curr) => (curr === key ? null : curr));
    }
  };

  const togglePreviewDeviceVoice = async (voice: SpeechSynthesisVoice) => {
    unlockAudioPlaybackSync();
    setVoicePreviewNotice('');
    const key = `browser:${voice.voiceURI}`;
    if (playingVoiceId === key) {
      stopAnyPreview();
      return;
    }
    stopAnyPreview();
    setPlayingVoiceId(key);
    try {
      const ok = await speakOnDevice({
        text: sampleText,
        lang: voice.lang || 'vi-VN',
        voiceURI: voice.voiceURI,
        pitch: 1.0,
        rate: 1.0,
      });
      if (!ok) {
        setVoicePreviewNotice('Trình duyệt không phản hồi bộ đọc TTS mặc định của hệ điều hành.');
      }
    } finally {
      setPlayingVoiceId((curr) => (curr === key ? null : curr));
    }
  };

  const handleTestStudioEq = async () => {
    unlockAudioPlaybackSync();
    const player = getPlayer();
    if (isTestingEq) {
      player.stop();
      stopOnDeviceSpeech();
      setIsTestingEq(false);
      return;
    }
    setStudioFeedback('');
    setIsTestingEq(true);
    try {
      if (builderImportedVoice?.dataUrl) {
        await player.play(builderImportedVoice.dataUrl, tone, 1.0);
        return;
      }

      if (!standaloneDeviceMode) {
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
            const dataUrl = `data:${data.mimeType || 'audio/wav'};base64,${data.audioBase64}`;
            await player.play(dataUrl, tone, 1.0);
            return;
          }
        } catch {
          // Fall through cleanly to on-device TTS
        }
      }

      const presetTone = getOnDeviceVoiceTone(baseGeminiVoice);
      const ok = await speakOnDevice({
        text: sampleText,
        lang: 'vi-VN',
        pitch: tone.pitch,
        rate: tone.rate,
        preferGender: presetTone.preferGender,
      });
      if (!ok) {
        const pack = await installOfflineVoicePack(baseGeminiVoice);
        await player.play(pack.calibrationWavBase64, tone, 1.0);
        setStudioFeedback(
          'Đang phát thử âm sắc EQ qua gói giọng nội bộ.'
        );
      }
    } catch (err) {
      setStudioFeedback(err instanceof Error ? err.message : 'Không thể phát thử âm thanh.');
    } finally {
      setIsTestingEq(false);
    }
  };

  const handleSaveStudioVoice = async () => {
    setStudioFeedback('');
    setIsSavingVoice(true);
    try {
      const hasImportedSource = Boolean(builderImportedVoice?.dataUrl);
      let dataUrl = builderImportedVoice?.dataUrl || '';
      let fileName = builderImportedVoice
        ? builderImportedVoice.fileName
        : `${baseGeminiVoice.toLowerCase()}-studio-profile.wav`;
      let mimeType = builderImportedVoice?.mimeType || 'audio/wav';

      if (!hasImportedSource && !standaloneDeviceMode) {
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
            mimeType = data.mimeType || 'audio/wav';
          }
        } catch {
          // Save tone profile even without server audio synthesis
        }
      }

      const eqSummary = `Ấm trầm ${tone.warmthDb >= 0 ? '+' : ''}${tone.warmthDb}dB · Sáng rõ ${tone.clarityDb >= 0 ? '+' : ''}${tone.clarityDb}dB · Cao độ ${tone.pitch.toFixed(2)} · Tốc độ ${tone.rate.toFixed(2)}x`;

      const newVoice: ExternalVoiceAsset = {
        id: `voice-${hasImportedSource ? 'import' : 'studio'}-${Date.now()}`,
        name: studioName.trim() || (hasImportedSource ? 'Voice tinh chỉnh từ file import' : 'Giọng Studio Tùy Chỉnh'),
        fileName,
        mimeType,
        dataUrl,
        durationSec: builderImportedVoice?.durationSec,
        originType: hasImportedSource ? 'imported' : 'studio',
        originLabel: hasImportedSource ? 'File voice gốc import' : 'Giọng chế tác Studio',
        toneSettings: { ...tone },
        analyzedProfile: {
          description: hasImportedSource
            ? `File voice gốc import (${fileName}) đã tinh chỉnh EQ (${eqSummary}).`
            : `Giọng tạo từ Studio (${eqSummary}).`,
          stylePrompt: tone.styleDirection,
          recommendedBaseVoice: baseGeminiVoice,
          pitchHint: tone.pitch,
          rateHint: tone.rate,
        },
        addedAt: Date.now(),
      };

      await onAddExternalVoice(newVoice);
      setBuilderImportedVoice(null);
      triggerDeviceHaptic('success', true);
      setStudioFeedback(
        hasImportedSource
          ? `Đã lưu giọng "${newVoice.name}" (từ File voice gốc import) với cấu hình EQ mới vào thư viện!`
          : `Đã lưu giọng "${newVoice.name}" vào thư viện Studio để gán cho mọi nhân vật!`
      );
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
    <main className="w-full max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pt-3.5 pb-4 sm:pt-5 sm:pb-6 space-y-4 sm:space-y-6 overflow-x-clip">

      {/* Studio Voice Equalizer & Custom Profile Builder */}
      <section
        aria-label="Phòng chỉnh giọng đọc và âm sắc"
        className="border border-stone-200 dark:border-stone-800 rounded-2xl bg-white dark:bg-[#16181C] p-3.5 sm:p-5 space-y-3.5 min-w-0 overflow-hidden"
      >
        <div className="space-y-2.5 min-w-0">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center justify-between gap-2 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <Sliders className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400 shrink-0" />
                <h2 className="text-[13px] font-semibold text-stone-900 dark:text-stone-100 truncate">
                  Chế tác Giọng Đọc
                </h2>
              </div>
              <button
                type="button"
                onClick={() => toggleDisclosure('builder-help')}
                aria-expanded={activeDisclosure === 'builder-help'}
                aria-label="Xem mô tả chế tác giọng đọc"
                className="p-1 rounded-full text-stone-500 hover:text-stone-900 dark:hover:text-white shrink-0"
              >
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform ${
                    activeDisclosure === 'builder-help' ? 'rotate-180' : ''
                  }`}
                />
              </button>
            </div>
            {activeDisclosure === 'builder-help' && (
              <p className="text-[11px] leading-snug text-stone-500">
                Chọn mẫu âm sắc có sẵn hoặc kéo thanh Equalizer để tạo bộ giọng mới dùng cho sách nói.
              </p>
            )}
          </div>

          <div>
            <label className="block text-[10.5px] font-medium text-stone-500 mb-1">
              Mẫu âm sắc sẵn có
            </label>
            <GlassSelect
              ariaLabel="Chọn mẫu âm sắc"
              title="Mẫu âm sắc sẵn có"
              value={selectedPresetId}
              onChange={(val) => {
                const preset = VOICE_TONE_PRESETS.find((p) => p.id === val);
                if (!preset) return;
                setSelectedPresetId(preset.id);
                setTone({ ...preset.tone });
                setStudioName(preset.label);
              }}
              options={VOICE_TONE_PRESETS.map((preset) => ({
                value: preset.id,
                label: preset.label,
              }))}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start min-w-0">
          <div className="lg:col-span-6 space-y-3 min-w-0">
            {/* Step 1: Optional Import Original Voice File BEFORE Adjusting & Saving */}
            <div className="p-3 rounded-xl border border-dashed border-amber-800/40 dark:border-amber-500/35 bg-amber-50/45 dark:bg-amber-950/15 space-y-2 min-w-0">
              <div className="space-y-0.5 min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-900 dark:text-stone-100">
                  <FileAudio className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400 shrink-0" />
                  <span>Bước 1 · Import voice gốc để tinh chỉnh (tùy chọn)</span>
                </div>
                <p className="text-[10px] text-stone-600 dark:text-stone-400 leading-snug">
                  Chọn file .MP3/.WAV/.M4A từ máy, chỉnh EQ rồi bấm Lưu thành Voice mới.
                </p>
              </div>
              <input
                ref={builderVoiceInputRef}
                type="file"
                accept="audio/*,.mp3,.wav,.ogg,.m4a"
                className="hidden"
                onChange={(e) => handleImportVoiceIntoBuilder(e.target.files)}
              />
              <button
                type="button"
                disabled={isAnalyzingBuilderVoice}
                onClick={() => builderVoiceInputRef.current?.click()}
                className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-xs font-semibold hover:opacity-90 disabled:opacity-50 min-h-[42px]"
              >
                {isAnalyzingBuilderVoice ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Upload className="w-3.5 h-3.5" />
                )}
                <span>
                  {builderImportedVoice ? 'Đổi file voice gốc' : 'Import voice mới vào'}
                </span>
              </button>

              {builderImportedVoice && (
                <div className="p-2.5 rounded-lg bg-white/90 dark:bg-stone-900/90 border border-amber-700/30 flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-800 text-white text-[10px] font-semibold">
                        File voice gốc import
                      </span>
                      <span className="text-xs font-semibold text-stone-900 dark:text-stone-100 truncate">
                        {builderImportedVoice.fileName}
                      </span>
                    </div>
                    <p className="text-[11px] text-stone-600 dark:text-stone-400 leading-snug">
                      {builderImportedVoice.analyzedProfile.description}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setBuilderImportedVoice(null)}
                    aria-label="Gỡ file voice gốc khỏi bộ chế tác"
                    className="p-1 rounded-md text-stone-400 hover:text-red-600 shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

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
                <GlassSelect<GeminiVoiceName>
                  ariaLabel="Chọn chất giọng AI nền"
                  title="Chất giọng AI nền"
                  value={baseGeminiVoice}
                  onChange={setBaseGeminiVoice}
                  options={GEMINI_VOICES.map((gv) => ({
                    value: gv.name,
                    label: gv.label,
                    subtitle: gv.tone,
                  }))}
                />
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

          <div className="lg:col-span-6 space-y-4 bg-stone-50 dark:bg-stone-900/50 p-4 rounded-xl border border-stone-200 dark:border-stone-800 min-w-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 min-w-0">
              <label className="block space-y-1.5 min-w-0">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium">Độ ấm trầm (Bass)</span>
                  <span className="tabular-nums text-amber-800 dark:text-amber-400 font-semibold shrink-0">
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
                  className="block w-full min-w-0 accent-amber-800 h-2"
                />
              </label>

              <label className="block space-y-1.5 min-w-0">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium">Độ sáng rõ (Clarity)</span>
                  <span className="tabular-nums text-amber-800 dark:text-amber-400 font-semibold shrink-0">
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
                  className="block w-full min-w-0 accent-amber-800 h-2"
                />
              </label>

              <label className="block space-y-1.5 min-w-0">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium">Cao độ (Pitch)</span>
                  <span className="tabular-nums font-semibold shrink-0">{tone.pitch.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  aria-label="Cao độ giọng"
                  min={0.7}
                  max={1.4}
                  step={0.05}
                  value={tone.pitch}
                  onChange={(e) => setTone((t) => ({ ...t, pitch: Number(e.target.value) }))}
                  className="block w-full min-w-0 accent-amber-800 h-2"
                />
              </label>

              <div className="block space-y-1.5 min-w-0">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium">Nhịp đọc (Tốc độ)</span>
                  <div className="inline-flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        setTone((t) => ({ ...t, rate: stepReadingSpeed(t.rate, -1) }))
                      }
                      aria-label="Giảm tốc độ giọng 0.1"
                      className="w-6 h-6 rounded-md border border-stone-300 dark:border-stone-700 text-xs font-semibold flex items-center justify-center hover:border-amber-700"
                    >
                      −
                    </button>
                    <div className="inline-flex items-center rounded-md border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-1.5 h-6">
                      <input
                        type="number"
                        inputMode="decimal"
                        aria-label="Nhập tốc độ đọc giọng Studio"
                        min={MIN_READING_SPEED}
                        max={MAX_READING_SPEED}
                        step={READING_SPEED_STEP}
                        value={tone.rate}
                        onChange={(e) => {
                          const num = Number(e.target.value.replace(',', '.'));
                          if (Number.isFinite(num)) {
                            setTone((t) => ({
                              ...t,
                              rate: Math.min(MAX_READING_SPEED, Math.max(MIN_READING_SPEED, Math.round(num * 10) / 10)),
                            }));
                          }
                        }}
                        onBlur={(e) =>
                          setTone((t) => ({
                            ...t,
                            rate: normalizeReadingSpeed(e.target.value, t.rate),
                          }))
                        }
                        className="w-11 text-center text-[11px] font-semibold tabular-nums bg-transparent focus:outline-none"
                      />
                      <span className="text-[10px] text-stone-500">x</span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setTone((t) => ({ ...t, rate: stepReadingSpeed(t.rate, 1) }))
                      }
                      aria-label="Tăng tốc độ giọng 0.1"
                      className="w-6 h-6 rounded-md border border-stone-300 dark:border-stone-700 text-xs font-semibold flex items-center justify-center hover:border-amber-700"
                    >
                      +
                    </button>
                  </div>
                </div>
                <input
                  type="range"
                  aria-label="Nhịp đọc giọng"
                  min={MIN_READING_SPEED}
                  max={MAX_READING_SPEED}
                  step={READING_SPEED_STEP}
                  value={tone.rate}
                  onChange={(e) =>
                    setTone((t) => ({ ...t, rate: normalizeReadingSpeed(e.target.value, t.rate) }))
                  }
                  className="block w-full min-w-0 accent-amber-800 h-2"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
              <button
                type="button"
                onClick={handleTestStudioEq}
                className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-xs font-medium hover:bg-stone-100 dark:hover:bg-stone-800 min-h-[44px]"
              >
                {isTestingEq ? (
                  <>
                    <Square className="w-3.5 h-3.5 text-red-600 shrink-0" />
                    <span>Dừng nghe thử</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400 shrink-0" />
                    <span>Nghe thử bộ lọc EQ</span>
                  </>
                )}
              </button>

              <button
                type="button"
                disabled={isSavingVoice}
                onClick={handleSaveStudioVoice}
                className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-amber-800 text-white text-xs font-semibold hover:bg-amber-900 disabled:opacity-50 min-h-[44px]"
              >
                {isSavingVoice ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                ) : (
                  <Plus className="w-3.5 h-3.5 shrink-0" />
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 min-w-0">
        {/* Unified All Voices Section (Global Default Reading Voice) */}
        <section className="ios-floating-shadow border border-stone-200 dark:border-stone-800 rounded-2xl bg-white dark:bg-[#16181C] p-3.5 sm:p-4 space-y-2.5 min-w-0 overflow-hidden">
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <Volume2 className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400 shrink-0" />
                <h2 className="text-[13px] font-semibold truncate">Tất cả Voice</h2>
                <button
                  type="button"
                  onClick={() => toggleDisclosure('voice-help')}
                  aria-expanded={activeDisclosure === 'voice-help'}
                  aria-label="Xem mô tả Tất cả Voice"
                  className="p-1 rounded-full text-stone-500 hover:text-stone-900 dark:hover:text-white shrink-0"
                >
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform ${
                      activeDisclosure === 'voice-help' ? 'rotate-180' : ''
                    }`}
                  />
                </button>
              </div>
              <span className="text-[10.5px] font-medium text-stone-500 tabular-nums shrink-0">
                {externalVoices.length + GEMINI_VOICES.length + deviceVoices.length} giọng
              </span>
            </div>
            {activeDisclosure === 'voice-help' && (
              <p className="text-[11px] leading-snug text-stone-500">
                Chọn 1 giọng đọc mặc định cho toàn bộ sách. Để tải các gói giọng Offline, hãy mở mục Gói giọng đọc trong Cài đặt.
              </p>
            )}

            {voicePreviewNotice && (
              <div className="text-[11px] text-amber-800 dark:text-amber-300 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-700/25 rounded-lg px-2.5 py-1.5 leading-snug">
                {voicePreviewNotice}
              </div>
            )}
          </div>

          {/* Single Unified Scrollable Compact List: Imported/Studio + Built-in AI + Device Voices */}
          <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-0.5 min-w-0">
            {externalVoices.map((voice) => {
              const key = `external:${voice.id}`;
              const isSelected = activeDefaultVoice.id === key;
              const isExpanded = Boolean(expandedVoiceIds[key]);
              const vTone = voice.toneSettings || DEFAULT_VOICE_TONE;
              return (
                <div
                  key={key}
                  className={`perf-list-item rounded-xl border transition-colors overflow-hidden ${
                    isSelected
                      ? 'border-amber-700 bg-amber-50/60 dark:bg-amber-950/25 dark:border-amber-500'
                      : 'border-stone-200 dark:border-stone-800 bg-stone-50/40 dark:bg-stone-900/30'
                  }`}
                >
                  <div className="px-2.5 py-1.5 flex items-center justify-between gap-1.5 min-w-0">
                    <LongPressNameLabel
                      text={voice.name}
                      onLongPress={() =>
                        setLongPressTarget({
                          kind: 'external-voice',
                          id: key,
                          name: voice.name,
                          subtitle: voice.fileName,
                          canDelete: true,
                          externalVoice: voice,
                        })
                      }
                      className="text-[11.5px] font-semibold leading-snug text-stone-900 dark:text-stone-100 truncate min-w-0 flex-1"
                    />
                    <div className="flex items-center gap-0.5 shrink-0">
                      {onSelectDefaultVoice && (
                        <button
                          type="button"
                          onClick={() =>
                            onSelectDefaultVoice({
                              source: 'external',
                              id: key,
                              label: voice.name,
                              externalVoiceId: voice.id,
                              geminiVoice: voice.analyzedProfile?.recommendedBaseVoice || 'Kore',
                            })
                          }
                          aria-label={isSelected ? `Đang chọn ${voice.name}` : `Chọn mặc định ${voice.name}`}
                          title={isSelected ? 'Đang chọn mặc định' : 'Đặt làm mặc định'}
                          className={`touch-manipulation w-7 h-7 rounded-lg inline-flex items-center justify-center transition-transform active:scale-90 shrink-0 ${
                            isSelected
                              ? 'bg-amber-800 text-white shadow-xs'
                              : 'bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-400 dark:text-stone-500 hover:text-amber-800 hover:border-amber-700'
                          }`}
                        >
                          <Check className="w-3.5 h-3.5 shrink-0" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePreviewVoice(voice);
                        }}
                        aria-label={`Nghe thử ${voice.name}`}
                        title={playingVoiceId === key ? 'Dừng nghe thử' : 'Nghe thử giọng'}
                        className="touch-manipulation w-7 h-7 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 inline-flex items-center justify-center text-stone-700 dark:text-stone-200 hover:text-amber-800 active:scale-90 transition-transform shrink-0"
                      >
                        {playingVoiceId === key ? (
                          <Square className="w-3 h-3 text-red-600 fill-red-600 shrink-0" />
                        ) : (
                          <Play className="w-3 h-3 fill-current shrink-0 ml-0.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleVoiceExpand(key);
                        }}
                        aria-expanded={isExpanded}
                        aria-label={`Xem chi tiết voice ${voice.name}`}
                        className="touch-manipulation w-7 h-7 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 flex items-center justify-center text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white active:scale-90 transition-transform shrink-0"
                      >
                        {isExpanded ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-3 pb-3 pt-2 border-t border-stone-200/70 dark:border-stone-800/80 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-300">
                          {voice.originLabel ||
                            (voice.originType === 'studio'
                              ? 'Giọng chế tác Studio'
                              : 'File voice gốc import')}
                        </span>
                        <TwoTapDeleteButton
                          variant="pill"
                          label="Xóa voice"
                          confirmLabel="Xác nhận xóa?"
                          onConfirmDelete={() => onDeleteExternalVoice(voice.id)}
                        />
                      </div>
                      <div className="text-[11px] text-stone-500 truncate">
                        {voice.fileName}
                        {voice.durationSec ? ` · ${voice.durationSec}s` : ''}
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-[11px]">
                        <label className="space-y-1 min-w-0">
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
                            className="block w-full min-w-0 accent-amber-800"
                          />
                        </label>
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-stone-500">Tốc độ</span>
                            <div className="inline-flex items-center rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-1 h-5">
                              <input
                                type="number"
                                inputMode="decimal"
                                aria-label={`Nhập tốc độ đọc ${voice.name}`}
                                min={MIN_READING_SPEED}
                                max={MAX_READING_SPEED}
                                step={READING_SPEED_STEP}
                                value={vTone.rate}
                                onChange={(e) =>
                                  handleAdjustExistingVoiceTone(voice, {
                                    rate: normalizeReadingSpeed(e.target.value, vTone.rate),
                                  })
                                }
                                className="w-9 text-center text-[10.5px] font-semibold tabular-nums bg-transparent focus:outline-none"
                              />
                              <span className="text-[10px] text-stone-500">x</span>
                            </div>
                          </div>
                          <input
                            type="range"
                            min={MIN_READING_SPEED}
                            max={MAX_READING_SPEED}
                            step={READING_SPEED_STEP}
                            value={vTone.rate}
                            onChange={(e) =>
                              handleAdjustExistingVoiceTone(voice, {
                                rate: normalizeReadingSpeed(e.target.value, vTone.rate),
                              })
                            }
                            className="block w-full min-w-0 accent-amber-800"
                          />
                        </div>
                      </div>
                      {voice.analyzedProfile && (
                        <div className="text-[11px] text-stone-600 dark:text-stone-400 space-y-1">
                          <div className="flex items-center gap-1 font-medium text-amber-800 dark:text-amber-400">
                            <Sparkles className="w-3 h-3 shrink-0" />
                            <span>
                              Giọng nền {voice.analyzedProfile.recommendedBaseVoice} · Cao độ{' '}
                              {voice.analyzedProfile.pitchHint}
                            </span>
                          </div>
                          <p className="leading-relaxed">{voice.analyzedProfile.description}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {GEMINI_VOICES.map((gv) => {
              const key = `gemini:${gv.name}`;
              const displayLabel = voiceAliases[key] || gv.label;
              const isSelected = activeDefaultVoice.id === key;
              const isExpanded = Boolean(expandedVoiceIds[key]);
              return (
                <div
                  key={key}
                  className={`perf-list-item rounded-xl border transition-colors overflow-hidden ${
                    isSelected
                      ? 'border-amber-700 bg-amber-50/60 dark:bg-amber-950/25 dark:border-amber-500'
                      : 'border-stone-200 dark:border-stone-800 bg-stone-50/40 dark:bg-stone-900/30'
                  }`}
                >
                  <div className="px-2.5 py-1.5 flex items-center justify-between gap-1.5 min-w-0">
                    <LongPressNameLabel
                      text={displayLabel}
                      onLongPress={() =>
                        setLongPressTarget({
                          kind: 'gemini-voice',
                          id: key,
                          name: displayLabel,
                          subtitle: `Voice Google AI gốc · ${gv.name}`,
                          canDelete: false,
                        })
                      }
                      className="text-[11.5px] font-semibold leading-snug text-stone-900 dark:text-stone-100 truncate min-w-0 flex-1"
                    />
                    <div className="flex items-center gap-0.5 shrink-0">
                      {onSelectDefaultVoice && (
                        <button
                          type="button"
                          onClick={() =>
                            onSelectDefaultVoice({
                              source: 'gemini',
                              id: key,
                              label: displayLabel,
                              geminiVoice: gv.name,
                            })
                          }
                          aria-label={isSelected ? `Đang chọn ${displayLabel}` : `Chọn mặc định ${displayLabel}`}
                          title={isSelected ? 'Đang chọn mặc định' : 'Đặt làm mặc định'}
                          className={`touch-manipulation w-7 h-7 rounded-lg inline-flex items-center justify-center transition-transform active:scale-90 shrink-0 ${
                            isSelected
                              ? 'bg-amber-800 text-white shadow-xs'
                              : 'bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-400 dark:text-stone-500 hover:text-amber-800 hover:border-amber-700'
                          }`}
                        >
                          <Check className="w-3.5 h-3.5 shrink-0" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePreviewBuiltinVoice(gv.name);
                        }}
                        aria-label={`Nghe thử ${gv.label}`}
                        title={playingVoiceId === key ? 'Dừng nghe thử' : 'Nghe thử giọng'}
                        className="touch-manipulation w-7 h-7 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 inline-flex items-center justify-center text-stone-800 dark:text-stone-100 hover:text-amber-800 active:scale-90 transition-transform shrink-0"
                      >
                        {playingVoiceId === key ? (
                          <Square className="w-3 h-3 text-red-600 fill-red-600 shrink-0" />
                        ) : (
                          <Play className="w-3 h-3 fill-current shrink-0 ml-0.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleVoiceExpand(key);
                        }}
                        aria-expanded={isExpanded}
                        aria-label={`Xem mô tả voice ${gv.label}`}
                        className="touch-manipulation w-7 h-7 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 flex items-center justify-center text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white active:scale-90 transition-transform shrink-0"
                      >
                        {isExpanded ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-3 pb-2.5 pt-2 border-t border-stone-200/70 dark:border-stone-800/80 space-y-1">
                      <span className="inline-flex text-[10px] font-medium px-2 py-0.5 rounded-md bg-stone-200/80 dark:bg-stone-800 text-stone-700 dark:text-stone-300">
                        {gv.isDefault ? 'Giọng AI mặc định hệ thống' : 'Giọng AI có sẵn'} · {gv.name}
                      </span>
                      <p className="text-[11px] leading-snug text-stone-600 dark:text-stone-400">
                        {gv.tone}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}

            {deviceVoices.map((dv) => {
              const key = `browser:${dv.voiceURI}`;
              const displayLabel = voiceAliases[key] || dv.name;
              const isSelected = activeDefaultVoice.id === key;
              const isExpanded = Boolean(expandedVoiceIds[key]);
              return (
                <div
                  key={key}
                  className={`perf-list-item rounded-xl border transition-colors overflow-hidden ${
                    isSelected
                      ? 'border-amber-700 bg-amber-50/60 dark:bg-amber-950/25 dark:border-amber-500'
                      : 'border-stone-200 dark:border-stone-800 bg-stone-50/40 dark:bg-stone-900/30'
                  }`}
                >
                  <div className="px-2.5 py-1.5 flex items-center justify-between gap-1.5 min-w-0">
                    <LongPressNameLabel
                      text={displayLabel}
                      onLongPress={() =>
                        setLongPressTarget({
                          kind: 'device-voice',
                          id: key,
                          name: displayLabel,
                          subtitle: `Giọng thiết bị gốc · ${dv.lang}`,
                          canDelete: false,
                        })
                      }
                      className="text-[11.5px] font-semibold leading-snug text-stone-900 dark:text-stone-100 truncate min-w-0 flex-1"
                    />
                    <div className="flex items-center gap-0.5 shrink-0">
                      {onSelectDefaultVoice && (
                        <button
                          type="button"
                          onClick={() =>
                            onSelectDefaultVoice({
                              source: 'browser',
                              id: key,
                              label: displayLabel,
                              browserVoiceURI: dv.voiceURI,
                            })
                          }
                          aria-label={isSelected ? `Đang chọn ${displayLabel}` : `Chọn mặc định ${displayLabel}`}
                          title={isSelected ? 'Đang chọn mặc định' : 'Đặt làm mặc định'}
                          className={`touch-manipulation w-7 h-7 rounded-lg inline-flex items-center justify-center transition-transform active:scale-90 shrink-0 ${
                            isSelected
                              ? 'bg-amber-800 text-white shadow-xs'
                              : 'bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-400 dark:text-stone-500 hover:text-amber-800 hover:border-amber-700'
                          }`}
                        >
                          <Check className="w-3.5 h-3.5 shrink-0" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePreviewDeviceVoice(dv);
                        }}
                        aria-label={`Nghe thử ${dv.name}`}
                        title={playingVoiceId === key ? 'Dừng nghe thử' : 'Nghe thử giọng'}
                        className="touch-manipulation w-7 h-7 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 inline-flex items-center justify-center text-stone-700 dark:text-stone-200 hover:text-amber-800 active:scale-90 transition-transform shrink-0"
                      >
                        {playingVoiceId === key ? (
                          <Square className="w-3 h-3 text-red-600 fill-red-600 shrink-0" />
                        ) : (
                          <Play className="w-3 h-3 fill-current shrink-0 ml-0.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleVoiceExpand(key);
                        }}
                        aria-expanded={isExpanded}
                        aria-label={`Xem mô tả voice ${dv.name}`}
                        className="touch-manipulation w-7 h-7 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 flex items-center justify-center text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white active:scale-90 transition-transform shrink-0"
                      >
                        {isExpanded ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-3 pb-2.5 pt-2 border-t border-stone-200/70 dark:border-stone-800/80 space-y-1">
                      <span className="inline-flex text-[10px] font-medium px-2 py-0.5 rounded-md bg-stone-200/80 dark:bg-stone-800 text-stone-700 dark:text-stone-300">
                        Giọng gốc của máy (Offline) · {dv.lang}
                      </span>
                      <p className="text-[11px] text-stone-600 dark:text-stone-400 leading-relaxed">
                        Giọng đọc tích hợp sẵn trên thiết bị, phát ngay không cần mạng.
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Unified All Fonts Section (Compact Rows) */}
        <section
          id="studio-ereader-fonts"
          className="ios-floating-shadow scroll-mt-20 border border-stone-200 dark:border-stone-800 rounded-2xl bg-white dark:bg-[#16181C] p-3.5 sm:p-4 space-y-2.5 min-w-0 overflow-hidden"
        >
          <div className="space-y-2 min-w-0">
            <div className="space-y-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Type className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400 shrink-0" />
                  <h2 className="text-[13px] font-semibold truncate">Tất cả phông chữ</h2>
                  <button
                    type="button"
                    onClick={() => toggleDisclosure('font-help')}
                    aria-expanded={activeDisclosure === 'font-help'}
                    aria-label="Xem mô tả Tất cả phông chữ"
                    className="p-1 rounded-full text-stone-500 hover:text-stone-900 dark:hover:text-white shrink-0"
                  >
                    <ChevronDown
                      className={`w-3.5 h-3.5 transition-transform ${
                        activeDisclosure === 'font-help' ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                </div>
                <span className="text-[10.5px] font-medium text-stone-500 tabular-nums shrink-0">
                  {unifiedFonts.length} phông
                </span>
              </div>
              {activeDisclosure === 'font-help' && (
                <p className="text-[11px] leading-snug text-stone-500">
                  Gồm phông cộng đồng máy đọc sách, phông gốc của máy và phông .TTF/.OTF/.WOFF bạn import thêm.
                </p>
              )}
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
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-[11px] font-semibold hover:opacity-90 min-h-[34px]"
            >
              <Upload className="w-3.5 h-3.5 shrink-0" />
              <span>Import phông (.TTF/.OTF/.WOFF)</span>
            </button>
          </div>

          {/* Compact Scrollable Font List */}
          <div className="space-y-1.5 max-h-[370px] overflow-y-auto pr-0.5 min-w-0">
            {unifiedFonts.map((font) => {
              const isSelected = activeFontFamily === font.cssValue;
              const isExpanded = Boolean(expandedFontIds[font.id]);
              return (
                <div
                  key={font.id}
                  className={`rounded-xl border transition-colors overflow-hidden ${
                    isSelected
                      ? 'border-amber-700 bg-amber-50/60 dark:bg-amber-950/25 dark:border-amber-500'
                      : 'border-stone-200 dark:border-stone-800 bg-stone-50/40 dark:bg-stone-900/30'
                  }`}
                >
                  <div className="px-2.5 py-1.5 flex items-center justify-between gap-2 min-w-0">
                    <LongPressNameLabel
                      text={
                        font.kind === 'imported'
                          ? font.name
                          : fontAliases[font.id] || font.name
                      }
                      onLongPress={() => {
                        const matchedCustom =
                          font.kind === 'imported' && font.customFontId
                            ? customFonts.find((cf) => cf.id === font.customFontId)
                            : undefined;
                        setLongPressTarget({
                          kind: matchedCustom ? 'custom-font' : 'builtin-font',
                          id: font.id,
                          name:
                            font.kind === 'imported'
                              ? font.name
                              : fontAliases[font.id] || font.name,
                          subtitle: font.origin,
                          canDelete: Boolean(matchedCustom),
                          customFont: matchedCustom,
                        });
                      }}
                      style={{ fontFamily: font.cssValue }}
                      className="text-[12px] font-semibold leading-snug text-stone-900 dark:text-stone-100 truncate min-w-0 flex-1"
                    />

                    <div className="flex items-center gap-1 shrink-0">
                      {onSelectFontFamily && (
                        <button
                          type="button"
                          onClick={() => onSelectFontFamily(font.cssValue)}
                          className={`touch-manipulation inline-flex items-center gap-1 px-2.5 min-h-[28px] rounded-lg text-[10.5px] font-semibold transition-colors whitespace-nowrap ${
                            isSelected
                              ? 'bg-amber-800 text-white'
                              : 'bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-700 text-stone-800 dark:text-stone-200 hover:border-amber-700'
                          }`}
                        >
                          {isSelected ? (
                            <>
                              <Check className="w-2.5 h-2.5 shrink-0" />
                              <span>Đang dùng</span>
                            </>
                          ) : (
                            <span>Dùng</span>
                          )}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFontExpand(font.id);
                        }}
                        aria-expanded={isExpanded}
                        aria-label={`Xem mô tả phông ${font.name}`}
                        className="touch-manipulation w-7 min-h-[28px] rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 flex items-center justify-center text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white active:scale-95 shrink-0"
                      >
                        {isExpanded ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-3 pb-3 pt-2 border-t border-stone-200/70 dark:border-stone-800/80 space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-stone-200/80 dark:bg-stone-800 text-stone-700 dark:text-stone-300">
                          {font.origin}
                        </span>
                        {font.kind === 'imported' && font.customFontId && (
                          <TwoTapDeleteButton
                            variant="pill"
                            label="Xóa phông"
                            confirmLabel="Xác nhận xóa?"
                            onConfirmDelete={() => onDeleteCustomFont(font.customFontId!)}
                          />
                        )}
                      </div>
                      <p className="text-[11px] text-stone-600 dark:text-stone-400 leading-relaxed">
                        {font.description}
                      </p>
                      <p
                        style={{ fontFamily: font.cssValue }}
                        className="text-[14px] leading-relaxed text-stone-800 dark:text-stone-200 pt-1.5 border-t border-stone-200/60 dark:border-stone-800/60"
                      >
                        {font.sample}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Ambient Sound & Chill Music Mixer Section */}
      <section
        aria-label="Kho âm thanh nền và nhạc chill khi đọc nghe"
        className="border border-stone-200 dark:border-stone-800 rounded-2xl bg-white dark:bg-[#16181C] p-3.5 sm:p-5 space-y-3 min-w-0 overflow-hidden"
      >
        <div className="space-y-1 min-w-0">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <Music className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400 shrink-0" />
              <h2 className="text-[13px] font-display font-semibold text-stone-900 dark:text-stone-100 truncate">
                Âm thanh nền &amp; Nhạc Chill (20+)
              </h2>
            </div>
            <button
              type="button"
              onClick={() => toggleDisclosure('ambient-help')}
              aria-expanded={activeDisclosure === 'ambient-help'}
              aria-label="Xem mô tả Âm thanh nền"
              className="p-1 rounded-full text-stone-500 hover:text-stone-900 dark:hover:text-white shrink-0"
            >
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform ${
                  activeDisclosure === 'ambient-help' ? 'rotate-180' : ''
                }`}
              />
            </button>
          </div>
          {activeDisclosure === 'ambient-help' && (
            <p className="text-[11px] leading-snug text-stone-500">
              Chọn tiếng mưa, lửa trại, sóng biển, nhạc lo-fi chill hoặc import file nhạc MP3/WAV từ thiết bị để phát nền cùng lúc.
            </p>
          )}
        </div>

        <AmbientSoundPanel
          customTracks={customAmbientTracks}
          onAddCustomTrack={onAddCustomAmbientTrack}
          onDeleteCustomTrack={onDeleteCustomAmbientTrack}
        />
      </section>

      {/* Long-Press Context Sheet for Voices & Fonts */}
      <LongPressActionSheet
        open={Boolean(longPressTarget)}
        itemName={longPressTarget?.name || ''}
        itemSubtitle={longPressTarget?.subtitle}
        categoryLabel={
          longPressTarget?.kind === 'custom-font' || longPressTarget?.kind === 'builtin-font'
            ? 'Tùy chọn Phông chữ'
            : 'Tùy chọn Voice'
        }
        canDelete={Boolean(longPressTarget?.canDelete)}
        protectedDeleteHint={
          longPressTarget?.kind === 'builtin-font'
            ? 'Phông chữ gốc hệ thống — được phép đổi tên, không được phép xóa.'
            : 'Voice Google AI / hệ thống gốc — được phép đổi tên, không được phép xóa.'
        }
        onClose={() => setLongPressTarget(null)}
        onRename={handleRenameLongPressTarget}
        onDelete={longPressTarget?.canDelete ? handleDeleteLongPressTarget : undefined}
      />
    </main>
  );
};
