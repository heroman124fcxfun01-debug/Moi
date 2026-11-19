import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Sparkles,
  Upload,
  Volume2,
  Loader2,
  Users,
  Square,
  SlidersHorizontal,
  Check,
  Cpu,
  Radio,
  Layers,
} from 'lucide-react';
import type {
  Book,
  BookReadingStyle,
  Chapter,
  ChapterAnalysis,
  CharacterVoiceAssignment,
  CharacterVoiceSource,
  CustomAmbientTrack,
  DefaultVoiceSelection,
  ExternalVoiceAsset,
  GeminiVoiceName,
  VoiceToneSettings,
} from '../types/book';
import { GEMINI_VOICES, createExternalVoiceFromFile } from '../utils/fileHelpers';
import {
  DEFAULT_VOICE_TONE,
  FilteredAudioPlayer,
  MAX_READING_SPEED,
  MIN_READING_SPEED,
  READING_SPEED_PRESETS,
  READING_SPEED_STEP,
  clearMediaSession,
  formatReadingSpeed,
  normalizeReadingSpeed,
  stepReadingSpeed,
  updateMediaSession,
} from '../utils/audioFilterEngine';
import { ambientSoundManager } from '../utils/ambientSoundEngine';
import { getStoredApiBase, isNativeAndroidApp, resolveApiUrl } from '../utils/apiClient';
import {
  getOnDeviceVoiceTone,
  pickBestDeviceVoice,
  stopOnDeviceSpeech,
} from '../utils/deviceTtsEngine';
import {
  analyzeChapterOnDevice,
  buildAutoVoiceAssignments,
  CHARACTER_VOICE_POOL,
} from '../utils/onDeviceCharacterAI';
import {
  buildBatchedPlaybackUnits,
  findBatchIndexForParagraph,
  resolveActiveHighlightInBatch,
  type PlaybackBatchUnit,
} from '../utils/audiobookPrefetch';
import { analyzeVoiceSampleOnDevice } from '../utils/deviceHardware';
import { resolveNarratorAssignmentFromDefault } from '../utils/studioCatalog';
import { AmbientSoundPanel } from './AmbientSoundPanel';
import { LiquidDropThumb, useLiquidDropIndicator } from './LiquidGlassBar';

interface AudiobookStudioDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenPanel?: () => void;
  isReaderActive?: boolean;
  book: Book;
  chapter: Chapter;
  hasNextChapter?: boolean;
  displayedParagraphs?: string[];
  autoPlaySignal?: number;
  onSaveChapterAnalysis: (
    chapterId: string,
    analysis: ChapterAnalysis,
    mergedVoiceAssignments?: Record<string, CharacterVoiceAssignment>
  ) => void;
  onUpdateVoiceAssignment: (
    characterId: string,
    assignment: CharacterVoiceAssignment
  ) => void;
  externalVoices: ExternalVoiceAsset[];
  onAddExternalVoice: (voice: ExternalVoiceAsset) => Promise<void>;
  customAmbientTracks?: CustomAmbientTrack[];
  onAddCustomAmbientTrack?: (track: CustomAmbientTrack) => Promise<void>;
  onDeleteCustomAmbientTrack?: (trackId: string) => Promise<void>;
  onHighlightParagraph: (paragraphIndex: number | null, progressRatio?: number) => void;
  onSyncReadingParagraph?: (paragraphIndex: number) => void;
  onPlaybackStateChange?: (isPlaying: boolean) => void;
  onNextChapter: () => void;
  defaultVoice?: DefaultVoiceSelection;
  standaloneDeviceMode?: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  narrator: 'Người dẫn / Diễn giả',
  protagonist: 'Nhân vật chính',
  supporting: 'Nhân vật phụ',
  antagonist: 'Phản diện',
};

const STYLE_LABELS: Record<BookReadingStyle, string> = {
  novel: 'Tiểu thuyết (Đa giọng nhân vật)',
  selfhelp: 'Học tập (Nhấn trọng tâm)',
  essay: 'Tản văn (Nhẹ nhàng, cảm xúc)',
  research: 'Nghiên cứu (Mạch lạc, rõ chữ)',
};

const SPEED_OPTIONS = READING_SPEED_PRESETS;
const PLAYBACK_SPEED_STORAGE_KEY = 'laziread_playback_speed';

const QUICK_EMOTION_PROMPTS = [
  'Tự nhiên, truyền cảm',
  'Mạnh mẽ, hùng hồn, tự tin',
  'Nhẹ nhàng, ấm áp',
  'Nhấn mạnh điểm quan trọng',
  'Ấm trầm, sâu lắng',
];

const VALID_PRESET_VOICES: GeminiVoiceName[] = [
  'Kore',
  'Charon',
  'Zephyr',
  'Fenrir',
  'Puck',
  'Aoede',
];

// Prefetch 4 batched units ahead (~2 to 4 full book pages) so listening never stutters
const PREFETCH_AHEAD_UNITS = 4;

class QuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

