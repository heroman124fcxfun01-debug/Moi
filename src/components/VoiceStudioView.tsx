import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Type,
  Upload,
  Volume2,
  Sparkles,
  Loader2,
  Sliders,
  Play,
  Save,
  Square,
  Check,
  Music,
  X,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type {
  BookReadingStyle,
  CustomAmbientTrack,
  CustomFontAsset,
  DefaultVoiceSelection,
  ExternalVoiceAsset,
  GeminiVoiceName,
  SpeakerEmbeddingVector,
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
  normalizeReadingSpeed,
} from '../utils/audioFilterEngine';
import {
  triggerDeviceHaptic,
  type OnDeviceVoiceProfile,
} from '../utils/deviceHardware';
import {
  DEFAULT_GLOBAL_VOICE,
  buildUnifiedFontCatalog,
  hideSystemVoiceKey,
  isProtectedPrimaryVoice,
  loadHiddenSystemVoiceKeys,
} from '../utils/studioCatalog';
import { READING_VOICE_STYLES } from '../utils/onDeviceCharacterAI';
import { AmbientSoundPanel } from './AmbientSoundPanel';
import { GlassSelect } from './GlassSelect';
import { resolveApiUrl } from '../utils/apiClient';
import {
  computeExternalVoiceSpeechParams,
  getOnDeviceVoiceTone,
  speakOnDevice,
  stopOnDeviceSpeech,
  unlockAudioPlaybackSync,
} from '../utils/deviceTtsEngine';
import { installOfflineVoicePack } from '../utils/offlineVoicePacks';
import { useLongPress } from '../hooks/useLongPress';
import { LongPressActionSheet } from './LongPressActionSheet';
import { TwoTapDeleteButton } from './TwoTapDeleteButton';
import {
  buildCompactVoiceProfile,
} from '../utils/voiceProfileEngine';
import {
  loadPronunciationDict,
  savePronunciationDict,
  type PronunciationEntry,
} from '../utils/pronunciationDict';
import {
  resolveClonedVoiceSynthesis,
  runVocalCloningPipeline,
  type VocalPipelineProgress,
} from '../utils/vocalClonerDsp';
import { IosSheet } from './IosSheet';
import { useI18n } from '../contexts/LanguageContext';

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
  cleanVocalSampleUrl?: string;
  speakerEmbedding?: SpeakerEmbeddingVector;
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
  const { strings } = useI18n();
  const fontInputRef = useRef<HTMLInputElement>(null);
  const builderVoiceInputRef = useRef<HTMLInputElement>(null);
  const playerRef = useRef<FilteredAudioPlayer | null>(null);
  const previewRunIdRef = useRef(0);
  const previewAbortRef = useRef<AbortController | null>(null);
  const previewAudioCacheRef = useRef<Map<string, string>>(new Map());
  const previewAiCooldownUntilRef = useRef(0);

  const [isAnalyzingBuilderVoice, setIsAnalyzingBuilderVoice] = useState(false);
  const [cloningProgress, setCloningProgress] = useState<VocalPipelineProgress | null>(null);
  const [builderImportedVoice, setBuilderImportedVoice] =
    useState<BuilderImportedVoiceDraft | null>(null);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);

  // Minimalist Zero-Manual-Tuning Voice Creator State (6 rows + Save Confirmation Dialog)
  const [studioName, setStudioName] = useState('');
  const [studioReadingStyle, setStudioReadingStyle] = useState<BookReadingStyle>('novel');
  const [baseGeminiVoice, setBaseGeminiVoice] = useState<GeminiVoiceName>('Kore');
  const [tone, setTone] = useState<VoiceToneSettings>(() => ({ ...DEFAULT_VOICE_TONE }));
  const [sampleText, setSampleText] = useState(
    'Đêm khuya thanh vắng, từng trang sách mở ra như một hành trình kỳ diệu đưa tâm trí đi xa.'
  );
  const [isTestingEq, setIsTestingEq] = useState(false);
  const [isSavingVoice, setIsSavingVoice] = useState(false);
  const [showSaveConfirmModal, setShowSaveConfirmModal] = useState(false);
  const [studioFeedback, setStudioFeedback] = useState('');
  const [expandedFontIds, setExpandedFontIds] = useState<Record<string, boolean>>({});
  const [expandedVoiceIds, setExpandedVoiceIds] = useState<Record<string, boolean>>({});
  const [deviceVoices, setDeviceVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [hiddenSystemVoices, setHiddenSystemVoices] = useState<string[]>(() =>
    loadHiddenSystemVoiceKeys()
  );
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

  const resetBuilderToEmpty = () => {
    setBuilderImportedVoice(null);
    setStudioName('');
    setStudioReadingStyle('novel');
    setBaseGeminiVoice('Kore');
    setTone({ ...DEFAULT_VOICE_TONE });
  };

  const handleHideSystemVoice = (voiceKey: string) => {
    if (isProtectedPrimaryVoice(voiceKey)) return;
    const updated = hideSystemVoiceKey(voiceKey);
    setHiddenSystemVoices(updated);
    if ((defaultVoice || DEFAULT_GLOBAL_VOICE).id === voiceKey) {
      onSelectDefaultVoice?.(DEFAULT_GLOBAL_VOICE);
    }
  };

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
    } else if (
      longPressTarget.kind === 'gemini-voice' ||
      longPressTarget.kind === 'device-voice'
    ) {
      handleHideSystemVoice(longPressTarget.id);
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
  const visibleGeminiVoices = useMemo(
    () => GEMINI_VOICES.filter((gv) => !hiddenSystemVoices.includes(`gemini:${gv.name}`)),
    [hiddenSystemVoices]
  );
  const visibleDeviceVoices = useMemo(
    () => deviceVoices.filter((dv) => !hiddenSystemVoices.includes(`browser:${dv.voiceURI}`)),
    [deviceVoices, hiddenSystemVoices]
  );

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

  const analyzeImportedVoiceData = async (tempAsset: {
    name: string;
    fileName: string;
    mimeType: string;
    dataUrl: string;
  }) => {
    // Step 1 & 2: Vocal Separation + Denoise + Speaker Embedding Extraction (with live progress bar)
    const dspResult = await runVocalCloningPipeline(
      tempAsset.dataUrl,
      tempAsset.fileName,
      (prog) => setCloningProgress(prog)
    );

    let profile: OnDeviceVoiceProfile = {
      description: dspResult.description,
      stylePrompt: dspResult.stylePrompt,
      recommendedBaseVoice: dspResult.recommendedBaseVoice,
      gender: dspResult.gender,
      pitchHint: dspResult.pitchHint,
      rateHint: dspResult.rateHint,
      warmthDb: dspResult.warmthDb,
      clarityDb: dspResult.clarityDb,
      durationSec: dspResult.durationSec,
      analyzedBy: 'device-dsp',
    };
    let usedGeminiAi = false;

    // Enrich timbre metadata with server-side Gemini AI when online (keeping extracted SpeakerEmbedding intact)
    try {
      const cleanSource = dspResult.cleanVocalSampleUrl || tempAsset.dataUrl;
      const [, b64] = cleanSource.split(',');
      if (b64) {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 12000);
        try {
          const resp = await fetch(resolveApiUrl('/api/ai/analyze-voice-sample'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              audioBase64: b64,
              mimeType: dspResult.cleanVocalSampleUrl ? 'audio/wav' : tempAsset.mimeType,
              fileName: tempAsset.fileName,
            }),
          });
          if (resp.ok) {
            const serverProfile = await resp.json();
            if (serverProfile?.recommendedBaseVoice) {
              profile = {
                ...profile,
                ...serverProfile,
                // Preserve exact DSP gender & F0 pitch hint if server didn't provide stronger data
                gender: serverProfile.gender || dspResult.gender,
                pitchHint:
                  typeof serverProfile.pitchHint === 'number'
                    ? Math.round(((serverProfile.pitchHint + dspResult.pitchHint) / 2) * 100) / 100
                    : dspResult.pitchHint,
                analyzedBy: 'gemini-ai',
              };
              usedGeminiAi = true;
            }
          }
        } finally {
          window.clearTimeout(timer);
        }
      }
    } catch {
      // Offline or server unreachable — keep clean DSP vocal embedding seamlessly
    }

    setBuilderImportedVoice({
      fileName: tempAsset.fileName,
      mimeType: tempAsset.mimeType,
      dataUrl: tempAsset.dataUrl,
      cleanVocalSampleUrl: dspResult.cleanVocalSampleUrl,
      speakerEmbedding: dspResult.speakerEmbedding,
      durationSec: dspResult.durationSec,
      analyzedProfile: profile,
    });
    setStudioName((prev) => (prev.trim() ? prev : tempAsset.name));
    setBaseGeminiVoice(profile.recommendedBaseVoice);
    setTone((prev) => ({
      ...prev,
      pitch: profile.pitchHint,
      rate: profile.rateHint,
      warmthDb: typeof profile.warmthDb === 'number' ? profile.warmthDb : prev.warmthDb,
      clarityDb: typeof profile.clarityDb === 'number' ? profile.clarityDb : prev.clarityDb,
      styleDirection: profile.stylePrompt || prev.styleDirection,
    }));
    triggerDeviceHaptic('success', true);
    setStudioFeedback(
      usedGeminiAi
        ? `AI đã tự động phân tích & khớp 100% âm sắc gốc (${dspResult.speakerEmbedding.vectorId}). Bấm "Nghe thử" hoặc Lưu!`
        : `Đã trích xuất giọng gốc on-device (${dspResult.speakerEmbedding.vectorId}). Bấm "Nghe thử" hoặc Lưu!`
    );
  };

  // Import original audio file directly into the Voice Builder so AI + DSP analyze its vocal fingerprint BEFORE saving
  const handleImportVoiceIntoBuilder = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setStudioFeedback('');
    setIsAnalyzingBuilderVoice(true);
    try {
      const file = files[0];
      const tempAsset = await createExternalVoiceFromFile(file);
      await analyzeImportedVoiceData(tempAsset);
    } catch (err) {
      setStudioFeedback(
        err instanceof Error ? err.message : 'Không thể đọc tệp voice gốc từ máy.'
      );
    } finally {
      setIsAnalyzingBuilderVoice(false);
      window.setTimeout(() => setCloningProgress(null), 900);
      if (builderVoiceInputRef.current) builderVoiceInputRef.current.value = '';
    }
  };

  const stopAnyPreview = () => {
    previewRunIdRef.current += 1;
    previewAbortRef.current?.abort();
    previewAbortRef.current = null;
    getPlayer().stop();
    stopOnDeviceSpeech();
    setPlayingVoiceId(null);
    setIsTestingEq(false);
  };

  /**
   * Shared synthesis preview pipeline — IDENTICAL to live book reading in AudiobookStudioDrawer,
   * with immediate abort + runId cancellation + client cache so rapid consecutive taps never lag or pile up.
   */
  const previewSynthesizedVoice = async (
    runId: number,
    opts: {
      baseVoice: GeminiVoiceName;
      stylePrompt: string;
      toneSettings: VoiceToneSettings;
      pitch: number;
      rate: number;
      preferGender: 'female' | 'male' | 'neutral';
      voiceSlotIndex: number;
      useVoiceDesign: boolean;
      vectorId?: string;
      cleanVocalSampleUrl?: string;
      speakerEmbedding?: SpeakerEmbeddingVector;
    }
  ): Promise<boolean> => {
    if (previewRunIdRef.current !== runId) return true;
    const player = getPlayer();
    const cacheKey = `${opts.vectorId || 'sys'}|${opts.baseVoice}|${opts.useVoiceDesign ? 1 : 0}|${opts.pitch.toFixed(2)}|${opts.rate.toFixed(2)}|${opts.toneSettings.warmthDb}|${opts.toneSettings.clarityDb}|${opts.stylePrompt.slice(0, 72)}|${sampleText.trim().slice(0, 120)}`;
    const cachedUrl = previewAudioCacheRef.current.get(cacheKey);
    if (cachedUrl) {
      await player.play(cachedUrl, opts.toneSettings, opts.rate, undefined, 'none', opts.speakerEmbedding);
      return true;
    }

    const canTryAi =
      Date.now() >= previewAiCooldownUntilRef.current &&
      (typeof navigator === 'undefined' || navigator.onLine !== false);

    if (canTryAi) {
      const controller = new AbortController();
      previewAbortRef.current = controller;
      const timer = window.setTimeout(() => controller.abort(), 3800);
      try {
        const resp = await fetch(resolveApiUrl('/api/ai/tts'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            text: sampleText,
            voiceName: opts.baseVoice,
            stylePrompt: opts.stylePrompt,
            expressive: true,
            useVoiceDesign: opts.useVoiceDesign,
            lang: 'vi-VN',
          }),
        });
        if (previewRunIdRef.current !== runId) return true;
        const data = await resp.json();
        if (resp.ok && data?.audioBase64 && !data?.quotaExceeded) {
          const dataUrl = `data:${data.mimeType || 'audio/wav'};base64,${data.audioBase64}`;
          if (previewAudioCacheRef.current.size > 16) {
            const oldest = previewAudioCacheRef.current.keys().next().value;
            if (oldest) previewAudioCacheRef.current.delete(oldest);
          }
          previewAudioCacheRef.current.set(cacheKey, dataUrl);
          if (previewRunIdRef.current !== runId) return true;
          await player.play(dataUrl, opts.toneSettings, opts.rate, undefined, 'none', opts.speakerEmbedding);
          return true;
        }
        if (data?.quotaExceeded) {
          previewAiCooldownUntilRef.current = Date.now() + 45000;
        } else {
          previewAiCooldownUntilRef.current = Date.now() + 8000;
        }
      } catch {
        // Aborted by rapid next tap -> exit immediately without triggering fallback!
        if (previewRunIdRef.current !== runId) return true;
        previewAiCooldownUntilRef.current = Date.now() + 8000;
      } finally {
        window.clearTimeout(timer);
        if (previewAbortRef.current === controller) {
          previewAbortRef.current = null;
        }
      }
    }

    if (previewRunIdRef.current !== runId) return true;
    const spoke = await speakOnDevice({
      text: sampleText,
      lang: 'vi-VN',
      pitch: opts.pitch,
      rate: opts.rate,
      preferGender: opts.preferGender,
      voiceSlotIndex: opts.voiceSlotIndex,
    });
    if (previewRunIdRef.current !== runId) return true;
    if (spoke) return true;

    // Never revert to a generic default voice chime when we have the user's isolated clean vocal sample!
    if (opts.cleanVocalSampleUrl) {
      await player.play(opts.cleanVocalSampleUrl, opts.toneSettings, opts.rate, undefined, 'none', opts.speakerEmbedding);
      return true;
    }

    const pack = await installOfflineVoicePack(opts.baseVoice);
    if (previewRunIdRef.current !== runId) return true;
    await player.play(pack.calibrationWavBase64, opts.toneSettings, opts.rate, undefined, 'none', opts.speakerEmbedding);
    return false;
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
    if (!voice.speakerEmbedding && !voice.cleanVocalSampleUrl && !voice.dataUrl) {
      setVoicePreviewNotice(`Giọng "${voice.name}" chưa có Speaker Embedding. Hãy import lại file mẫu.`);
      return;
    }
    stopAnyPreview();
    const runId = previewRunIdRef.current;
    setPlayingVoiceId(key);
    try {
      // Use the EXACT same AI Voice Design + Tone Color EQ pipeline as ReaderView so preview === reading 100%
      const extParams = computeExternalVoiceSpeechParams(voice);
      const effectiveTone: VoiceToneSettings = {
        ...DEFAULT_VOICE_TONE,
        warmthDb: extParams.warmthDb,
        clarityDb: extParams.clarityDb,
        pitch: extParams.pitch,
        rate: extParams.rate,
        styleDirection: extParams.stylePrompt,
        ...(voice.toneSettings || {}),
      };
      const ok = await previewSynthesizedVoice(runId, {
        baseVoice: extParams.baseVoice,
        stylePrompt: extParams.stylePrompt,
        toneSettings: effectiveTone,
        pitch: extParams.pitch,
        rate: extParams.rate,
        preferGender: extParams.preferGender,
        voiceSlotIndex: extParams.voiceSlotIndex,
        useVoiceDesign: true,
        vectorId: voice.speakerEmbedding?.vectorId || voice.voiceId || voice.id,
        cleanVocalSampleUrl: voice.cleanVocalSampleUrl || voice.dataUrl,
        speakerEmbedding: voice.speakerEmbedding,
      });
      if (!ok && previewRunIdRef.current === runId) {
        setVoicePreviewNotice('Đang phát mẫu âm sắc nội bộ cho cấu hình giọng đã import.');
      }
    } catch (err) {
      if (previewRunIdRef.current === runId) {
        setVoicePreviewNotice(err instanceof Error ? err.message : 'Không thể phát thử âm thanh.');
      }
    } finally {
      if (previewRunIdRef.current === runId) {
        setPlayingVoiceId((curr) => (curr === key ? null : curr));
      }
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
    const runId = previewRunIdRef.current;
    setPlayingVoiceId(key);
    try {
      const presetTone = getOnDeviceVoiceTone(voiceName);
      const voiceMeta = GEMINI_VOICES.find((v) => v.name === voiceName);
      const ok = await previewSynthesizedVoice(runId, {
        baseVoice: voiceName,
        stylePrompt: voiceMeta?.tone || 'Đọc truyền cảm, rõ chữ, tự nhiên như sách nói',
        toneSettings: {
          ...DEFAULT_VOICE_TONE,
          pitch: presetTone.pitch,
          rate: presetTone.rate,
          styleDirection: voiceMeta?.tone || DEFAULT_VOICE_TONE.styleDirection,
        },
        pitch: presetTone.pitch,
        rate: presetTone.rate,
        preferGender: presetTone.preferGender,
        voiceSlotIndex: presetTone.voiceSlotIndex,
        useVoiceDesign: false,
      });
      if (!ok && previewRunIdRef.current === runId) {
        setVoicePreviewNotice(
          `Đã phát âm sắc mẫu offline (${voiceName}). Để đọc toàn văn trên điện thoại không cần mạng, mở bằng app APK Android.`
        );
      }
    } catch (err) {
      if (previewRunIdRef.current === runId) {
        setVoicePreviewNotice(err instanceof Error ? err.message : 'Không thể phát thử âm thanh.');
      }
    } finally {
      if (previewRunIdRef.current === runId) {
        setPlayingVoiceId((curr) => (curr === key ? null : curr));
      }
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
    const runId = previewRunIdRef.current;
    setPlayingVoiceId(key);
    try {
      const ok = await speakOnDevice({
        text: sampleText,
        lang: voice.lang || 'vi-VN',
        voiceURI: voice.voiceURI,
        pitch: 1.0,
        rate: 1.0,
      });
      if (!ok && previewRunIdRef.current === runId) {
        setVoicePreviewNotice('Trình duyệt không phản hồi bộ đọc TTS mặc định của hệ điều hành.');
      }
    } finally {
      if (previewRunIdRef.current === runId) {
        setPlayingVoiceId((curr) => (curr === key ? null : curr));
      }
    }
  };

  const [pronDict, setPronDict] = useState<PronunciationEntry[]>(() => loadPronunciationDict());
  const [dictWrongWord, setDictWrongWord] = useState('');
  const [dictCorrectReading, setDictCorrectReading] = useState('');
  const [showPronDict, setShowPronDict] = useState(false);

  const handleTestStudioEq = async () => {
    if (!builderImportedVoice) return;
    unlockAudioPlaybackSync();
    if (isTestingEq) {
      stopAnyPreview();
      return;
    }
    stopAnyPreview();
    const runId = previewRunIdRef.current;
    setStudioFeedback('');
    setIsTestingEq(true);
    try {
      // Synthesize live preview STRICTLY from the auto-extracted Speaker Embedding + Reading Style + AI Instruction
      const analyzed = builderImportedVoice.analyzedProfile;
      const styleLabel = READING_VOICE_STYLES.find((s) => s.id === studioReadingStyle)?.label;

      if (builderImportedVoice.speakerEmbedding) {
        const cloned = resolveClonedVoiceSynthesis({
          name: studioName.trim() || builderImportedVoice.fileName,
          embedding: builderImportedVoice.speakerEmbedding,
          tone,
          readingStyle: studioReadingStyle,
          voiceStyle: styleLabel,
          instruction: tone.styleDirection || analyzed?.stylePrompt || '',
          overrideGender:
            analyzed?.gender === 'male' || analyzed?.gender === 'female'
              ? analyzed.gender
              : undefined,
        });

        await previewSynthesizedVoice(runId, {
          baseVoice: cloned.baseVoice,
          stylePrompt: cloned.stylePrompt,
          toneSettings: cloned.toneSettings,
          pitch: cloned.pitch,
          rate: cloned.rate,
          preferGender: cloned.gender,
          voiceSlotIndex: cloned.voiceSlotIndex,
          useVoiceDesign: true,
          vectorId: cloned.vectorId,
          cleanVocalSampleUrl:
            builderImportedVoice.cleanVocalSampleUrl || builderImportedVoice.dataUrl,
          speakerEmbedding: builderImportedVoice.speakerEmbedding,
        });
      } else {
        setStudioFeedback('Không tìm thấy Speaker Embedding hợp lệ. Vui lòng import lại file mẫu.');
      }
    } catch (err) {
      if (previewRunIdRef.current === runId) {
        setStudioFeedback(err instanceof Error ? err.message : 'Không thể phát thử âm thanh.');
      }
    } finally {
      if (previewRunIdRef.current === runId) {
        setIsTestingEq(false);
      }
    }
  };

  const handleSaveStudioVoice = async () => {
    if (!builderImportedVoice?.dataUrl || !studioName.trim()) return;
    setStudioFeedback('');
    setIsSavingVoice(true);
    try {
      const dataUrl = builderImportedVoice.dataUrl;
      const cleanVocalSampleUrl = builderImportedVoice.cleanVocalSampleUrl;
      const speakerEmbedding = builderImportedVoice.speakerEmbedding;
      const fileName = builderImportedVoice.fileName;
      const mimeType = builderImportedVoice.mimeType || 'audio/wav';
      const analyzed = builderImportedVoice.analyzedProfile;
      const styleMeta = READING_VOICE_STYLES.find((s) => s.id === studioReadingStyle);

      let voiceId: string;
      let gender: 'male' | 'female';
      let pp: NonNullable<ExternalVoiceAsset['promptParams']>;
      let finalToneSettings: VoiceToneSettings;

      if (speakerEmbedding) {
        const cloned = resolveClonedVoiceSynthesis({
          name: studioName.trim(),
          embedding: speakerEmbedding,
          tone,
          readingStyle: studioReadingStyle,
          voiceStyle: styleMeta?.label,
          instruction: tone.styleDirection || analyzed?.stylePrompt || '',
          overrideGender:
            analyzed?.gender === 'male' || analyzed?.gender === 'female'
              ? analyzed.gender
              : undefined,
        });
        voiceId = cloned.voiceId;
        gender = cloned.gender;
        pp = cloned.promptParams;
        finalToneSettings = cloned.toneSettings;
      } else {
        const presetTone = getOnDeviceVoiceTone(baseGeminiVoice);
        gender =
          analyzed?.gender === 'male'
            ? 'male'
            : analyzed?.gender === 'female'
            ? 'female'
            : presetTone.preferGender === 'male'
            ? 'male'
            : 'female';
        const compactProfile = buildCompactVoiceProfile({
          name: studioName.trim(),
          gender,
          instruction: tone.styleDirection || analyzed?.stylePrompt || '',
          voiceStyle: styleMeta?.label,
          sampleSignature: dataUrl.slice(0, 128),
          acousticSpeedFactor: tone.rate,
          acousticWarmthDb: tone.warmthDb,
          acousticClarityDb: tone.clarityDb,
        });
        voiceId = compactProfile.voiceId;
        pp = compactProfile.promptParams;
        finalToneSettings = {
          warmthDb: pp.warmthDb,
          clarityDb: pp.clarityDb,
          pitch: pp.pitch,
          rate: pp.speed,
          styleDirection: pp.geminiStylePrompt || '',
        };
      }

      const newVoice: ExternalVoiceAsset = {
        id: voiceId,
        voiceId,
        name: studioName.trim(),
        fileName,
        mimeType,
        dataUrl,
        cleanVocalSampleUrl,
        speakerEmbedding,
        durationSec: builderImportedVoice.durationSec,
        readingStyle: studioReadingStyle,
        promptParams: pp,
        originType: 'imported',
        originLabel: speakerEmbedding
          ? `AI Clone (${speakerEmbedding.vectorId}) · ${styleMeta?.label || 'Tiểu thuyết'}`
          : `Voice Profile · ${styleMeta?.label || 'Tiểu thuyết'}`,
        toneSettings: finalToneSettings,
        analyzedProfile: {
          description: analyzed?.description || `Phân tích từ ${fileName}`,
          stylePrompt: pp.geminiStylePrompt || '',
          recommendedBaseVoice: pp.recommendedBaseVoice || baseGeminiVoice,
          gender,
          pitchHint: pp.pitch,
          rateHint: pp.speed,
          warmthDb: pp.warmthDb,
          clarityDb: pp.clarityDb,
          transcriptPreview: analyzed?.transcriptPreview,
          analyzedBy: analyzed?.analyzedBy || 'device-dsp',
        },
        addedAt: Date.now(),
      };

      await onAddExternalVoice(newVoice);
      setShowSaveConfirmModal(false);
      resetBuilderToEmpty();
      triggerDeviceHaptic('success', true);
      setStudioFeedback(`Đã lưu giọng "${newVoice.name}" thành công!`);
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

      {/* Minimalist Zero-Manual-Tuning 6-Row On-Device Voice Cloning Creator */}
      <section
        data-testid="minimalist-voice-creator"
        aria-label={strings.createVoice}
        className="border border-stone-200 dark:border-stone-800 rounded-2xl bg-white dark:bg-[#16181C] p-3.5 sm:p-5 space-y-3 min-w-0 overflow-hidden"
      >
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <Sliders className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400 shrink-0" />
            <h2 className="text-[13px] font-semibold text-stone-900 dark:text-stone-100 truncate">
              {strings.createVoice}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => toggleDisclosure('builder-help')}
            aria-expanded={activeDisclosure === 'builder-help'}
            aria-label="Xem mô tả tạo giọng"
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
            Nạp file giọng mẫu 5–8 giây. AI tự động trích xuất &amp; khớp 100% âm sắc gốc on-device mà không cần chỉnh thông số thủ công.
          </p>
        )}

        {/* Strict 6-Row Top-to-Bottom Minimalist Layout (ZERO manual audio sliders!) */}
        <div className="max-w-2xl space-y-2.5 min-w-0">
          {/* Row 1: Single Import Voice Button */}
          <div className="space-y-1.5 min-w-0">
            <input
              ref={builderVoiceInputRef}
              data-testid="import-voice-file-input"
              type="file"
              accept="audio/*,.mp3,.wav,.ogg,.m4a"
              className="hidden"
              onChange={(e) => handleImportVoiceIntoBuilder(e.target.files)}
            />
            <div className="flex items-center gap-1.5 min-w-0">
              <button
                type="button"
                data-testid="import-voice-file-btn"
                disabled={isAnalyzingBuilderVoice}
                onClick={() => builderVoiceInputRef.current?.click()}
                className={`flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all disabled:opacity-50 min-h-[42px] border ${
                  builderImportedVoice
                    ? 'border-emerald-600/45 bg-emerald-50/70 dark:bg-emerald-950/25 text-emerald-900 dark:text-emerald-200'
                    : 'border-transparent bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:opacity-90'
                }`}
              >
                {isAnalyzingBuilderVoice ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                ) : builderImportedVoice ? (
                  <Check className="w-3.5 h-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <Upload className="w-3.5 h-3.5 shrink-0" />
                )}
                <span className="truncate">
                  {builderImportedVoice
                    ? `${builderImportedVoice.fileName} · ${strings.voiceReady}`
                    : strings.importVoice}
                </span>
              </button>
              {builderImportedVoice && (
                <button
                  type="button"
                  data-testid="clear-imported-voice-btn"
                  onClick={resetBuilderToEmpty}
                  aria-label="Gỡ file voice gốc"
                  className="w-10 h-[42px] rounded-xl border border-stone-200 dark:border-stone-700 text-stone-500 hover:text-red-600 flex items-center justify-center shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {(isAnalyzingBuilderVoice || (cloningProgress && cloningProgress.percent < 100)) && (
              <div
                data-testid="voice-cloning-progress"
                className="p-2 rounded-lg bg-amber-50/60 dark:bg-amber-950/20 border border-amber-700/25 space-y-1"
              >
                <div className="flex items-center justify-between gap-2 text-[10.5px] font-medium text-amber-900 dark:text-amber-300">
                  <span className="truncate">
                    {cloningProgress?.label || 'Đang trích xuất âm sắc gốc...'}
                  </span>
                  <span className="tabular-nums font-semibold shrink-0">
                    {cloningProgress?.percent ?? 15}%
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-amber-900/15 dark:bg-amber-500/20 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-amber-800 dark:bg-amber-400 transition-all duration-300"
                    style={{ width: `${cloningProgress?.percent ?? 15}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Row 2: Tên giọng */}
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-stone-500">
              {strings.voiceName}
            </label>
            <input
              type="text"
              data-testid="studio-voice-name-input"
              value={studioName}
              placeholder={strings.voiceNamePlaceholder}
              onChange={(e) => setStudioName(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent focus:outline-none focus:border-amber-700"
            />
          </div>

          {/* Row 3: Văn phong */}
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-stone-500">
              {strings.voiceStyle}
            </label>
            <GlassSelect<BookReadingStyle>
              ariaLabel={strings.voiceStyle}
              title={strings.voiceStyle}
              value={studioReadingStyle}
              onChange={setStudioReadingStyle}
              options={READING_VOICE_STYLES.map((style) => ({
                value: style.id,
                label: style.label,
              }))}
            />
          </div>

          {/* Row 4: Mô tả chỉ dẫn AI */}
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-stone-500">
              {strings.aiInstruction}
            </label>
            <input
              type="text"
              data-testid="studio-voice-prompt-input"
              value={tone.styleDirection}
              placeholder={strings.aiInstructionPlaceholder}
              onChange={(e) => setTone((t) => ({ ...t, styleDirection: e.target.value }))}
              className="w-full px-3 py-2 text-xs rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent focus:outline-none focus:border-amber-700"
            />
          </div>

          {/* Row 5: Nội dung nghe thử (Rectangular multi-line editable box) */}
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-stone-500">
              {strings.previewContent}
            </label>
            <textarea
              rows={3}
              data-testid="studio-preview-text-input"
              value={sampleText}
              onChange={(e) => setSampleText(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent focus:outline-none focus:border-amber-700 resize-none"
            />
          </div>

          {/* Row 6: Nghe thử + Save Icon Button side-by-side */}
          <div className="flex items-center gap-2 pt-0.5">
            <button
              type="button"
              data-testid="studio-preview-btn"
              disabled={!builderImportedVoice}
              onClick={handleTestStudioEq}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-xs font-semibold hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-45 disabled:cursor-not-allowed min-h-[44px]"
            >
              {isTestingEq ? (
                <>
                  <Square className="w-3.5 h-3.5 text-red-600 shrink-0" />
                  <span>{strings.stopPreview}</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400 shrink-0" />
                  <span>{strings.previewVoice}</span>
                </>
              )}
            </button>

            <button
              type="button"
              data-testid="studio-save-voice-icon-btn"
              aria-label={strings.saveVoice}
              title={strings.saveVoice}
              disabled={
                !builderImportedVoice ||
                !studioName.trim() ||
                isSavingVoice ||
                isAnalyzingBuilderVoice
              }
              onClick={() => setShowSaveConfirmModal(true)}
              className="w-12 h-[44px] rounded-xl bg-amber-800 text-white hover:bg-amber-900 disabled:opacity-45 disabled:cursor-not-allowed flex items-center justify-center shrink-0 shadow-sm transition-all active:scale-95"
            >
              {isSavingVoice ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
            </button>
          </div>

          {studioFeedback && (
            <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400">
              <Check className="w-4 h-4 shrink-0" />
              <span>{studioFeedback}</span>
            </div>
          )}
        </div>

        {/* Personalized Pronunciation Dictionary (Từ điển phát âm cá nhân) */}
        <div className="pt-2 border-t border-stone-200/70 dark:border-stone-800">
          <button
            type="button"
            data-testid="toggle-pronunciation-dict-btn"
            onClick={() => setShowPronDict((v) => !v)}
            className="w-full flex items-center justify-between gap-2 py-1 text-left"
          >
            <span className="inline-flex items-center gap-1.5 text-[12px] font-sans font-semibold text-stone-900 dark:text-stone-100">
              <Sparkles className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400" />
              <span>Từ điển phát âm cá nhân ({pronDict.length})</span>
            </span>
            <ChevronDown
              className={`w-4 h-4 text-stone-500 transition-transform ${
                showPronDict ? 'rotate-180' : ''
              }`}
            />
          </button>

          {showPronDict && (
            <div className="mt-2.5 space-y-2.5 p-3 rounded-2xl border border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-900/50">
              <p className="text-[11px] text-stone-500 dark:text-stone-400">
                Tự động sửa cách đọc tên riêng, từ Hán Việt hoặc viết tắt trên mọi chương sách trước khi AI phát âm.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                <input
                  type="text"
                  data-testid="pron-wrong-input"
                  value={dictWrongWord}
                  onChange={(e) => setDictWrongWord(e.target.value)}
                  placeholder="Từ gốc / đọc sai (VD: Võ Hồn)"
                  className="sm:col-span-5 px-3 py-1.5 rounded-full border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-xs"
                />
                <input
                  type="text"
                  data-testid="pron-correct-input"
                  value={dictCorrectReading}
                  onChange={(e) => setDictCorrectReading(e.target.value)}
                  placeholder="Cách đọc chuẩn (VD: Võ Hồn Điện)"
                  className="sm:col-span-5 px-3 py-1.5 rounded-full border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-xs"
                />
                <button
                  type="button"
                  data-testid="pron-add-btn"
                  disabled={!dictWrongWord.trim() || !dictCorrectReading.trim()}
                  onClick={() => {
                    const next: PronunciationEntry[] = [
                      {
                        id: `pd-${Date.now()}`,
                        wrongWord: dictWrongWord.trim(),
                        correctReading: dictCorrectReading.trim(),
                      },
                      ...pronDict,
                    ];
                    setPronDict(next);
                    savePronunciationDict(next);
                    setDictWrongWord('');
                    setDictCorrectReading('');
                  }}
                  className="sm:col-span-2 px-3 py-1.5 rounded-full bg-amber-800 text-white text-xs font-semibold hover:bg-amber-900 disabled:opacity-45"
                >
                  Thêm
                </button>
              </div>
              {pronDict.length > 0 && (
                <div className="space-y-1 max-h-[140px] overflow-y-auto">
                  {pronDict.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-white dark:bg-stone-900 border border-stone-200/80 dark:border-stone-800 text-[11.5px]"
                    >
                      <span className="truncate">
                        <strong className="text-stone-900 dark:text-stone-100">{item.wrongWord}</strong>
                        <span className="mx-1.5 text-stone-400">→</span>
                        <span className="text-amber-800 dark:text-amber-400 font-medium">
                          {item.correctReading}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const next = pronDict.filter((e) => e.id !== item.id);
                          setPronDict(next);
                          savePronunciationDict(next);
                        }}
                        aria-label={`Xóa từ ${item.wrongWord}`}
                        className="p-1 rounded-full text-stone-400 hover:text-red-600"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 min-w-0">
        {/* Unified All Voices Section (Global Default Reading Voice) */}
        <section className="ios-floating-shadow border border-stone-200 dark:border-stone-800 rounded-2xl bg-white dark:bg-[#16181C] p-3.5 sm:p-4 space-y-2.5 min-w-0 overflow-hidden">
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <Volume2 className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400 shrink-0" />
                <h2 className="text-[13px] font-semibold truncate">{strings.readingVoice}</h2>
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
                {externalVoices.length + visibleGeminiVoices.length + visibleDeviceVoices.length} giọng
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

          {/* Single Unified Scrollable Compact List (2/3 height): Imported/Studio + Built-in AI + Device Voices */}
          <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-0.5 min-w-0">
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

            {visibleGeminiVoices.map((gv) => {
              const key = `gemini:${gv.name}`;
              const displayLabel = voiceAliases[key] || gv.label;
              const isSelected = activeDefaultVoice.id === key;
              const isExpanded = Boolean(expandedVoiceIds[key]);
              const canDelete = !isProtectedPrimaryVoice(key);
              return (
                <div
                  key={key}
                  data-testid={`voice-row-${gv.name}`}
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
                          subtitle: canDelete
                            ? `Giọng AI có sẵn · ${gv.name}`
                            : `Voice hệ thống gốc đầu tiên · ${gv.name}`,
                          canDelete,
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
                    <div className="px-3 pb-2.5 pt-2 border-t border-stone-200/70 dark:border-stone-800/80 space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="inline-flex text-[10px] font-medium px-2 py-0.5 rounded-md bg-stone-200/80 dark:bg-stone-800 text-stone-700 dark:text-stone-300">
                          {gv.isDefault ? 'Giọng AI gốc mặc định' : 'Giọng AI có sẵn'} · {gv.name}
                        </span>
                        {canDelete && (
                          <TwoTapDeleteButton
                            variant="pill"
                            label="Xóa voice"
                            confirmLabel="Xác nhận xóa?"
                            onConfirmDelete={() => handleHideSystemVoice(key)}
                          />
                        )}
                      </div>
                      <p className="text-[11px] leading-snug text-stone-600 dark:text-stone-400">
                        {gv.tone}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}

            {visibleDeviceVoices.map((dv) => {
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
                          subtitle: `Giọng thiết bị · ${dv.lang}`,
                          canDelete: true,
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
                    <div className="px-3 pb-2.5 pt-2 border-t border-stone-200/70 dark:border-stone-800/80 space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="inline-flex text-[10px] font-medium px-2 py-0.5 rounded-md bg-stone-200/80 dark:bg-stone-800 text-stone-700 dark:text-stone-300">
                          Giọng của máy (Offline) · {dv.lang}
                        </span>
                        <TwoTapDeleteButton
                          variant="pill"
                          label="Xóa voice"
                          confirmLabel="Xác nhận xóa?"
                          onConfirmDelete={() => handleHideSystemVoice(key)}
                        />
                      </div>
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
                  <h2 className="text-[13px] font-semibold truncate">Phông chữ</h2>
                  <button
                    type="button"
                    onClick={() => toggleDisclosure('font-help')}
                    aria-expanded={activeDisclosure === 'font-help'}
                    aria-label="Xem mô tả Phông chữ"
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
                  Phông máy đọc sách, phông máy và phông .TTF/.OTF/.WOFF tự thêm.
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
              <span>Thêm phông</span>
            </button>
          </div>

          {/* Compact Scrollable Font List (2/3 height) */}
          <div className="space-y-1.5 max-h-[245px] overflow-y-auto pr-0.5 min-w-0">
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
              <h2 className="text-[13px] font-sans font-semibold text-stone-900 dark:text-stone-100 truncate">
                {strings.ambientMusic}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => toggleDisclosure('ambient-help')}
              aria-expanded={activeDisclosure === 'ambient-help'}
              aria-label="Xem mô tả Nhạc nền"
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
              Tiếng mưa, lửa trại, sóng biển, lo-fi hoặc nhạc MP3/WAV từ máy.
            </p>
          )}
        </div>

        <AmbientSoundPanel
          customTracks={customAmbientTracks}
          onAddCustomTrack={onAddCustomAmbientTrack}
          onDeleteCustomTrack={onDeleteCustomAmbientTrack}
        />
      </section>

      {/* Save Cloned Voice Confirmation Dialog: "Lưu giọng - [Tên giọng]" */}
      <IosSheet
        isOpen={showSaveConfirmModal}
        onClose={() => setShowSaveConfirmModal(false)}
        variant="center-dialog"
        zIndexClass="z-[85]"
        ariaLabel={`${strings.saveVoiceConfirmPrefix} - ${studioName.trim()}`}
        testId="save-voice-confirm-dialog"
        panelClassName="ios-frosted-surface w-full max-w-xs rounded-[22px] text-stone-900 dark:text-stone-100 p-4 space-y-3.5 font-sans shadow-2xl"
      >
        <div className="space-y-1.5">
          <h3
            data-testid="save-voice-confirm-title"
            className="text-[14px] font-semibold text-stone-900 dark:text-stone-100 leading-snug"
          >
            {strings.saveVoiceConfirmPrefix} - {studioName.trim()}
          </h3>
          <p className="text-[11.5px] text-stone-500 dark:text-stone-400 leading-relaxed">
            {builderImportedVoice?.fileName}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            data-testid="cancel-save-voice-btn"
            onClick={() => setShowSaveConfirmModal(false)}
            className="h-10 rounded-xl border border-stone-300 dark:border-stone-700 bg-white/80 dark:bg-stone-900 text-xs font-semibold text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            {strings.cancel}
          </button>
          <button
            type="button"
            data-testid="confirm-save-voice-btn"
            disabled={isSavingVoice}
            onClick={() => void handleSaveStudioVoice()}
            className="h-10 rounded-xl bg-amber-800 hover:bg-amber-900 text-white text-xs font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
          >
            {isSavingVoice ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            <span>{strings.accept}</span>
          </button>
        </div>
      </IosSheet>

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
            : 'Voice hệ thống gốc đầu tiên — được phép đổi tên, không được phép xóa.'
        }
        onClose={() => setLongPressTarget(null)}
        onRename={handleRenameLongPressTarget}
        onDelete={longPressTarget?.canDelete ? handleDeleteLongPressTarget : undefined}
      />
    </main>
  );
};