export const AudiobookStudioDrawer: React.FC<AudiobookStudioDrawerProps> = ({
  isOpen,
  onClose,
  onOpenPanel,
  isReaderActive = true,
  book,
  chapter,
  hasNextChapter = false,
  displayedParagraphs,
  autoPlaySignal = 0,
  onSaveChapterAnalysis,
  onUpdateVoiceAssignment,
  externalVoices,
  onAddExternalVoice,
  customAmbientTracks = [],
  onAddCustomAmbientTrack = async () => {},
  onDeleteCustomAmbientTrack = async () => {},
  onHighlightParagraph,
  onSyncReadingParagraph,
  onPlaybackStateChange,
  onNextChapter,
  defaultVoice,
  standaloneDeviceMode = true,
}) => {
  const [activeTab, setActiveTab] = useState<'voices' | 'characters' | 'ambient'>('voices');
  const drawerTabsRef = useRef<HTMLDivElement>(null);
  const { thumb: drawerTabThumb, isGliding: drawerTabGliding } = useLiquidDropIndicator(
    activeTab,
    drawerTabsRef
  );
  const [ambientActiveCount, setAmbientActiveCount] = useState(
    () => Object.keys(ambientSoundManager.getSnapshot().activeVolumes).length
  );
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isAnalyzingVoice, setIsAnalyzingVoice] = useState(false);
  const [autoOnDeviceAI, setAutoOnDeviceAI] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoNotice, setInfoNotice] = useState('');

  useEffect(() => {
    return ambientSoundManager.subscribe((snap) => {
      setAmbientActiveCount(Object.keys(snap.activeVolumes).length);
    });
  }, []);

  // Playback state — default to on-device TTS so every phone reads immediately without cloud interruptions
  const forceOnDeviceDefault =
    standaloneDeviceMode || (isNativeAndroidApp() && !getStoredApiBase());
  const [engineMode, setEngineMode] = useState<'gemini' | 'browser'>(() =>
    forceOnDeviceDefault ? 'browser' : 'gemini'
  );
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(PLAYBACK_SPEED_STORAGE_KEY);
      if (saved) return normalizeReadingSpeed(saved, 1.0);
    } catch {
      // ignore storage errors
    }
    return 1.0;
  });
  const [speedInputText, setSpeedInputText] = useState<string>(() =>
    formatReadingSpeed(playbackSpeed)
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [showMiniBar, setShowMiniBar] = useState(false);
  const [currentBatchIndex, setCurrentBatchIndex] = useState(0);
  const [bufferedAheadCount, setBufferedAheadCount] = useState(0);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );

  const voiceFileRef = useRef<HTMLInputElement>(null);
  const filteredPlayerRef = useRef<FilteredAudioPlayer | null>(null);
  const isPlayingRef = useRef(false);
  const playbackRunIdRef = useRef(0);
  const audioCacheRef = useRef<Map<string, string>>(new Map());
  const inFlightCacheRef = useRef<Map<string, Promise<string>>>(new Map());
  const handledSignalRef = useRef(0);
  const quotaExhaustedRef = useRef(false);
  const autoContinueChapterRef = useRef(false);
  const speedRef = useRef(playbackSpeed);
  const engineModeRef = useRef(engineMode);

  const applyReadingSpeed = (nextRaw: number | string) => {
    const normalized = normalizeReadingSpeed(nextRaw, playbackSpeed);
    setPlaybackSpeed(normalized);
    setSpeedInputText(formatReadingSpeed(normalized));
  };

  useEffect(() => {
    speedRef.current = playbackSpeed;
    filteredPlayerRef.current?.setSpeed(playbackSpeed);
    try {
      localStorage.setItem(PLAYBACK_SPEED_STORAGE_KEY, formatReadingSpeed(playbackSpeed));
    } catch {
      // ignore storage errors
    }
  }, [playbackSpeed]);

  useEffect(() => {
    engineModeRef.current = engineMode;
  }, [engineMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setIsDesktop(window.innerWidth >= 1024);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const analysis = chapter.analysis;
  const readingStyle: BookReadingStyle = book.readingStyle || 'novel';
  const isTranslatedView = Boolean(
    displayedParagraphs &&
      displayedParagraphs.length > 0 &&
      chapter.paragraphs.length > 0 &&
      displayedParagraphs[0] !== chapter.paragraphs[0]
  );
  const activeParagraphs =
    isTranslatedView && displayedParagraphs ? displayedParagraphs : chapter.paragraphs;

  const getPlayer = () => {
    if (!filteredPlayerRef.current) {
      filteredPlayerRef.current = new FilteredAudioPlayer();
    }
    return filteredPlayerRef.current;
  };

  // Dispose persistent audio player only when AudiobookStudioDrawer itself unmounts
  useEffect(() => {
    return () => {
      playbackRunIdRef.current += 1;
      filteredPlayerRef.current?.dispose();
      clearMediaSession();
      stopOnDeviceSpeech();
    };
  }, []);

  // Build effective script (uses on-device/cloud character analysis when available)
  const effectiveScript = useMemo(() => {
    if (analysis?.script && analysis.script.length > 0 && !isTranslatedView) {
      return analysis.script;
    }
    return activeParagraphs.map((p, idx) => ({
      id: `para-${idx}`,
      paragraphIndex: idx,
      speakerId: 'narrator',
      speakerName: readingStyle === 'selfhelp' ? 'Diễn giả chính' : 'Người dẫn chuyện',
      emotionStyle:
        readingStyle === 'selfhelp'
          ? 'Tự tin, nhấn mạnh ý trọng tâm'
          : readingStyle === 'essay'
          ? 'Nhẹ nhàng, truyền cảm hứng'
          : readingStyle === 'research'
          ? 'Rõ ràng, mạch lạc'
          : 'Truyền cảm, tự nhiên',
      text: p,
    }));
  }, [analysis?.script, isTranslatedView, activeParagraphs, readingStyle]);

  // Batch consecutive same-speaker paragraphs into multi-paragraph units (~650 chars)
  // so 1 request covers multiple paragraphs & preloads multiple pages seamlessly
  const batchedUnits = useMemo(
    () => buildBatchedPlaybackUnits(effectiveScript, 650),
    [effectiveScript]
  );

  const batchedUnitsRef = useRef<PlaybackBatchUnit[]>(batchedUnits);
  useEffect(() => {
    batchedUnitsRef.current = batchedUnits;
  }, [batchedUnits]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const loadVoices = () => {
      setBrowserVoices(window.speechSynthesis.getVoices());
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  // Run 100% local on-device Character AI instantaneously without network or API cost
  const runOnDeviceCharacterScan = (switchToCharTab = false): ChapterAnalysis => {
    const localAnalysis = analyzeChapterOnDevice(
      chapter.title,
      activeParagraphs,
      readingStyle
    );
    const seededAssignments: Record<string, CharacterVoiceAssignment> = {
      ...(book.voiceAssignments || {}),
      narrator:
        book.voiceAssignments?.narrator ||
        resolveNarratorAssignmentFromDefault(defaultVoice, externalVoices),
    };
    const autoMap = buildAutoVoiceAssignments(localAnalysis.characters, seededAssignments);
    // Atomic save: persists BOTH chapter analysis AND all character voice assignments in 1 update!
    onSaveChapterAnalysis(chapter.id, localAnalysis, autoMap);

    if (switchToCharTab) {
      setActiveTab('characters');
    }
    return localAnalysis;
  };

  // Auto-run on-device character AI when chapter loads if enabled and chapter has no analysis yet
  useEffect(() => {
    if (!autoOnDeviceAI || analysis || activeParagraphs.length === 0 || isTranslatedView) return;
    runOnDeviceCharacterScan(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter.id, autoOnDeviceAI]);

  // Handle chapter change: stop old playback unless auto-continuing into the next chapter
  useEffect(() => {
    if (autoContinueChapterRef.current) {
      autoContinueChapterRef.current = false;
      setCurrentBatchIndex(0);
      const timer = window.setTimeout(() => {
        startPlaybackAt(0);
      }, 150);
      return () => window.clearTimeout(timer);
    }
    stopAllAudio(false);
    setCurrentBatchIndex(0);
    setBufferedAheadCount(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter.id]);

  // Triggered when user taps "Nghe AI" or "Nghe từ đây" inside ReaderView
  useEffect(() => {
    if (autoPlaySignal === 0 || autoPlaySignal === handledSignalRef.current) return;
    handledSignalRef.current = autoPlaySignal;

    let unitsToUse = batchedUnitsRef.current;
    if (autoOnDeviceAI && !analysis && activeParagraphs.length > 0 && !isTranslatedView) {
      const local = runOnDeviceCharacterScan(false);
      unitsToUse = buildBatchedPlaybackUnits(local.script, 650);
      batchedUnitsRef.current = unitsToUse;
    }

    const startBatchIdx = findBatchIndexForParagraph(
      unitsToUse,
      book.currentParagraphIndex || 0
    );
    setErrorMsg('');
    setShowMiniBar(true);
    setCurrentBatchIndex(startBatchIdx);
    startPlaybackAt(startBatchIdx, unitsToUse);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlaySignal]);

  useEffect(() => {
    onPlaybackStateChange?.(isPlaying);
  }, [isPlaying, onPlaybackStateChange]);

  const stopAllAudio = (hideBar = true) => {
    playbackRunIdRef.current += 1;
    isPlayingRef.current = false;
    setIsPlaying(false);
    setIsLoadingAudio(false);
    setPreviewingId(null);
    if (hideBar) {
      setShowMiniBar(false);
      clearMediaSession();
    } else {
      updateMediaSession(
        { title: chapter.title, artist: book.title },
        'paused'
      );
    }
    filteredPlayerRef.current?.stop();
    stopOnDeviceSpeech();
    onHighlightParagraph(null, 0);
  };

  const getAssignment = (
    charId: string,
    suggested?: GeminiVoiceName
  ): CharacterVoiceAssignment => {
    const existing = book.voiceAssignments?.[charId];
    if (existing) {
      const normalizedVoice: GeminiVoiceName = VALID_PRESET_VOICES.includes(
        existing.geminiVoice
      )
        ? existing.geminiVoice
        : 'Kore';
      return { ...existing, geminiVoice: normalizedVoice };
    }
    if (charId === 'narrator') {
      return resolveNarratorAssignmentFromDefault(defaultVoice, externalVoices);
    }
    const fallbackVoice: GeminiVoiceName =
      suggested && VALID_PRESET_VOICES.includes(suggested) ? suggested : 'Kore';
    const charPreset = CHARACTER_VOICE_POOL.find((p) => p.voiceName === fallbackVoice);
    return {
      characterId: charId,
      source: 'gemini',
      geminiVoice: fallbackVoice,
      stylePrompt: 'Tự nhiên theo ngữ cảnh nhân vật',
      browserPitch: charPreset?.browserPitch ?? 1.0,
      browserRate: charPreset?.browserRate ?? 1.0,
      toneSettings: {
        ...DEFAULT_VOICE_TONE,
        pitch: charPreset?.browserPitch ?? 1.0,
        rate: charPreset?.browserRate ?? 1.0,
      },
    };
  };

  const narratorAssign = getAssignment('narrator', 'Kore');
  const activeVoiceLabel = (() => {
    if (narratorAssign.source === 'external' && narratorAssign.externalVoiceId) {
      const ext = externalVoices.find((v) => v.id === narratorAssign.externalVoiceId);
      if (ext) return ext.name;
    }
    if (narratorAssign.source === 'browser') {
      return 'Giọng đọc trên điện thoại';
    }
    const baseLabel = GEMINI_VOICES.find((v) => v.name === narratorAssign.geminiVoice)?.label;
    if (engineMode === 'browser' || forceOnDeviceDefault) {
      return baseLabel ? `${baseLabel} (Trên máy)` : 'Giọng đọc trên điện thoại';
    }
    return baseLabel || 'Giọng đọc trên điện thoại';
  })();

  const handleAnalyzeCloudAI = async () => {
    setErrorMsg('');
    if (standaloneDeviceMode) {
      runOnDeviceCharacterScan(true);
      setInfoNotice('Chế độ độc lập trên điện thoại: đã phân tích nhân vật tức thì ngay trên CPU thiết bị.');
      return;
    }
    setIsAnalyzing(true);
    try {
      const resp = await fetch(resolveApiUrl('/api/ai/analyze-characters'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: chapter.title,
          paragraphs: chapter.paragraphs,
          readingStyle,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Không thể phân tích nhân vật bằng AI đám mây.');
      }

      const normalized: ChapterAnalysis = {
        estimatedTotalCharacters: data.estimatedTotalCharacters ?? (data.characters?.length || 1),
        readingStyle,
        summary: data.summary || '',
        characters: Array.isArray(data.characters) ? data.characters : [],
        script: Array.isArray(data.script)
          ? data.script.map((s: Record<string, unknown>, idx: number) => ({
              id: `seg-${idx}`,
              paragraphIndex: Number(s.paragraphIndex ?? 0),
              speakerId: String(s.speakerId || 'narrator'),
              speakerName: String(s.speakerName || 'Người dẫn chuyện'),
              emotionStyle: String(s.emotionStyle || 'Tự nhiên'),
              text: String(s.text || ''),
            }))
          : [],
        analyzedAt: Date.now(),
      };

      const seededAssignments: Record<string, CharacterVoiceAssignment> = {
        ...(book.voiceAssignments || {}),
        narrator:
          book.voiceAssignments?.narrator ||
          resolveNarratorAssignmentFromDefault(defaultVoice, externalVoices),
      };
      const autoMap = buildAutoVoiceAssignments(normalized.characters, seededAssignments);
      onSaveChapterAnalysis(chapter.id, normalized, autoMap);
      setInfoNotice('Đã phân tích nhân vật bằng Gemini AI đám mây.');
      setActiveTab('characters');
    } catch (err) {
      // Automatically fall back to on-device AI so user always gets character casting
      runOnDeviceCharacterScan(true);
      setInfoNotice(
        'AI đám mây tạm bận — đã tự động phân tích nhân vật ngay trên thiết bị (Offline).'
      );
      if (err instanceof Error && !err.message.includes('429')) {
        setErrorMsg('');
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleImportVoiceFile = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setErrorMsg('');
    setIsAnalyzingVoice(true);
    try {
      const file = files[0];
      const asset = await createExternalVoiceFromFile(file);
      asset.toneSettings = { ...DEFAULT_VOICE_TONE };
      asset.originType = 'imported';
      asset.originLabel = 'File voice gốc import';

      // Always run on-device Web Audio DSP analysis first (100% offline phone hardware)
      const dspProfile = await analyzeVoiceSampleOnDevice(asset.dataUrl, asset.fileName);
      asset.durationSec = dspProfile.durationSec;
      asset.analyzedProfile = {
        ...dspProfile,
        description: `File voice gốc import · ${dspProfile.description}`,
      };

      if (!standaloneDeviceMode) {
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
            const cloudProfile = await resp.json();
            asset.analyzedProfile = {
              ...asset.analyzedProfile,
              ...cloudProfile,
              description: `File voice gốc import · ${cloudProfile.description || dspProfile.description}`,
            };
          }
        } catch {
          // Keep on-device DSP profile
        }
      }

      await onAddExternalVoice(asset);
      onUpdateVoiceAssignment('narrator', {
        ...narratorAssign,
        source: 'external',
        externalVoiceId: asset.id,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể nhập tệp giọng nói.');
    } finally {
      setIsAnalyzingVoice(false);
    }
  };

  const resolveTtsParamsForSpeaker = (speakerId: string, emotionStyle: string) => {
    const assign = getAssignment(speakerId);
    const assignTone: VoiceToneSettings = assign.toneSettings || {
      ...DEFAULT_VOICE_TONE,
      pitch: assign.browserPitch,
      rate: assign.browserRate,
    };

    if (assign.source === 'external' && assign.externalVoiceId) {
      const ext = externalVoices.find((v) => v.id === assign.externalVoiceId);
      const extTone = ext?.toneSettings || assignTone;
      if (ext?.analyzedProfile) {
        return {
          voiceName: VALID_PRESET_VOICES.includes(ext.analyzedProfile.recommendedBaseVoice)
            ? ext.analyzedProfile.recommendedBaseVoice
            : assign.geminiVoice,
          stylePrompt: `${ext.analyzedProfile.stylePrompt}. Cảm xúc đoạn này: ${emotionStyle}`,
          pitch: ext.analyzedProfile.pitchHint || extTone.pitch,
          rate: ext.analyzedProfile.rateHint || extTone.rate,
          tone: extTone,
          externalAsset: ext,
        };
      }
      return {
        voiceName: assign.geminiVoice,
        stylePrompt: `${assign.stylePrompt}. Cảm xúc: ${emotionStyle}`,
        pitch: extTone.pitch,
        rate: extTone.rate,
        tone: extTone,
        externalAsset: ext,
      };
    }

    return {
      voiceName: assign.geminiVoice,
      stylePrompt: `${assign.stylePrompt}. Cảm xúc đoạn này: ${emotionStyle}`,
      pitch: assignTone.pitch || assign.browserPitch,
      rate: assignTone.rate || assign.browserRate,
      tone: assignTone,
      externalAsset: undefined,
    };
  };

  const fetchGeminiTtsUrl = async (
    text: string,
    voiceName: GeminiVoiceName,
    stylePrompt: string
  ): Promise<string> => {
    const cacheKey = `${readingStyle}|${voiceName}|${text}`;
    const cached = audioCacheRef.current.get(cacheKey);
    if (cached) return cached;

    const existingPromise = inFlightCacheRef.current.get(cacheKey);
    if (existingPromise) return existingPromise;

    const promise = (async () => {
      const resp = await fetch(resolveApiUrl('/api/ai/tts'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voiceName,
          stylePrompt,
          readingStyle,
          expressive: true,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.status === 429 || data.quotaExceeded || data.code === 'QUOTA_EXCEEDED') {
        quotaExhaustedRef.current = true;
        throw new QuotaExceededError(
          data.error ||
            'Hạn mức Google AI miễn phí tạm hết trong ngày — tự động chuyển sang giọng trên thiết bị (đa nhân vật) để nghe tiếp.'
        );
      }
      if (!resp.ok || !data.audioBase64) {
        throw new Error(data.error || 'Không tạo được âm thanh AI.');
      }
      const dataUrl = `data:${data.mimeType || 'audio/wav'};base64,${data.audioBase64}`;
      audioCacheRef.current.set(cacheKey, dataUrl);
      return dataUrl;
    })();

    inFlightCacheRef.current.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      inFlightCacheRef.current.delete(cacheKey);
    }
  };

  // Multi-page lookahead background prefetcher (sequentially preloads up to 4 batched units ahead)
  const prefetchAheadUnits = async (
    fromIndex: number,
    units: PlaybackBatchUnit[],
    runId: number
  ) => {
    if (quotaExhaustedRef.current || engineModeRef.current === 'browser') {
      setBufferedAheadCount(0);
      return;
    }

    let readyCount = 0;
    const endIdx = Math.min(units.length, fromIndex + 1 + PREFETCH_AHEAD_UNITS);

    for (let idx = fromIndex + 1; idx < endIdx; idx++) {
      if (playbackRunIdRef.current !== runId || !isPlayingRef.current || quotaExhaustedRef.current) {
        return;
      }
      const u = units[idx];
      const assign = getAssignment(u.speakerId);
      if (assign.source === 'browser') continue;

      const params = resolveTtsParamsForSpeaker(u.speakerId, u.emotionStyle);
      try {
        await fetchGeminiTtsUrl(
          u.combinedText,
          params.voiceName as GeminiVoiceName,
          params.stylePrompt
        );
        readyCount += 1;
        if (playbackRunIdRef.current === runId) {
          setBufferedAheadCount(readyCount);
        }
      } catch {
        // Stop prefetching silently on quota/network error — active playback handles fallback smoothly
        return;
      }
    }
  };

  // On-device browser speech synthesis with both onboundary AND smooth timer-driven word illumination
  const playBrowserBatch = (
    unit: PlaybackBatchUnit,
    pitch: number,
    rate: number,
    voiceURI: string | undefined,
    runId: number
  ): Promise<void> => {
    return new Promise((resolve) => {
      const text = unit.combinedText;
      const finalRate = Math.min(
        MAX_READING_SPEED,
        Math.max(MIN_READING_SPEED, rate * speedRef.current)
      );
      const startedAt = Date.now();
      // Approximate natural Vietnamese reading duration (~15 chars/sec at 1x)
      const estimatedMs = Math.max(2200, (text.length / (15 * finalRate)) * 1000);
      let sawBoundary = false;
      let lastSyncedPara = -1;
      let settled = false;

      const applyRatio = (ratio: number) => {
        if (playbackRunIdRef.current !== runId || !isPlayingRef.current) return;
        const resolved = resolveActiveHighlightInBatch(unit, ratio);
        onHighlightParagraph(resolved.paragraphIndex, resolved.paragraphRatio);
        if (resolved.paragraphIndex !== lastSyncedPara) {
          lastSyncedPara = resolved.paragraphIndex;
          onSyncReadingParagraph?.(resolved.paragraphIndex);
        }
      };

      // Immediately illuminate the opening words of the batch on the reading page
      applyRatio(0.04);

      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearInterval(progressTimer);
        if (playbackRunIdRef.current === runId && isPlayingRef.current) {
          const lastSpan = unit.spans[unit.spans.length - 1];
          if (lastSpan) onHighlightParagraph(lastSpan.paragraphIndex, 1);
        }
        resolve();
      };

      // Smooth timer drives word-by-word illumination when browser omits onboundary OR lacks system TTS voices
      const progressTimer = window.setInterval(() => {
        if (playbackRunIdRef.current !== runId || !isPlayingRef.current) {
          finish();
          return;
        }
        const elapsed = Date.now() - startedAt;
        if (!sawBoundary) {
          applyRatio(Math.min(0.98, elapsed / estimatedMs));
        }
        if (elapsed >= estimatedMs && !speechActive) {
          finish();
        }
      }, 120);

      let speechActive = false;

      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try {
          const synth = window.speechSynthesis;
          if (synth.speaking || synth.pending) synth.cancel();
          if (synth.paused) synth.resume();

          const utter = new SpeechSynthesisUtterance(text);
          const liveVoices = synth.getVoices();
          const pool = liveVoices.length > 0 ? liveVoices : browserVoices;
          const targetLang = book.language === 'en' ? 'en-US' : 'vi-VN';
          const chosenVoice = pickBestDeviceVoice(pool, targetLang, voiceURI);
          if (chosenVoice) {
            utter.voice = chosenVoice;
            utter.lang = chosenVoice.lang || targetLang;
          } else {
            utter.lang = targetLang;
          }
          utter.pitch = Math.min(1.7, Math.max(0.55, pitch));
          utter.rate = finalRate;

          utter.onstart = () => {
            speechActive = true;
          };

          utter.onboundary = (ev) => {
            if (playbackRunIdRef.current !== runId) return;
            sawBoundary = true;
            if (text.length > 0) {
              applyRatio(Math.min(1, (ev.charIndex + 8) / text.length));
            }
          };

          utter.onend = () => {
            speechActive = false;
            if (Date.now() - startedAt >= Math.min(800, estimatedMs * 0.4)) {
              finish();
            }
          };

          utter.onerror = () => {
            speechActive = false;
          };

          synth.speak(utter);
        } catch {
          speechActive = false;
        }
      }
    });
  };

  const syncMediaSessionForUnit = (unit: PlaybackBatchUnit, state: 'playing' | 'paused') => {
    updateMediaSession(
      {
        title: `${chapter.title} · ${unit.speakerName}`,
        artist: book.title,
        album: 'LaziRead Sách Nói AI',
      },
      state,
      {
        onPlay: () => {
          if (!isPlayingRef.current) {
            startPlaybackAt(currentBatchIndex);
          }
        },
        onPause: () => {
          if (isPlayingRef.current) {
            stopAllAudio(false);
          }
        },
        onPrev: () => {
          const prev = Math.max(0, currentBatchIndex - 1);
          setCurrentBatchIndex(prev);
          startPlaybackAt(prev);
        },
        onNext: () => {
          const next = Math.min(batchedUnitsRef.current.length - 1, currentBatchIndex + 1);
          setCurrentBatchIndex(next);
          startPlaybackAt(next);
        },
        onStop: () => stopAllAudio(true),
      }
    );
  };

  const startPlaybackAt = (index: number, overrideUnits?: PlaybackBatchUnit[]) => {
    const units = overrideUnits || batchedUnitsRef.current;
    if (units.length === 0) return;
    const clampedIdx = Math.max(0, Math.min(units.length - 1, index));

    playbackRunIdRef.current += 1;
    const runId = playbackRunIdRef.current;
    filteredPlayerRef.current?.stop();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    isPlayingRef.current = true;
    setIsPlaying(true);
    setShowMiniBar(true);
    setErrorMsg('');
    void playBatchAt(clampedIdx, runId, units);
  };

  const playBatchAt = async (
    index: number,
    runId: number,
    units: PlaybackBatchUnit[]
  ) => {
    if (playbackRunIdRef.current !== runId || !isPlayingRef.current) return;

    if (index >= units.length) {
      if (hasNextChapter) {
        autoContinueChapterRef.current = true;
        setInfoNotice('Tự động chuyển sang chương tiếp theo...');
        onNextChapter();
        return;
      }
      stopAllAudio(false);
      setInfoNotice('Đã đọc xong toàn bộ chương sách.');
      return;
    }

    const unit = units[index];
    setCurrentBatchIndex(index);
    syncMediaSessionForUnit(unit, 'playing');

    let lastSyncedPara = unit.firstParagraphIndex;
    onHighlightParagraph(unit.firstParagraphIndex, 0.04);
    onSyncReadingParagraph?.(unit.firstParagraphIndex);

    const assign = getAssignment(unit.speakerId);
    const params = resolveTtsParamsForSpeaker(unit.speakerId, unit.emotionStyle);
    const presetTone = getOnDeviceVoiceTone(params.voiceName as GeminiVoiceName);
    const devicePitch =
      assign.source === 'gemini' && Math.abs(params.pitch - 1.0) < 0.01
        ? presetTone.pitch
        : params.pitch;
    const deviceRate =
      assign.source === 'gemini' && Math.abs(params.rate - 1.0) < 0.01
        ? presetTone.rate
        : params.rate;

    const shouldUseBrowser =
      forceOnDeviceDefault ||
      engineModeRef.current === 'browser' ||
      assign.source === 'browser' ||
      quotaExhaustedRef.current;

    if (shouldUseBrowser) {
      setIsLoadingAudio(false);
      await playBrowserBatch(
        unit,
        devicePitch,
        deviceRate,
        assign.browserVoiceURI,
        runId
      );
      if (isPlayingRef.current && playbackRunIdRef.current === runId) {
        await playBatchAt(index + 1, runId, units);
      }
      return;
    }

    setIsLoadingAudio(true);
    try {
      let audioSrc: string;
      try {
        audioSrc = await fetchGeminiTtsUrl(
          unit.combinedText,
          params.voiceName as GeminiVoiceName,
          params.stylePrompt
        );
      } catch (firstErr) {
        if (firstErr instanceof QuotaExceededError) {
          throw firstErr;
        }
        await new Promise((r) => window.setTimeout(r, 450));
        if (playbackRunIdRef.current !== runId || !isPlayingRef.current) return;
        audioSrc = await fetchGeminiTtsUrl(
          unit.combinedText,
          params.voiceName as GeminiVoiceName,
          params.stylePrompt
        );
      }

      if (!isPlayingRef.current || playbackRunIdRef.current !== runId) return;

      void prefetchAheadUnits(index, units, runId);

      setIsLoadingAudio(false);
      await getPlayer().play(audioSrc, params.tone, speedRef.current, (ratio) => {
        if (isPlayingRef.current && playbackRunIdRef.current === runId) {
          const resolved = resolveActiveHighlightInBatch(unit, ratio);
          onHighlightParagraph(resolved.paragraphIndex, resolved.paragraphRatio);
          if (resolved.paragraphIndex !== lastSyncedPara) {
            lastSyncedPara = resolved.paragraphIndex;
            onSyncReadingParagraph?.(resolved.paragraphIndex);
          }
        }
      });

      if (isPlayingRef.current && playbackRunIdRef.current === runId) {
        await playBatchAt(index + 1, runId, units);
      }
    } catch {
      if (playbackRunIdRef.current !== runId || !isPlayingRef.current) return;
      setIsLoadingAudio(false);
      setEngineMode('browser');
      engineModeRef.current = 'browser';

      // Seamlessly continue reading on-device without interrupting the user with error alerts
      await playBrowserBatch(
        unit,
        devicePitch,
        deviceRate,
        assign.browserVoiceURI,
        runId
      );
      if (isPlayingRef.current && playbackRunIdRef.current === runId) {
        await playBatchAt(index + 1, runId, units);
      }
    }
  };

  const handleTogglePlay = () => {
    if (isPlaying) {
      stopAllAudio(false);
      return;
    }
    setErrorMsg('');
    if (isOpen && !isDesktop) {
      onClose();
    }
    startPlaybackAt(currentBatchIndex);
  };

  const handleCycleSpeed = () => {
    const idx = SPEED_OPTIONS.findIndex((v) => Math.abs(v - playbackSpeed) < 0.05);
    const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
    applyReadingSpeed(next);
  };

  const handlePreviewCharacter = async (charId: string, sampleText: string) => {
    stopAllAudio(false);
    setErrorMsg('');
    setPreviewingId(charId);
    const assign = getAssignment(charId);
    const params = resolveTtsParamsForSpeaker(charId, 'Tự nhiên');
    const textToSpeak = sampleText || 'Xin chào, đây là giọng đọc thử của LaziRead.';

    const fakeUnit: PlaybackBatchUnit = {
      id: 'preview',
      speakerId: charId,
      speakerName: charId,
      emotionStyle: 'Tự nhiên',
      combinedText: textToSpeak,
      spans: [{ segmentIndex: 0, paragraphIndex: 0, startChar: 0, endChar: textToSpeak.length, text: textToSpeak }],
      firstSegmentIndex: 0,
      lastSegmentIndex: 0,
      firstParagraphIndex: 0,
    };

    try {
      if (assign.source === 'external' && params.externalAsset?.dataUrl) {
        await getPlayer().play(params.externalAsset.dataUrl, params.tone, 1.0);
        setPreviewingId(null);
        return;
      }

      if (
        forceOnDeviceDefault ||
        engineMode === 'browser' ||
        assign.source === 'browser' ||
        quotaExhaustedRef.current
      ) {
        const presetTone = getOnDeviceVoiceTone(params.voiceName as GeminiVoiceName);
        await playBrowserBatch(
          fakeUnit,
          assign.source === 'gemini' ? presetTone.pitch : params.pitch,
          assign.source === 'gemini' ? presetTone.rate : params.rate,
          assign.browserVoiceURI,
          playbackRunIdRef.current
        );
        setPreviewingId(null);
        return;
      }

      const audioSrc = await fetchGeminiTtsUrl(
        textToSpeak,
        params.voiceName as GeminiVoiceName,
        params.stylePrompt
      );
      await getPlayer().play(audioSrc, params.tone, playbackSpeed);
      setPreviewingId(null);
    } catch {
      const presetTone = getOnDeviceVoiceTone(params.voiceName as GeminiVoiceName);
      await playBrowserBatch(
        fakeUnit,
        presetTone.pitch,
        presetTone.rate,
        assign.browserVoiceURI,
        playbackRunIdRef.current
      );
      setPreviewingId(null);
    }
  };

  const currentUnit = batchedUnits[currentBatchIndex];
  const discoveredCharCount = Math.max(0, (analysis?.characters?.length || 1) - 1);

  // Floating Mini-Bar (works on Reader page AND stays visible above bottom dock when playing in background!)
  const floatingMiniPlayer =
    (showMiniBar || isPlaying) && (!isOpen || !isReaderActive) && typeof document !== 'undefined'
      ? createPortal(
          <div
            role="region"
            aria-label="Thanh điều khiển nghe sách trực tiếp & chạy nền"
            className={`fixed left-1/2 -translate-x-1/2 z-[60] w-[calc(100%-1.5rem)] max-w-lg transition-all ${
              isReaderActive ? 'bottom-3' : 'bottom-[78px]'
            }`}
          >
            {infoNotice && (
              <div className="mb-1.5 px-3 py-1.5 rounded-2xl bg-amber-900/95 text-amber-50 text-[11px] font-medium shadow-lg flex items-center justify-between gap-2">
                <span className="line-clamp-2">{infoNotice}</span>
                <button
                  type="button"
                  onClick={() => setInfoNotice('')}
                  aria-label="Đóng thông báo"
                  className="shrink-0 p-1 rounded-full hover:bg-white/20"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {errorMsg && (
              <div className="mb-1.5 px-3 py-1.5 rounded-2xl bg-red-600 text-white text-[11px] font-medium shadow-lg flex items-center justify-between gap-2">
                <span className="line-clamp-2">{errorMsg}</span>
                <button
                  type="button"
                  onClick={() => setErrorMsg('')}
                  aria-label="Đóng thông báo lỗi"
                  className="shrink-0 p-1 rounded-full hover:bg-white/20"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            <div className="ios-glass-dock rounded-[26px] border border-white/75 dark:border-zinc-700/70 px-3 py-2 shadow-2xl flex items-center justify-between gap-2 text-stone-900 dark:text-stone-100">
              <button
                type="button"
                onClick={() => onOpenPanel?.()}
                className="min-w-0 flex-1 text-left pl-1 pr-1"
                title="Mở bảng giọng đọc & nhân vật"
              >
                <div className="text-[11px] font-semibold truncate flex items-center gap-1.5">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      isPlaying ? 'bg-amber-600 animate-pulse' : 'bg-stone-400'
                    }`}
                  />
                  <span className="truncate">
                    {!isReaderActive ? `Nghe nền · ${book.title}` : activeVoiceLabel}
                  </span>
                </div>
                <div className="text-[10px] text-stone-500 dark:text-stone-400 truncate tabular-nums">
                  {isLoadingAudio
                    ? 'Đang tải giọng AI & nạp trước...'
                    : `${currentUnit?.speakerName || 'Người dẫn chuyện'} · Cụm ${currentBatchIndex + 1}/${Math.max(1, batchedUnits.length)}${
                        bufferedAheadCount > 0 ? ` · Nạp sẵn +${bufferedAheadCount}` : ''
                      }`}
                </div>
              </button>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const prev = Math.max(0, currentBatchIndex - 1);
                    setCurrentBatchIndex(prev);
                    startPlaybackAt(prev);
                  }}
                  aria-label="Đoạn trước"
                  className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10"
                >
                  <SkipBack className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={handleTogglePlay}
                  aria-label={isPlaying ? 'Tạm dừng sách nói' : 'Phát sách nói AI'}
                  className="w-10 h-10 rounded-full bg-amber-800 text-white flex items-center justify-center hover:bg-amber-900 shadow-md"
                >
                  {isLoadingAudio ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : isPlaying ? (
                    <Pause className="w-4 h-4" />
                  ) : (
                    <Play className="w-4 h-4 ml-0.5" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const next = Math.min(batchedUnits.length - 1, currentBatchIndex + 1);
                    setCurrentBatchIndex(next);
                    startPlaybackAt(next);
                  }}
                  aria-label="Đoạn tiếp theo"
                  className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10"
                >
                  <SkipForward className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={handleCycleSpeed}
                  aria-label="Đổi tốc độ đọc"
                  className="px-2 h-8 rounded-full text-[11px] font-semibold tabular-nums bg-black/5 dark:bg-white/10"
                >
                  {formatReadingSpeed(playbackSpeed)}x
                </button>

                {isReaderActive && (
                  <button
                    type="button"
                    onClick={() => onOpenPanel?.()}
                    aria-label="Chọn giọng AI"
                    className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10 text-amber-800 dark:text-amber-400"
                  >
                    <SlidersHorizontal className="w-4 h-4" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => stopAllAudio(true)}
                  aria-label="Dừng và ẩn thanh nghe"
                  className="w-8 h-8 rounded-full flex items-center justify-center text-stone-500 hover:text-red-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  if (!isOpen || !isReaderActive) {
    return floatingMiniPlayer;
  }

  const defaultGeminiPreset = GEMINI_VOICES.find((v) => v.isDefault);
  const characterVoices = GEMINI_VOICES.filter((v) => !v.isDefault);

  const panelBody = (
    <div className="flex flex-col max-h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 dark:border-stone-800 shrink-0">
        <div className="min-w-0">
          <h2 className="text-sm sm:text-base font-display font-semibold truncate">
            Giọng Đọc AI &amp; Phân Vai Nhân Vật
          </h2>
          <p className="text-[11px] text-amber-800 dark:text-amber-400 truncate flex items-center gap-1.5">
            <Radio className="w-3 h-3 shrink-0" />
            <span>Nghe nền · Sáng từng chữ · Nạp trước nhiều trang</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng bảng chọn giọng"
          className="p-2 rounded-full text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-200/60 dark:hover:bg-stone-800 shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs + Engine Selector */}
      <div className="px-4 pt-2.5 pb-2 flex flex-wrap items-center justify-between gap-2 shrink-0 border-b border-stone-100 dark:border-stone-800/70">
        <div
          ref={drawerTabsRef}
          className="relative inline-flex p-0.5 ios-liquid-bar border border-white/75 dark:border-zinc-700/60 rounded-full gap-0.5"
        >
          <LiquidDropThumb
            thumb={drawerTabThumb}
            isGliding={drawerTabGliding}
            roundedClass="rounded-full"
          />
          <button
            type="button"
            data-liquid-key="voices"
            onClick={() => setActiveTab('voices')}
            className={`relative z-10 ios-liquid-pill px-2.5 py-1.5 text-[11px] font-medium rounded-full whitespace-nowrap ${
              activeTab === 'voices'
                ? 'text-amber-800 dark:text-amber-300 font-semibold'
                : 'text-stone-600 dark:text-stone-300'
            }`}
          >
            Giọng đọc (6)
          </button>
          <button
            type="button"
            data-liquid-key="characters"
            onClick={() => setActiveTab('characters')}
            className={`relative z-10 ios-liquid-pill px-2.5 py-1.5 text-[11px] font-medium rounded-full whitespace-nowrap ${
              activeTab === 'characters'
                ? 'text-amber-800 dark:text-amber-300 font-semibold'
                : 'text-stone-600 dark:text-stone-300'
            }`}
          >
            Nhân vật{discoveredCharCount > 0 ? ` (${discoveredCharCount})` : ''}
          </button>
          <button
            type="button"
            data-liquid-key="ambient"
            onClick={() => setActiveTab('ambient')}
            className={`relative z-10 ios-liquid-pill px-2.5 py-1.5 text-[11px] font-medium rounded-full whitespace-nowrap ${
              activeTab === 'ambient'
                ? 'text-amber-800 dark:text-amber-300 font-semibold'
                : 'text-stone-600 dark:text-stone-300'
            }`}
          >
            Nhạc nền{ambientActiveCount > 0 ? ` (${ambientActiveCount})` : ''}
          </button>
        </div>

        <select
          aria-label="Chọn bộ máy phát âm thanh"
          value={engineMode}
          onChange={(e) => {
            const mode = e.target.value as 'gemini' | 'browser';
            if (mode === 'gemini') quotaExhaustedRef.current = false;
            setEngineMode(mode);
          }}
          className="ios-liquid-pill px-2.5 py-1.5 text-[11px] font-medium rounded-full ios-liquid-bar border border-white/75 dark:border-zinc-700/60 text-stone-800 dark:text-stone-100 shrink-0"
        >
          <option value="gemini">Google AI TTS</option>
          <option value="browser">Thiết bị (Offline)</option>
        </select>
      </div>

      {/* Content-Hugging Scrollable Area (NO forced flex-1 empty tail whitespace!) */}
      <div className="overflow-y-auto overscroll-contain px-4 py-3.5 space-y-3.5 text-xs">
        {/* Compact Playback Controls */}
        <div className="p-3.5 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/60 space-y-2.5">
          <div className="space-y-2.5">
            <div className="min-w-0">
              <div className="text-xs font-semibold truncate">{activeVoiceLabel}</div>
              <div className="text-[11px] text-stone-500 tabular-nums flex items-center gap-1.5">
                <Layers className="w-3 h-3 text-amber-700 shrink-0" />
                <span>
                  Cụm {currentBatchIndex + 1}/{Math.max(1, batchedUnits.length)}
                  {bufferedAheadCount > 0
                    ? ` · Đã nạp trước +${bufferedAheadCount} cụm`
                    : ' · Tự nạp trước 4 cụm trang'}
                </span>
              </div>
            </div>

            {/* Direct Numeric Speed Input (step 0.1) + -/+ Steppers + Quick Presets */}
            <div className="space-y-2 pt-2 border-t border-stone-100 dark:border-stone-800/80">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-stone-600 dark:text-stone-400">
                  Tốc độ đọc (bước 0.1)
                </span>
                <div className="inline-flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => applyReadingSpeed(stepReadingSpeed(playbackSpeed, -1))}
                    disabled={playbackSpeed <= MIN_READING_SPEED}
                    aria-label="Giảm tốc độ đọc 0.1"
                    className="w-7 h-7 rounded-lg border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-800/80 text-sm font-semibold text-stone-800 dark:text-stone-100 hover:border-amber-700 disabled:opacity-40 flex items-center justify-center"
                  >
                    −
                  </button>
                  <div className="inline-flex items-center rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-2 h-7 focus-within:border-amber-700">
                    <input
                      type="number"
                      inputMode="decimal"
                      aria-label="Nhập tốc độ đọc (bước 0.1)"
                      min={MIN_READING_SPEED}
                      max={MAX_READING_SPEED}
                      step={READING_SPEED_STEP}
                      value={speedInputText}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setSpeedInputText(raw);
                        const num = Number(raw.replace(',', '.'));
                        if (
                          raw.trim() !== '' &&
                          Number.isFinite(num) &&
                          num >= MIN_READING_SPEED &&
                          num <= MAX_READING_SPEED
                        ) {
                          setPlaybackSpeed(Math.round(num * 10) / 10);
                        }
                      }}
                      onBlur={() => applyReadingSpeed(speedInputText)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          applyReadingSpeed(speedInputText);
                          (e.currentTarget as HTMLInputElement).blur();
                        }
                      }}
                      className="w-12 text-center text-xs font-semibold tabular-nums bg-transparent text-stone-900 dark:text-stone-100 focus:outline-none"
                    />
                    <span className="text-[11px] font-medium text-stone-500 select-none">x</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => applyReadingSpeed(stepReadingSpeed(playbackSpeed, 1))}
                    disabled={playbackSpeed >= MAX_READING_SPEED}
                    aria-label="Tăng tốc độ đọc 0.1"
                    className="w-7 h-7 rounded-lg border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-800/80 text-sm font-semibold text-stone-800 dark:text-stone-100 hover:border-amber-700 disabled:opacity-40 flex items-center justify-center"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-6 gap-1">
                {SPEED_OPTIONS.map((sp) => {
                  const active = Math.abs(playbackSpeed - sp) < 0.05;
                  return (
                    <button
                      key={sp}
                      type="button"
                      onClick={() => applyReadingSpeed(sp)}
                      className={`py-1 rounded-lg text-[10.5px] font-semibold tabular-nums transition-colors ${
                        active
                          ? 'bg-amber-800 text-white'
                          : 'bg-stone-100 dark:bg-stone-800/80 text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700'
                      }`}
                    >
                      {formatReadingSpeed(sp)}x
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                const prev = Math.max(0, currentBatchIndex - 1);
                setCurrentBatchIndex(prev);
                if (isPlaying) startPlaybackAt(prev);
              }}
              aria-label="Đoạn trước"
              className="p-2 rounded-full border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800"
            >
              <SkipBack className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={handleTogglePlay}
              aria-label={isPlaying ? 'Tạm dừng sách nói' : 'Phát sách nói AI'}
              className="inline-flex items-center gap-2 px-5 h-10 rounded-full bg-amber-800 text-white font-semibold hover:bg-amber-900 transition-colors shadow-sm"
            >
              {isLoadingAudio ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : isPlaying ? (
                <Pause className="w-4 h-4" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              <span>
                {isLoadingAudio
                  ? 'Đang nạp trang...'
                  : isPlaying
                  ? 'Tạm dừng'
                  : 'Phát & Sáng chữ'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                const next = Math.min(batchedUnits.length - 1, currentBatchIndex + 1);
                setCurrentBatchIndex(next);
                if (isPlaying) startPlaybackAt(next);
              }}
              aria-label="Đoạn tiếp theo"
              className="p-2 rounded-full border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800"
            >
              <SkipForward className="w-4 h-4" />
            </button>

            {isPlaying && (
              <button
                type="button"
                onClick={() => stopAllAudio(true)}
                aria-label="Dừng hẳn sách nói"
                className="p-2 rounded-full border border-stone-300 dark:border-stone-700 text-stone-600 hover:text-red-600"
              >
                <Square className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* On-Device Character AI Quick Toggle */}
          <label className="flex items-center justify-between gap-2 pt-2 border-t border-stone-100 dark:border-stone-800 cursor-pointer">
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-stone-700 dark:text-stone-300">
              <Cpu className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400 shrink-0" />
              <span>AI trên thiết bị tự phân tích &amp; đổi giọng nhân vật (Offline)</span>
            </span>
            <input
              type="checkbox"
              checked={autoOnDeviceAI}
              onChange={(e) => {
                const next = e.target.checked;
                setAutoOnDeviceAI(next);
                if (next && !analysis) {
                  runOnDeviceCharacterScan(false);
                }
              }}
              className="accent-amber-800 w-4 h-4 shrink-0"
            />
          </label>
        </div>

        {infoNotice && (
          <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/35 border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200 flex items-start justify-between gap-2 text-[11px]">
            <span>{infoNotice}</span>
            <button
              type="button"
              onClick={() => setInfoNotice('')}
              className="shrink-0 opacity-70 hover:opacity-100"
              aria-label="Đóng thông báo"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {errorMsg && (
          <div className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-[11px]">
            {errorMsg}
          </div>
        )}

        {activeTab === 'ambient' && (
          <AmbientSoundPanel
            compact
            customTracks={customAmbientTracks}
            onAddCustomTrack={onAddCustomAmbientTrack}
            onDeleteCustomTrack={onDeleteCustomAmbientTrack}
          />
        )}

        {activeTab === 'voices' && (
          <div className="space-y-3">
            {/* Google AI Default Narrator */}
            {defaultGeminiPreset && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold text-stone-600 dark:text-stone-400 uppercase tracking-wider">
                  Giọng gốc Google AI
                </div>
                {(() => {
                  const isSelected =
                    narratorAssign.source === 'gemini' &&
                    narratorAssign.geminiVoice === defaultGeminiPreset.name;
                  return (
                    <div
                      className={`p-2.5 rounded-2xl border transition-colors flex items-center justify-between gap-2 ${
                        isSelected
                          ? 'border-amber-700 bg-amber-50/80 dark:bg-amber-950/30'
                          : 'border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/40'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setEngineMode('gemini');
                          quotaExhaustedRef.current = false;
                          onUpdateVoiceAssignment('narrator', {
                            ...narratorAssign,
                            source: 'gemini',
                            geminiVoice: defaultGeminiPreset.name,
                          });
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex items-center gap-1.5 font-semibold text-stone-900 dark:text-stone-100">
                          {isSelected && <Check className="w-3.5 h-3.5 text-amber-700 shrink-0" />}
                          <span className="truncate">{defaultGeminiPreset.label}</span>
                          <span className="px-1.5 py-0.5 rounded-full bg-amber-800 text-white text-[9.5px] font-semibold shrink-0">
                            Gốc
                          </span>
                        </div>
                        <p className="text-[11px] text-stone-500 dark:text-stone-400 truncate mt-0.5">
                          {defaultGeminiPreset.tone}
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onUpdateVoiceAssignment('narrator', {
                            ...narratorAssign,
                            source: 'gemini',
                            geminiVoice: defaultGeminiPreset.name,
                          });
                          handlePreviewCharacter(
                            'narrator',
                            chapter.paragraphs[book.currentParagraphIndex || 0]?.slice(0, 80) ||
                              'Xin chào, đây là giọng đọc gốc Google AI của LaziRead.'
                          );
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full border border-stone-300 dark:border-stone-700 text-[11px] font-medium hover:bg-stone-100 dark:hover:bg-stone-800 shrink-0"
                      >
                        <Volume2 className="w-3 h-3" />
                        <span>{previewingId === 'narrator' && isSelected ? 'Đang phát' : 'Thử'}</span>
                      </button>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* 5 Dedicated Character AI Voices */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-stone-600 dark:text-stone-400 uppercase tracking-wider">
                  5 Giọng Nhân Vật AI trong truyện
                </span>
                <span className="text-[10.5px] text-stone-500">AI tự đổi theo thoại</span>
              </div>

              <div className="space-y-1.5">
                {characterVoices.map((gv) => {
                  const isSelected =
                    narratorAssign.source === 'gemini' && narratorAssign.geminiVoice === gv.name;
                  return (
                    <div
                      key={gv.name}
                      className={`p-2.5 rounded-2xl border transition-colors flex items-center justify-between gap-2 ${
                        isSelected
                          ? 'border-amber-700 bg-amber-50/80 dark:bg-amber-950/30'
                          : 'border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/40 hover:border-stone-400'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onUpdateVoiceAssignment('narrator', {
                            ...narratorAssign,
                            source: 'gemini',
                            geminiVoice: gv.name,
                          });
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex items-center gap-1.5 font-semibold text-stone-900 dark:text-stone-100">
                          {isSelected && <Check className="w-3.5 h-3.5 text-amber-700 shrink-0" />}
                          <span className="truncate">{gv.label}</span>
                        </div>
                        <p className="text-[10.5px] text-stone-500 dark:text-stone-400 truncate mt-0.5">
                          {gv.tone}
                        </p>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          onUpdateVoiceAssignment('narrator', {
                            ...narratorAssign,
                            source: 'gemini',
                            geminiVoice: gv.name,
                          });
                          handlePreviewCharacter(
                            'narrator',
                            chapter.paragraphs[book.currentParagraphIndex || 0]?.slice(0, 80) ||
                              'Xin chào, đây là giọng nhân vật AI của LaziRead.'
                          );
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full border border-stone-300 dark:border-stone-700 text-[11px] font-medium hover:bg-stone-100 dark:hover:bg-stone-800 shrink-0"
                      >
                        <Volume2 className="w-3 h-3" />
                        <span>{previewingId === 'narrator' && isSelected ? 'Đang phát' : 'Thử'}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Custom User-Uploaded Voices */}
            <div className="p-3 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/40 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold text-stone-900 dark:text-stone-100">
                    Giọng tự tải vào ({externalVoices.length})
                  </h3>
                  <p className="text-[10.5px] text-stone-500">
                    Tải file .mp3 / .wav / .m4a làm giọng đọc riêng
                  </p>
                </div>

                <input
                  ref={voiceFileRef}
                  type="file"
                  accept="audio/*,.mp3,.wav,.ogg,.m4a"
                  className="hidden"
                  onChange={(e) => handleImportVoiceFile(e.target.files)}
                />
                <button
                  type="button"
                  disabled={isAnalyzingVoice}
                  onClick={() => voiceFileRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-[11px] font-semibold shrink-0 disabled:opacity-50"
                >
                  {isAnalyzingVoice ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5" />
                  )}
                  <span>Tự tải giọng</span>
                </button>
              </div>

              {externalVoices.length > 0 && (
                <div className="space-y-1.5">
                  {externalVoices.map((ev) => {
                    const activeExt =
                      narratorAssign.source === 'external' &&
                      narratorAssign.externalVoiceId === ev.id;
                    return (
                      <button
                        key={ev.id}
                        type="button"
                        onClick={() => {
                          onUpdateVoiceAssignment('narrator', {
                            ...narratorAssign,
                            source: 'external',
                            externalVoiceId: ev.id,
                          });
                        }}
                        className={`w-full text-left p-2 rounded-xl border flex items-center justify-between gap-2 ${
                          activeExt
                            ? 'border-amber-700 bg-amber-50/80 dark:bg-amber-950/30 font-semibold'
                            : 'border-stone-200 dark:border-stone-800 hover:border-stone-400'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="truncate">{ev.name}</div>
                          <div className="text-[10px] text-stone-500 truncate">{ev.fileName}</div>
                        </div>
                        {activeExt && <Check className="w-4 h-4 text-amber-700 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'characters' && (
          <div className="space-y-3">
            {/* On-Device Local AI + Cloud AI Scanner Card */}
            <div className="p-3.5 rounded-2xl border border-amber-800/30 bg-amber-50/70 dark:bg-amber-950/25 space-y-2.5">
              <div className="font-semibold text-stone-900 dark:text-stone-100 flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400 shrink-0" />
                <span>AI Tự Phân Tích Nhân Vật &amp; Đổi Giọng</span>
              </div>
              <p className="text-[11px] text-stone-600 dark:text-stone-400 leading-relaxed">
                {analysis?.summary ||
                  'AI chạy cục bộ trực tiếp trên thiết bị (không cần mạng, tức thì) sẽ tự tách lời thoại, đoán giới tính và gán 5 giọng nhân vật riêng biệt.'}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const res = runOnDeviceCharacterScan(true);
                    setInfoNotice(
                      `AI trên thiết bị đã quét xong: ${Math.max(0, res.characters.length - 1)} nhân vật được tự động phân giọng.`
                    );
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-800 text-white text-[11px] font-semibold hover:bg-amber-900"
                >
                  <Cpu className="w-3.5 h-3.5" />
                  <span>AI Thiết Bị (Offline)</span>
                </button>

                <button
                  type="button"
                  disabled={isAnalyzing}
                  onClick={handleAnalyzeCloudAI}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-amber-800/40 bg-white/80 dark:bg-stone-900 text-amber-900 dark:text-amber-300 text-[11px] font-medium hover:bg-amber-100/60 disabled:opacity-50"
                >
                  {isAnalyzing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  <span>{isAnalyzing ? 'Đang quét...' : 'Phân tích sâu (Cloud)'}</span>
                </button>
              </div>
            </div>

            <div className="space-y-2.5">
              {(analysis?.characters && analysis.characters.length > 0
                ? analysis.characters
                : [
                    {
                      id: 'narrator',
                      name: readingStyle === 'selfhelp' ? 'Diễn giả chính' : 'Người dẫn chuyện',
                      role: 'narrator' as const,
                      gender: 'neutral' as const,
                      ageGroup: 'Trưởng thành',
                      voiceDescription: STYLE_LABELS[readingStyle],
                      suggestedVoiceName: 'Kore' as GeminiVoiceName,
                      lineCount: chapter.paragraphs.length,
                      sampleQuote: chapter.paragraphs[0]?.slice(0, 100) || '',
                    },
                  ]
              ).map((char) => {
                const assign = getAssignment(char.id, char.suggestedVoiceName);
                return (
                  <div
                    key={char.id}
                    className="p-3 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/40 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-xs sm:text-sm text-stone-900 dark:text-stone-100 truncate">
                          {char.name}
                        </div>
                        <div className="text-[10.5px] text-stone-500">
                          {ROLE_LABELS[char.role] || char.role} · {char.lineCount} lời thoại
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          handlePreviewCharacter(
                            char.id,
                            char.sampleQuote || char.voiceDescription
                          )
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-stone-300 dark:border-stone-700 text-[11px] hover:bg-stone-100 dark:hover:bg-stone-800 shrink-0"
                      >
                        <Volume2 className="w-3 h-3" />
                        <span>{previewingId === char.id ? 'Đang phát' : 'Thử'}</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-1 p-0.5 bg-stone-100 dark:bg-stone-800 rounded-full">
                      {(
                        [
                          { id: 'gemini', label: 'Voice AI' },
                          { id: 'external', label: `Tự tải (${externalVoices.length})` },
                          { id: 'browser', label: 'Offline' },
                        ] as Array<{ id: CharacterVoiceSource; label: string }>
                      ).map((src) => (
                        <button
                          key={src.id}
                          type="button"
                          onClick={() =>
                            onUpdateVoiceAssignment(char.id, { ...assign, source: src.id })
                          }
                          className={`py-1 rounded-full text-[11px] font-medium transition-colors ${
                            assign.source === src.id
                              ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 shadow-xs'
                              : 'text-stone-500'
                          }`}
                        >
                          {src.label}
                        </button>
                      ))}
                    </div>

                    {assign.source === 'gemini' && (
                      <div className="space-y-1.5">
                        <select
                          aria-label={`Chọn giọng AI cho ${char.name}`}
                          value={assign.geminiVoice}
                          onChange={(e) =>
                            onUpdateVoiceAssignment(char.id, {
                              ...assign,
                              geminiVoice: e.target.value as GeminiVoiceName,
                            })
                          }
                          className="w-full px-2.5 py-1.5 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-xs"
                        >
                          {GEMINI_VOICES.map((gv) => (
                            <option key={gv.name} value={gv.name}>
                              {gv.label}
                            </option>
                          ))}
                        </select>
                        <div className="flex flex-wrap gap-1">
                          {QUICK_EMOTION_PROMPTS.map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() =>
                                onUpdateVoiceAssignment(char.id, {
                                  ...assign,
                                  stylePrompt: preset,
                                })
                              }
                              className="px-2 py-0.5 rounded-full border border-stone-200 dark:border-stone-700 text-[10px] hover:border-amber-800"
                            >
                              {preset.split(',')[0]}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {assign.source === 'external' && (
                      <div>
                        {externalVoices.length === 0 ? (
                          <p className="text-[11px] text-amber-800 dark:text-amber-400">
                            Chưa có giọng tự tải. Vào tab &ldquo;Giọng đọc&rdquo; và bấm &ldquo;Tự tải giọng&rdquo;.
                          </p>
                        ) : (
                          <select
                            aria-label={`Chọn tệp giọng ngoài cho ${char.name}`}
                            value={assign.externalVoiceId || externalVoices[0]?.id || ''}
                            onChange={(e) =>
                              onUpdateVoiceAssignment(char.id, {
                                ...assign,
                                externalVoiceId: e.target.value,
                              })
                            }
                            className="w-full px-2.5 py-1.5 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-xs"
                          >
                            {externalVoices.map((ev) => (
                              <option key={ev.id} value={ev.id}>
                                {ev.name} ({ev.fileName})
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // Mobile (<1024px): Render via Portal as a compact CONTENT-HUGGING bottom sheet (ZERO trailing blank space!)
  if (!isDesktop && typeof document !== 'undefined') {
    return (
      <>
        {createPortal(
          <div className="fixed inset-0 z-[70] flex items-end justify-center">
            <div
              className="fixed inset-0 bg-black/35 backdrop-blur-[2px]"
              onClick={onClose}
              aria-hidden="true"
            />
            <aside
              aria-label="Phòng thu sách nói AI và phân vai nhân vật"
              className="relative z-10 w-full max-w-lg h-auto max-h-[82dvh] rounded-t-[28px] bg-[#FBF9F5]/98 dark:bg-[#16181C]/98 backdrop-blur-xl text-stone-900 dark:text-stone-100 border-t border-x border-stone-200/90 dark:border-stone-800 shadow-2xl flex flex-col overflow-hidden"
            >
              <div className="w-10 h-1 rounded-full bg-stone-300 dark:bg-stone-700 mx-auto mt-2 shrink-0" />
              {panelBody}
            </aside>
          </div>,
          document.body
        )}
        {floatingMiniPlayer}
      </>
    );
  }

  // Desktop (>=1024px): Sticky side panel that hugs its exact content height (NO empty whitespace below!)
  return (
    <>
      <aside
        aria-label="Phòng thu sách nói AI và phân vai nhân vật"
        className="w-[400px] shrink-0 sticky top-[52px] self-start h-auto max-h-[calc(100vh-52px)] bg-[#FBF9F5]/95 dark:bg-[#16181C]/95 backdrop-blur-xl text-stone-900 dark:text-stone-100 border-l border-b border-stone-200/80 dark:border-stone-800 rounded-bl-2xl shadow-lg flex flex-col overflow-hidden"
      >
        {panelBody}
      </aside>
      {floatingMiniPlayer}
    </>
  );
};
