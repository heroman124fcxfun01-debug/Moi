import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  Square,
  ChevronLeft,
  ChevronDown,
  Users,
  Music,
} from 'lucide-react';
import type {
  Book,
  BookReadingStyle,
  Chapter,
  ChapterAnalysis,
  CharacterVoiceAssignment,
  CustomAmbientTrack,
  DefaultVoiceSelection,
  ExternalVoiceAsset,
  GeminiVoiceName,
  VoiceToneSettings,
} from '../types/book';
import { GEMINI_VOICES } from '../utils/fileHelpers';
import {
  DEFAULT_VOICE_TONE,
  FilteredAudioPlayer,
  MAX_READING_SPEED,
  MIN_READING_SPEED,
  READING_SPEED_STEP,
  clearMediaSession,
  formatReadingSpeed,
  normalizeReadingSpeed,
  stepReadingSpeed,
  updateMediaSession,
} from '../utils/audioFilterEngine';
import { ambientSoundManager } from '../utils/ambientSoundEngine';
import {
  computeExternalVoiceSpeechParams,
  getOnDeviceVoiceTone,
  mapLangCodeToSpeechLocale,
  speakOnDevice,
  startAudioFocusKeepalive,
  stopAudioFocusKeepalive,
  stopOnDeviceSpeech,
  unlockAudioPlaybackSync,
} from '../utils/deviceTtsEngine';
import {
  analyzeChapterOnDevice,
  buildAutoVoiceAssignments,
  CHARACTER_VOICE_POOL,
  computeReadingStyleModulation,
  READING_VOICE_STYLES,
} from '../utils/onDeviceCharacterAI';
import {
  buildBatchedPlaybackUnits,
  findBatchIndexForParagraph,
  resolveActiveHighlightInBatch,
  type PlaybackBatchUnit,
} from '../utils/audiobookPrefetch';
import { resolveNarratorAssignmentFromDefault } from '../utils/studioCatalog';
import { AmbientSoundPanel } from './AmbientSoundPanel';
import { GlassSelect, type GlassSelectOption } from './GlassSelect';

interface AudiobookStudioDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onBackToToolsMenu?: () => void;
  onOpenPanel?: () => void;
  isReaderActive?: boolean;
  hasPaginatedFooter?: boolean;
  highlightSpokenText?: boolean;
  onToggleHighlightSpoken?: (next: boolean) => void;
  onMiniPlayerVisibilityChange?: (visible: boolean) => void;
  onSessionActiveChange?: (active: boolean) => void;
  book: Book;
  chapter: Chapter;
  hasNextChapter?: boolean;
  displayedParagraphs?: string[];
  ttsLanguageCode?: string;
  autoPlaySignal?: number;
  togglePlaySignal?: number;
  onSaveChapterAnalysis: (
    chapterId: string,
    analysis: ChapterAnalysis,
    mergedVoiceAssignments?: Record<string, CharacterVoiceAssignment>
  ) => void;
  onUpdateVoiceAssignment: (
    characterId: string,
    assignment: CharacterVoiceAssignment
  ) => void;
  onBatchUpdateVoiceAssignments?: (
    assignments: Record<string, CharacterVoiceAssignment>
  ) => void;
  onUpdateReadingStyle?: (style: BookReadingStyle) => void;
  externalVoices: ExternalVoiceAsset[];
  onAddExternalVoice?: (voice: ExternalVoiceAsset) => Promise<void>;
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
  narrator: 'Người dẫn chuyện',
  protagonist: 'Nhân vật chính',
  supporting: 'Nhân vật phụ',
  antagonist: 'Phản diện',
};

const PLAYBACK_SPEED_STORAGE_KEY = 'laziread_playback_speed';

const VALID_PRESET_VOICES: GeminiVoiceName[] = [
  'Kore',
  'Charon',
  'Zephyr',
  'Fenrir',
  'Puck',
  'Aoede',
];

const BUILTIN_VOICE_LABELS: Record<GeminiVoiceName, string> = {
  Kore: 'Giọng mặc định · Nữ truyền cảm',
  Charon: 'Nam trầm ấm',
  Zephyr: 'Nữ nhẹ nhàng',
  Fenrir: 'Nam mạnh mẽ',
  Puck: 'Nam trẻ trung',
  Aoede: 'Nữ du dương',
};

export const AudiobookStudioDrawer: React.FC<AudiobookStudioDrawerProps> = ({
  isOpen,
  onClose,
  onBackToToolsMenu,
  onOpenPanel,
  isReaderActive = true,
  hasPaginatedFooter = false,
  highlightSpokenText = true,
  onToggleHighlightSpoken,
  onMiniPlayerVisibilityChange,
  onSessionActiveChange,
  book,
  chapter,
  hasNextChapter = false,
  displayedParagraphs,
  ttsLanguageCode,
  autoPlaySignal = 0,
  togglePlaySignal = 0,
  onSaveChapterAnalysis,
  onUpdateVoiceAssignment,
  onBatchUpdateVoiceAssignments,
  onUpdateReadingStyle,
  externalVoices,
  customAmbientTracks = [],
  onAddCustomAmbientTrack = async () => {},
  onDeleteCustomAmbientTrack = async () => {},
  onHighlightParagraph,
  onSyncReadingParagraph,
  onPlaybackStateChange,
  onNextChapter,
  defaultVoice,
}) => {
  const [ambientActiveCount, setAmbientActiveCount] = useState(
    () => Object.keys(ambientSoundManager.getSnapshot().activeVolumes).length
  );
  const [showAmbientSection, setShowAmbientSection] = useState(false);
  const [infoNotice, setInfoNotice] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    return ambientSoundManager.subscribe((snap) => {
      setAmbientActiveCount(Object.keys(snap.activeVolumes).length);
    });
  }, []);

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
  const [showMiniBar, setShowMiniBar] = useState(false);
  const [currentBatchIndex, setCurrentBatchIndex] = useState(0);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );
  // Local draft map for character voices so page-turns while listening NEVER overwrite or interrupt editing
  const [draftCharAssignments, setDraftCharAssignments] = useState<
    Record<string, CharacterVoiceAssignment>
  >({});
  const [hasPendingCharEdits, setHasPendingCharEdits] = useState(false);

  const filteredPlayerRef = useRef<FilteredAudioPlayer | null>(null);
  const isPlayingRef = useRef(false);
  const playbackRunIdRef = useRef(0);
  const handledSignalRef = useRef(0);
  const handledToggleSignalRef = useRef(0);
  const autoContinueChapterRef = useRef(false);
  const speedRef = useRef(playbackSpeed);
  const currentBatchIndexRef = useRef(currentBatchIndex);

  // Live refs prevent stale closures during async playback loops & prevent page-turns from clobbering edits
  const bookRef = useRef(book);
  const chapterRef = useRef(chapter);
  const defaultVoiceRef = useRef(defaultVoice);
  const externalVoicesRef = useRef(externalVoices);
  const ttsLanguageCodeRef = useRef(ttsLanguageCode);
  const hasNextChapterRef = useRef(hasNextChapter);
  const onHighlightParagraphRef = useRef(onHighlightParagraph);
  const onSyncReadingParagraphRef = useRef(onSyncReadingParagraph);
  const onNextChapterRef = useRef(onNextChapter);

  bookRef.current = book;
  chapterRef.current = chapter;
  defaultVoiceRef.current = defaultVoice;
  externalVoicesRef.current = externalVoices;
  ttsLanguageCodeRef.current = ttsLanguageCode;
  hasNextChapterRef.current = hasNextChapter;
  onHighlightParagraphRef.current = onHighlightParagraph;
  onSyncReadingParagraphRef.current = onSyncReadingParagraph;
  onNextChapterRef.current = onNextChapter;
  currentBatchIndexRef.current = currentBatchIndex;

  useEffect(() => {
    setDraftCharAssignments({});
    setHasPendingCharEdits(false);
  }, [book.id]);

  const applyReadingSpeed = (nextRaw: number | string) => {
    const normalized = normalizeReadingSpeed(nextRaw, playbackSpeed);
    setPlaybackSpeed(normalized);
    setSpeedInputText(formatReadingSpeed(normalized));
    speedRef.current = normalized;
    filteredPlayerRef.current?.setSpeed(normalized);
    if (isPlayingRef.current) {
      hotReloadCurrentPlayback({ speedOverride: normalized });
    }
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
    if (typeof window === 'undefined') return;
    const onResize = () => setIsDesktop(window.innerWidth >= 1024);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const loadVoices = () => {
      const raw = window.speechSynthesis.getVoices() || [];
      const vi = raw.filter((v) => v.lang.toLowerCase().startsWith('vi'));
      setBrowserVoices(vi.slice(0, 6));
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
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

  useEffect(() => {
    return () => {
      playbackRunIdRef.current += 1;
      filteredPlayerRef.current?.dispose();
      clearMediaSession();
      stopOnDeviceSpeech();
      stopAudioFocusKeepalive();
    };
  }, []);

  const effectiveScript = useMemo(() => {
    if (analysis?.script && analysis.script.length > 0 && !isTranslatedView) {
      return analysis.script;
    }
    return activeParagraphs.map((p, idx) => ({
      id: `para-${idx}`,
      paragraphIndex: idx,
      speakerId: 'narrator',
      speakerName: readingStyle === 'selfhelp' ? 'Diễn giả chính' : 'Người dẫn chuyện',
      emotionStyle: 'Truyền cảm, tự nhiên',
      text: p,
    }));
  }, [analysis?.script, isTranslatedView, activeParagraphs, readingStyle]);

  const batchedUnits = useMemo(
    () => buildBatchedPlaybackUnits(effectiveScript, 650),
    [effectiveScript]
  );

  const batchedUnitsRef = useRef<PlaybackBatchUnit[]>(batchedUnits);
  useEffect(() => {
    batchedUnitsRef.current = batchedUnits;
  }, [batchedUnits]);

  const runOnDeviceCharacterScan = (): ChapterAnalysis => {
    const liveBook = bookRef.current;
    const liveExt = externalVoicesRef.current;
    const localAnalysis = analyzeChapterOnDevice(
      chapter.title,
      activeParagraphs,
      readingStyle
    );
    const seededAssignments: Record<string, CharacterVoiceAssignment> = {
      ...(liveBook.voiceAssignments || {}),
      narrator:
        liveBook.voiceAssignments?.narrator ||
        resolveNarratorAssignmentFromDefault(defaultVoiceRef.current, liveExt),
    };
    // Assign distinct voices to each discovered character (never flatten everyone to 1 voice)
    const autoMap = buildAutoVoiceAssignments(localAnalysis.characters, seededAssignments, {
      inheritNarratorVoice: false,
    });
    onSaveChapterAnalysis(chapter.id, localAnalysis, autoMap);
    // Pre-populate local draft map so user can review/edit voices and tap "Xác nhận"
    const nextDrafts: Record<string, CharacterVoiceAssignment> = {};
    for (const ch of localAnalysis.characters) {
      if (ch.id !== 'narrator' && autoMap[ch.id]) {
        nextDrafts[ch.id] = autoMap[ch.id];
      }
    }
    setDraftCharAssignments(nextDrafts);
    setHasPendingCharEdits(Object.keys(nextDrafts).length > 0);
    return localAnalysis;
  };

  // Hot-reload active audio whenever global defaultVoice changes from Studio while playing
  const lastDefaultVoiceKeyRef = useRef<string>(defaultVoice?.id || '');
  useEffect(() => {
    const nextKey = defaultVoice?.id || '';
    if (nextKey && nextKey !== lastDefaultVoiceKeyRef.current) {
      lastDefaultVoiceKeyRef.current = nextKey;
      if (isPlayingRef.current) {
        const nextNarrator = resolveNarratorAssignmentFromDefault(
          defaultVoice,
          externalVoicesRef.current
        );
        hotReloadCurrentPlayback({
          voiceOverrides: {
            ...(bookRef.current.voiceAssignments || {}),
            narrator: nextNarrator,
          },
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultVoice?.id]);

  useEffect(() => {
    if (autoContinueChapterRef.current) {
      autoContinueChapterRef.current = false;
      setCurrentBatchIndex(0);
      currentBatchIndexRef.current = 0;
      const timer = window.setTimeout(() => {
        startPlaybackAt(0);
      }, 150);
      return () => window.clearTimeout(timer);
    }
    stopAllAudio(false);
    setCurrentBatchIndex(0);
    currentBatchIndexRef.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter.id]);

  // Triggered when user taps "Nghe từ đây" inside long-press menu
  useEffect(() => {
    if (autoPlaySignal === 0 || autoPlaySignal === handledSignalRef.current) return;
    handledSignalRef.current = autoPlaySignal;

    const unitsToUse = batchedUnitsRef.current;
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

  // Triggered when user taps Play/Pause button in the Reader top bar
  useEffect(() => {
    if (togglePlaySignal === 0 || togglePlaySignal === handledToggleSignalRef.current) return;
    handledToggleSignalRef.current = togglePlaySignal;
    if (isPlayingRef.current) {
      stopAllAudio(false);
    } else {
      const unitsToUse = batchedUnitsRef.current;
      const startBatchIdx =
        showMiniBar && currentBatchIndex > 0
          ? currentBatchIndex
          : findBatchIndexForParagraph(unitsToUse, book.currentParagraphIndex || 0);
      setErrorMsg('');
      setShowMiniBar(true);
      setCurrentBatchIndex(startBatchIdx);
      startPlaybackAt(startBatchIdx, unitsToUse);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [togglePlaySignal]);

  useEffect(() => {
    onPlaybackStateChange?.(isPlaying);
  }, [isPlaying, onPlaybackStateChange]);

  useEffect(() => {
    onSessionActiveChange?.(showMiniBar || isPlaying);
  }, [showMiniBar, isPlaying, onSessionActiveChange]);

  // Inside ReaderView, NEVER render bottom mini-player (spinning disc handles access cleanly).
  // Outside ReaderView (background listening across Library/Community/Studio), keep slim mini-bar.
  const miniPlayerVisible = (showMiniBar || isPlaying) && !isReaderActive;
  useEffect(() => {
    onMiniPlayerVisibilityChange?.(miniPlayerVisible);
  }, [miniPlayerVisible, onMiniPlayerVisibilityChange]);

  const stopAllAudio = (hideBar = true) => {
    playbackRunIdRef.current += 1;
    isPlayingRef.current = false;
    setIsPlaying(false);
    setPreviewingId(null);
    stopAudioFocusKeepalive();
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
    suggested?: GeminiVoiceName,
    overrideMap?: Record<string, CharacterVoiceAssignment>
  ): CharacterVoiceAssignment => {
    const liveBook = bookRef.current;
    const liveExt = externalVoicesRef.current;
    const liveDefault = defaultVoiceRef.current;
    const existing = overrideMap?.[charId] || liveBook.voiceAssignments?.[charId];
    if (existing) {
      const normalizedVoice: GeminiVoiceName = VALID_PRESET_VOICES.includes(
        existing.geminiVoice
      )
        ? existing.geminiVoice
        : 'Kore';
      return { ...existing, geminiVoice: normalizedVoice };
    }
    if (charId === 'narrator') {
      return resolveNarratorAssignmentFromDefault(liveDefault, liveExt);
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

  const formatAssignmentLabel = (assign: CharacterVoiceAssignment): string => {
    if (assign.source === 'external' && assign.externalVoiceId) {
      const ext = externalVoices.find((v) => v.id === assign.externalVoiceId);
      if (ext) return ext.name;
    }
    if (assign.source === 'browser' && assign.browserVoiceURI) {
      const bv = browserVoices.find((v) => v.voiceURI === assign.browserVoiceURI);
      if (bv) return bv.name;
    }
    return BUILTIN_VOICE_LABELS[assign.geminiVoice] || 'Giọng mặc định · Nữ truyền cảm';
  };

  const activeVoiceLabel = formatAssignmentLabel(narratorAssign);

  // Unified flat list of all selectable voice choices (Built-in + Studio/External + Device)
  const unifiedVoiceChoices = useMemo(() => {
    const items: Array<{
      key: string;
      label: string;
      source: CharacterVoiceAssignment['source'];
      geminiVoice: GeminiVoiceName;
      externalVoiceId?: string;
      browserVoiceURI?: string;
    }> = [];

    for (const gv of GEMINI_VOICES) {
      items.push({
        key: `gemini:${gv.name}`,
        label: BUILTIN_VOICE_LABELS[gv.name] || gv.label,
        source: 'gemini',
        geminiVoice: gv.name,
      });
    }
    for (const ev of externalVoices) {
      items.push({
        key: `external:${ev.id}`,
        label: ev.name,
        source: 'external',
        geminiVoice: ev.analyzedProfile?.recommendedBaseVoice || 'Kore',
        externalVoiceId: ev.id,
      });
    }
    for (const bv of browserVoices) {
      items.push({
        key: `browser:${bv.voiceURI}`,
        label: bv.name,
        source: 'browser',
        geminiVoice: 'Kore',
        browserVoiceURI: bv.voiceURI,
      });
    }
    return items;
  }, [externalVoices, browserVoices]);

  const voiceSelectOptions = useMemo<GlassSelectOption[]>(
    () =>
      unifiedVoiceChoices.map((vc) => ({
        value: vc.key,
        label: vc.label,
        subtitle:
          vc.source === 'external'
            ? 'Giọng Studio cá nhân'
            : vc.source === 'browser'
            ? 'Giọng hệ thống trên máy'
            : 'Giọng đọc chuẩn BOOKHAD',
      })),
    [unifiedVoiceChoices]
  );

  const readingStyleOptions = useMemo<GlassSelectOption<BookReadingStyle>[]>(
    () =>
      READING_VOICE_STYLES.map((s) => ({
        value: s.id,
        label: s.label,
        subtitle: s.description,
      })),
    []
  );

  const currentNarratorChoiceKey =
    narratorAssign.source === 'external' && narratorAssign.externalVoiceId
      ? `external:${narratorAssign.externalVoiceId}`
      : narratorAssign.source === 'browser' && narratorAssign.browserVoiceURI
      ? `browser:${narratorAssign.browserVoiceURI}`
      : `gemini:${narratorAssign.geminiVoice}`;

  const resolveTtsParamsForSpeaker = (
    speakerId: string,
    emotionStyle: string,
    overrideAssign?: CharacterVoiceAssignment,
    overrideMap?: Record<string, CharacterVoiceAssignment>,
    overrideStyle?: BookReadingStyle
  ) => {
    const liveBook = bookRef.current;
    const liveExt = externalVoicesRef.current;
    const activeStyle: BookReadingStyle = overrideStyle || liveBook.readingStyle || 'novel';
    const assign = overrideAssign || getAssignment(speakerId, undefined, overrideMap);
    const assignTone: VoiceToneSettings = assign.toneSettings || {
      ...DEFAULT_VOICE_TONE,
      pitch: assign.browserPitch,
      rate: assign.browserRate,
    };

    if (assign.source === 'external' && assign.externalVoiceId) {
      const ext = liveExt.find((v) => v.id === assign.externalVoiceId);
      if (ext) {
        const extSpeech = computeExternalVoiceSpeechParams(ext);
        const modulated = computeReadingStyleModulation(
          activeStyle,
          emotionStyle,
          extSpeech.pitch,
          extSpeech.rate
        );
        return {
          voiceName: extSpeech.baseVoice,
          stylePrompt: `${ext.analyzedProfile?.stylePrompt || assign.stylePrompt}. ${modulated.stylePrompt}`,
          pitch: modulated.pitch,
          rate: modulated.rate,
          preferGender: extSpeech.preferGender,
          voiceSlotIndex: extSpeech.voiceSlotIndex,
          voiceURI: undefined as string | undefined,
          tone: ext.toneSettings || assignTone,
          externalAsset: ext,
        };
      }
    }

    if (assign.source === 'browser' && assign.browserVoiceURI) {
      const modulated = computeReadingStyleModulation(
        activeStyle,
        emotionStyle,
        assignTone.pitch || assign.browserPitch || 1.0,
        assignTone.rate || assign.browserRate || 1.0
      );
      return {
        voiceName: assign.geminiVoice,
        stylePrompt: `${assign.stylePrompt}. ${modulated.stylePrompt}`,
        pitch: modulated.pitch,
        rate: modulated.rate,
        preferGender: 'neutral' as const,
        voiceSlotIndex: 0,
        voiceURI: assign.browserVoiceURI,
        tone: assignTone,
        externalAsset: undefined,
      };
    }

    const presetTone = getOnDeviceVoiceTone(assign.geminiVoice as GeminiVoiceName);
    // Always use the chosen preset's distinct acoustic pitch/rate/gender/voiceSlotIndex!
    const modulated = computeReadingStyleModulation(
      activeStyle,
      emotionStyle,
      presetTone.pitch,
      presetTone.rate
    );

    return {
      voiceName: assign.geminiVoice,
      stylePrompt: `${assign.stylePrompt}. ${modulated.stylePrompt}`,
      pitch: modulated.pitch,
      rate: modulated.rate,
      preferGender: presetTone.preferGender,
      voiceSlotIndex: presetTone.voiceSlotIndex,
      voiceURI: assign.browserVoiceURI,
      tone: assignTone,
      externalAsset: undefined,
    };
  };

  const playBrowserBatch = async (
    unit: PlaybackBatchUnit,
    pitch: number,
    rate: number,
    voiceURI: string | undefined,
    runId: number,
    preferGender?: 'female' | 'male' | 'neutral',
    voiceSlotIndex = 0,
    speedOverride?: number
  ): Promise<boolean> => {
    const text = unit.combinedText;
    const activeSpeed = speedOverride ?? speedRef.current;
    const finalRate = Math.min(
      MAX_READING_SPEED,
      Math.max(MIN_READING_SPEED, rate * activeSpeed)
    );
    const targetLang = mapLangCodeToSpeechLocale(
      ttsLanguageCodeRef.current || bookRef.current.language
    );
    let lastSyncedPara = -1;

    const applyRatio = (ratio: number) => {
      if (playbackRunIdRef.current !== runId || !isPlayingRef.current) return;
      const resolved = resolveActiveHighlightInBatch(unit, ratio);
      onHighlightParagraphRef.current(resolved.paragraphIndex, resolved.paragraphRatio);
      if (resolved.paragraphIndex !== lastSyncedPara) {
        lastSyncedPara = resolved.paragraphIndex;
        onSyncReadingParagraphRef.current?.(resolved.paragraphIndex);
      }
    };

    const ok = await speakOnDevice({
      text,
      lang: targetLang,
      pitch,
      rate: finalRate,
      voiceURI,
      preferGender,
      voiceSlotIndex,
      onStart: () => {
        applyRatio(0.03);
      },
      onBoundary: (charIndex) => {
        if (text.length > 0) {
          applyRatio(Math.min(0.99, (charIndex + 8) / text.length));
        }
      },
    });

    if (ok && playbackRunIdRef.current === runId && isPlayingRef.current) {
      const lastSpan = unit.spans[unit.spans.length - 1];
      if (lastSpan) onHighlightParagraphRef.current(lastSpan.paragraphIndex, 1);
    }
    return ok;
  };

  const syncMediaSessionForUnit = (unit: PlaybackBatchUnit, state: 'playing' | 'paused') => {
    updateMediaSession(
      {
        title: `${chapterRef.current.title} · ${unit.speakerName}`,
        artist: bookRef.current.title,
        album: 'BOOKHAD Sách Nói',
      },
      state,
      {
        onPlay: () => {
          unlockAudioPlaybackSync();
          if (!isPlayingRef.current) {
            startPlaybackAt(currentBatchIndexRef.current);
          }
        },
        onPause: () => {
          if (isPlayingRef.current) {
            stopAllAudio(false);
          }
        },
        onPrev: () => {
          unlockAudioPlaybackSync();
          const prev = Math.max(0, currentBatchIndexRef.current - 1);
          setCurrentBatchIndex(prev);
          currentBatchIndexRef.current = prev;
          startPlaybackAt(prev);
        },
        onNext: () => {
          unlockAudioPlaybackSync();
          const next = Math.min(
            batchedUnitsRef.current.length - 1,
            currentBatchIndexRef.current + 1
          );
          setCurrentBatchIndex(next);
          currentBatchIndexRef.current = next;
          startPlaybackAt(next);
        },
        onStop: () => stopAllAudio(true),
      }
    );
  };

  const hotReloadCurrentPlayback = (opts?: {
    voiceOverrides?: Record<string, CharacterVoiceAssignment>;
    styleOverride?: BookReadingStyle;
    speedOverride?: number;
  }) => {
    if (!isPlayingRef.current) return;
    const units = batchedUnitsRef.current;
    if (units.length === 0) return;
    const idx = Math.max(0, Math.min(units.length - 1, currentBatchIndexRef.current));

    playbackRunIdRef.current += 1;
    const runId = playbackRunIdRef.current;
    filteredPlayerRef.current?.stop();
    stopOnDeviceSpeech();
    void playBatchAt(idx, runId, units, opts);
  };

  const startPlaybackAt = (
    index: number,
    overrideUnits?: PlaybackBatchUnit[],
    opts?: {
      voiceOverrides?: Record<string, CharacterVoiceAssignment>;
      styleOverride?: BookReadingStyle;
      speedOverride?: number;
    }
  ) => {
    const units = overrideUnits || batchedUnitsRef.current;
    if (units.length === 0) return;
    const clampedIdx = Math.max(0, Math.min(units.length - 1, index));

    unlockAudioPlaybackSync();
    startAudioFocusKeepalive();
    playbackRunIdRef.current += 1;
    const runId = playbackRunIdRef.current;
    filteredPlayerRef.current?.stop();
    stopOnDeviceSpeech();
    isPlayingRef.current = true;
    setIsPlaying(true);
    setShowMiniBar(true);
    setErrorMsg('');
    void playBatchAt(clampedIdx, runId, units, opts);
  };

  const playBatchAt = async (
    index: number,
    runId: number,
    units: PlaybackBatchUnit[],
    opts?: {
      voiceOverrides?: Record<string, CharacterVoiceAssignment>;
      styleOverride?: BookReadingStyle;
      speedOverride?: number;
    }
  ) => {
    if (playbackRunIdRef.current !== runId || !isPlayingRef.current) return;

    if (index >= units.length) {
      if (hasNextChapterRef.current) {
        autoContinueChapterRef.current = true;
        setInfoNotice('Tự động chuyển sang chương tiếp theo...');
        onNextChapterRef.current();
        return;
      }
      stopAllAudio(false);
      setInfoNotice('Đã đọc xong toàn bộ chương sách.');
      return;
    }

    const unit = units[index];
    setCurrentBatchIndex(index);
    currentBatchIndexRef.current = index;
    syncMediaSessionForUnit(unit, 'playing');

    onHighlightParagraphRef.current(unit.firstParagraphIndex, 0.04);
    onSyncReadingParagraphRef.current?.(unit.firstParagraphIndex);

    const params = resolveTtsParamsForSpeaker(
      unit.speakerId,
      unit.emotionStyle,
      undefined,
      opts?.voiceOverrides,
      opts?.styleOverride
    );

    const spokeOk = await playBrowserBatch(
      unit,
      params.pitch,
      params.rate,
      params.voiceURI,
      runId,
      params.preferGender,
      params.voiceSlotIndex,
      opts?.speedOverride
    );

    if (!spokeOk && isPlayingRef.current && playbackRunIdRef.current === runId) {
      stopAllAudio(false);
      setErrorMsg(
        'Không phát được âm thanh TTS trên thiết bị. Hãy kiểm tra âm lượng hoặc bật Text-to-Speech trên máy.'
      );
      return;
    }

    if (isPlayingRef.current && playbackRunIdRef.current === runId) {
      // Subsequent batches read fresh bookRef.current (no stale voiceOverrides)
      await playBatchAt(index + 1, runId, batchedUnitsRef.current);
    }
  };

  const handleTogglePlay = () => {
    unlockAudioPlaybackSync();
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

  // Preview uses the EXACT same speakOnDevice voice/pitch/rate/slot pipeline as actual audiobook playback!
  const handlePreviewVoiceChoice = async (
    charId: string,
    sampleText: string,
    override?: Partial<CharacterVoiceAssignment>
  ) => {
    unlockAudioPlaybackSync();
    const wasPlaying = isPlayingRef.current;
    if (wasPlaying) {
      stopAllAudio(false);
    } else {
      playbackRunIdRef.current += 1;
      filteredPlayerRef.current?.stop();
      stopOnDeviceSpeech();
    }
    setErrorMsg('');
    setPreviewingId(charId);
    const runId = playbackRunIdRef.current;
    const base = draftCharAssignments[charId] || getAssignment(charId);
    const assign = override ? { ...base, ...override } : base;
    const params = resolveTtsParamsForSpeaker(charId, 'Tự nhiên', assign);
    const textToSpeak = sampleText || 'Xin chào, đây là giọng đọc thử của BOOKHAD.';

    try {
      const finalRate = Math.min(
        MAX_READING_SPEED,
        Math.max(MIN_READING_SPEED, params.rate * speedRef.current)
      );
      const spokeOk = await speakOnDevice({
        text: textToSpeak,
        lang: mapLangCodeToSpeechLocale(ttsLanguageCodeRef.current || bookRef.current.language),
        pitch: params.pitch,
        rate: finalRate,
        voiceURI: params.voiceURI,
        preferGender: params.preferGender,
        voiceSlotIndex: params.voiceSlotIndex,
      });
      if (!spokeOk && playbackRunIdRef.current === runId) {
        setErrorMsg('Không thể phát thử giọng TTS trên thiết bị này.');
      }
    } finally {
      setPreviewingId(null);
    }
  };

  const currentUnit = batchedUnits[currentBatchIndex];
  const discoveredCharacters = (analysis?.characters || []).filter(
    (c) => c.id !== 'narrator'
  );

  // Half-width left-anchored Floating Mini-Bar when browsing outside ReaderView (never collides with right FloatingBookDisc)
  const floatingMiniPlayer =
    miniPlayerVisible && typeof document !== 'undefined'
      ? createPortal(
          <div
            role="region"
            aria-label="Thanh điều khiển nghe sách chạy nền"
            className="fixed left-3 z-[60] w-[calc(50%-0.5rem)] max-w-[225px] bottom-[78px] sm:bottom-[86px] ios-sheet-enter"
          >
            <div className="ios-glass-dock rounded-full border border-white/75 dark:border-zinc-700/70 pl-2.5 pr-1.5 py-1.5 shadow-xl flex items-center justify-between gap-1.5 text-stone-900 dark:text-stone-100">
              <button
                type="button"
                onClick={() => onOpenPanel?.()}
                className="min-w-0 flex-1 text-left"
                title={`Mở bảng giọng đọc · ${book.title}`}
              >
                <div className="text-[10.5px] font-semibold truncate flex items-center gap-1 leading-tight">
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      isPlaying ? 'bg-amber-600 animate-pulse' : 'bg-stone-400'
                    }`}
                  />
                  <span className="truncate">{book.title}</span>
                </div>
                <div className="text-[9.5px] text-stone-500 dark:text-stone-400 truncate tabular-nums leading-tight">
                  {currentBatchIndex + 1}/{Math.max(1, batchedUnits.length)}
                </div>
              </button>

              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={handleTogglePlay}
                  aria-label={isPlaying ? 'Tạm dừng' : 'Phát'}
                  className="w-7 h-7 rounded-full bg-amber-800 text-white flex items-center justify-center hover:bg-amber-900 shadow-sm active:scale-90 transition-transform"
                >
                  {isPlaying ? (
                    <Pause className="w-3.5 h-3.5" />
                  ) : (
                    <Play className="w-3.5 h-3.5 ml-0.5" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => stopAllAudio(true)}
                  aria-label="Dừng và ẩn thanh nghe"
                  className="w-6 h-6 rounded-full flex items-center justify-center text-stone-500 hover:text-red-600 active:scale-90 transition-transform"
                >
                  <X className="w-3.5 h-3.5" />
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

  const panelBody = (
    <div className="flex flex-col max-h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-stone-300/40 dark:border-white/10 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {onBackToToolsMenu && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onBackToToolsMenu();
              }}
              aria-label="Quay lại Tùy chọn đọc sách"
              className="inline-flex items-center gap-0.5 pl-1.5 pr-2.5 py-1 rounded-full bg-black/5 dark:bg-white/10 text-[11px] font-medium text-stone-700 dark:text-stone-200 hover:bg-black/10 dark:hover:bg-white/15 shrink-0"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Quay lại</span>
            </button>
          )}
          <h2 className="text-[14px] font-display font-semibold truncate">
            Cài đặt Nghe &amp; Giọng đọc
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng bảng chọn giọng"
          className="p-1.5 rounded-full bg-black/5 dark:bg-white/10 text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100 shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Unified Single Scrollable List */}
      <div className="overflow-y-auto overscroll-contain px-4 py-3 space-y-2.5 text-xs">
        {/* 1. Playback Speed & Controls */}
        <div className="p-3 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-stone-700 dark:text-stone-300">
              Tốc độ
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
                  className="w-11 text-center text-xs font-semibold tabular-nums bg-transparent text-stone-900 dark:text-stone-100 focus:outline-none"
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

          <div className="flex items-center justify-center gap-2 pt-1">
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
              aria-label={isPlaying ? 'Tạm dừng' : 'Phát'}
              className="inline-flex items-center justify-center gap-1.5 px-5 h-9 rounded-full bg-amber-800 text-white text-xs font-semibold whitespace-nowrap shrink-0 hover:bg-amber-900 transition-colors shadow-sm"
            >
              {isPlaying ? (
                <Pause className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <Play className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>{isPlaying ? 'Tạm dừng' : 'Phát'}</span>
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

            {(isPlaying || showMiniBar) && (
              <button
                type="button"
                onClick={() => stopAllAudio(true)}
                aria-label="Dừng hẳn"
                className="p-2 rounded-full border border-stone-300 dark:border-stone-700 text-stone-600 hover:text-red-600"
              >
                <Square className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <label className="flex items-center justify-between gap-2 cursor-pointer pt-2 border-t border-stone-100 dark:border-stone-800">
            <span className="text-[11px] font-medium text-stone-700 dark:text-stone-300">
              Bôi sáng chữ đang đọc trên trang sách
            </span>
            <input
              type="checkbox"
              checked={highlightSpokenText}
              onChange={(e) => onToggleHighlightSpoken?.(e.target.checked)}
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

        {/* 2. Reading Voice Style Selector (placed right above Giọng dẫn truyện) */}
        <section className="p-3 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 space-y-2">
          <div className="text-[11.5px] font-semibold text-stone-800 dark:text-stone-200">
            Phong cách giọng
          </div>
          <GlassSelect<BookReadingStyle>
            title="Chọn phong cách giọng"
            ariaLabel="Chọn phong cách giọng đọc"
            value={readingStyle}
            options={readingStyleOptions}
            onChange={(nextStyle) => {
              onUpdateReadingStyle?.(nextStyle);
              hotReloadCurrentPlayback({ styleOverride: nextStyle });
            }}
          />
          <p className="text-[10.5px] text-stone-500 dark:text-stone-400 leading-relaxed">
            {READING_VOICE_STYLES.find((s) => s.id === readingStyle)?.description}
          </p>
        </section>

        {/* 3. Narrator Voice Selector (hot-reloads voice immediately while listening) */}
        <section className="p-3 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11.5px] font-semibold text-stone-800 dark:text-stone-200">
              Giọng dẫn truyện
            </span>
            <button
              type="button"
              onClick={() =>
                handlePreviewVoiceChoice(
                  'narrator',
                  activeParagraphs[book.currentParagraphIndex || 0]?.slice(0, 80) ||
                    'Xin chào, đây là giọng dẫn truyện của BOOKHAD.'
                )
              }
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-stone-300 dark:border-stone-700 text-[11px] font-medium hover:border-amber-700 shrink-0"
            >
              <Volume2 className="w-3 h-3" />
              <span>{previewingId === 'narrator' ? 'Đang phát' : 'Thử'}</span>
            </button>
          </div>

          <GlassSelect
            title="Chọn giọng dẫn truyện"
            ariaLabel="Chọn giọng dẫn truyện"
            value={currentNarratorChoiceKey}
            placeholder={activeVoiceLabel}
            options={voiceSelectOptions}
            onChange={(key) => {
              const chosen = unifiedVoiceChoices.find((v) => v.key === key);
              if (!chosen) return;
              const presetTone = getOnDeviceVoiceTone(chosen.geminiVoice);
              const matchedExt =
                chosen.source === 'external' && chosen.externalVoiceId
                  ? externalVoicesRef.current.find((v) => v.id === chosen.externalVoiceId)
                  : undefined;
              const nextNarratorAssign: CharacterVoiceAssignment = {
                ...narratorAssign,
                characterId: 'narrator',
                source: chosen.source,
                geminiVoice: chosen.geminiVoice,
                externalVoiceId: chosen.externalVoiceId,
                browserVoiceURI: chosen.browserVoiceURI,
                browserPitch: matchedExt?.toneSettings?.pitch ?? presetTone.pitch,
                browserRate: matchedExt?.toneSettings?.rate ?? presetTone.rate,
                toneSettings: matchedExt?.toneSettings
                  ? { ...matchedExt.toneSettings }
                  : { ...DEFAULT_VOICE_TONE, pitch: presetTone.pitch, rate: presetTone.rate },
                isCustomOverride: true,
              };
              const nextMap: Record<string, CharacterVoiceAssignment> = {
                ...(bookRef.current.voiceAssignments || {}),
                narrator: nextNarratorAssign,
              };
              if (onBatchUpdateVoiceAssignments) {
                onBatchUpdateVoiceAssignments(nextMap);
              } else {
                onUpdateVoiceAssignment('narrator', nextNarratorAssign);
              }
              setInfoNotice(`Đã đổi giọng dẫn truyện: ${chosen.label}`);
              hotReloadCurrentPlayback({ voiceOverrides: nextMap });
            }}
          />
        </section>

        {/* 4. On-Device Character Voice Scan & Draft Selection + Confirm Button */}
        <section className="p-3 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-stone-800 dark:text-stone-200 min-w-0">
              <Users className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400 shrink-0" />
              <span className="truncate">
                Giọng nhân vật
                {discoveredCharacters.length > 0 ? ` (${discoveredCharacters.length})` : ''}
              </span>
            </div>
            <button
              type="button"
              data-testid="scan-characters-btn"
              onClick={() => {
                const res = runOnDeviceCharacterScan();
                const found = Math.max(0, res.characters.length - 1);
                setInfoNotice(
                  found > 0
                    ? `Đã quét thấy ${found} nhân vật. Chọn giọng rồi bấm "Xác nhận" bên dưới.`
                    : 'Chưa phát hiện lời thoại nhân vật riêng trong chương này.'
                );
              }}
              className="px-3 py-1.5 rounded-lg bg-amber-800 text-white text-[11px] font-semibold hover:bg-amber-900 shrink-0"
            >
              Quét
            </button>
          </div>

          {discoveredCharacters.length > 0 && (
            <div className="space-y-2">
              {discoveredCharacters.map((char, idx) => {
                const charAssign =
                  draftCharAssignments[char.id] ||
                  getAssignment(char.id, char.suggestedVoiceName);
                const charKey =
                  charAssign.source === 'external' && charAssign.externalVoiceId
                    ? `external:${charAssign.externalVoiceId}`
                    : charAssign.source === 'browser' && charAssign.browserVoiceURI
                    ? `browser:${charAssign.browserVoiceURI}`
                    : `gemini:${charAssign.geminiVoice}`;
                return (
                  <div
                    key={char.id}
                    className="p-2.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[11.5px] font-semibold text-stone-900 dark:text-stone-100 truncate">
                          Nhân vật {idx + 1}: {char.name}
                        </div>
                        <div className="text-[10px] text-stone-500">
                          {ROLE_LABELS[char.role] || char.role} · {char.lineCount} lời thoại
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          handlePreviewVoiceChoice(
                            char.id,
                            char.sampleQuote || char.voiceDescription,
                            charAssign
                          )
                        }
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-stone-300 dark:border-stone-700 text-[10.5px] hover:border-amber-700 shrink-0"
                      >
                        <Volume2 className="w-3 h-3" />
                        <span>{previewingId === char.id ? 'Đang phát' : 'Thử'}</span>
                      </button>
                    </div>

                    <GlassSelect
                      title={`Chọn giọng cho ${char.name}`}
                      ariaLabel={`Chọn giọng cho ${char.name}`}
                      value={charKey}
                      options={voiceSelectOptions}
                      onChange={(key) => {
                        const chosen = unifiedVoiceChoices.find((v) => v.key === key);
                        if (!chosen) return;
                        const presetTone = getOnDeviceVoiceTone(chosen.geminiVoice);
                        const matchedExt =
                          chosen.source === 'external' && chosen.externalVoiceId
                            ? externalVoicesRef.current.find(
                                (v) => v.id === chosen.externalVoiceId
                              )
                            : undefined;
                        const updatedAssign: CharacterVoiceAssignment = {
                          ...charAssign,
                          characterId: char.id,
                          source: chosen.source,
                          geminiVoice: chosen.geminiVoice,
                          externalVoiceId: chosen.externalVoiceId,
                          browserVoiceURI: chosen.browserVoiceURI,
                          browserPitch: matchedExt?.toneSettings?.pitch ?? presetTone.pitch,
                          browserRate: matchedExt?.toneSettings?.rate ?? presetTone.rate,
                          toneSettings: matchedExt?.toneSettings
                            ? { ...matchedExt.toneSettings }
                            : {
                                ...DEFAULT_VOICE_TONE,
                                pitch: presetTone.pitch,
                                rate: presetTone.rate,
                              },
                          isCustomOverride: true,
                        };
                        setDraftCharAssignments((prev) => ({
                          ...prev,
                          [char.id]: updatedAssign,
                        }));
                        setHasPendingCharEdits(true);
                      }}
                    />
                  </div>
                );
              })}

              <button
                type="button"
                data-testid="confirm-character-voices-btn"
                onClick={() => {
                  const committed: Record<string, CharacterVoiceAssignment> = {
                    ...(bookRef.current.voiceAssignments || {}),
                  };
                  for (const char of discoveredCharacters) {
                    const chosenAssign =
                      draftCharAssignments[char.id] ||
                      getAssignment(char.id, char.suggestedVoiceName);
                    committed[char.id] = {
                      ...chosenAssign,
                      characterId: char.id,
                      isCustomOverride: true,
                    };
                  }
                  if (onBatchUpdateVoiceAssignments) {
                    onBatchUpdateVoiceAssignments(committed);
                  } else {
                    Object.entries(committed).forEach(([cid, assign]) => {
                      onUpdateVoiceAssignment(cid, assign);
                    });
                  }
                  setHasPendingCharEdits(false);
                  setInfoNotice('Đã xác nhận & áp dụng giọng nhân vật mới.');
                  hotReloadCurrentPlayback({ voiceOverrides: committed });
                }}
                className={`w-full py-2 rounded-xl text-[11.5px] font-semibold transition-colors ${
                  hasPendingCharEdits
                    ? 'bg-amber-800 hover:bg-amber-900 text-white shadow-sm'
                    : 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:opacity-90'
                }`}
              >
                Xác nhận
              </button>
            </div>
          )}
        </section>

        {/* 4. Ambient Sound & Chill Music Section */}
        <section className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/50 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowAmbientSection((v) => !v)}
            aria-expanded={showAmbientSection}
            className="w-full px-3 py-2.5 flex items-center justify-between gap-2 text-left"
          >
            <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-stone-800 dark:text-stone-200">
              <Music className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400 shrink-0" />
              <span>
                Nhạc nền{ambientActiveCount > 0 ? ` (${ambientActiveCount})` : ''}
              </span>
            </span>
            <ChevronDown
              className={`w-4 h-4 text-stone-500 transition-transform ${
                showAmbientSection ? 'rotate-180' : ''
              }`}
            />
          </button>

          {showAmbientSection && (
            <div className="px-3 pb-3 pt-1 border-t border-stone-100 dark:border-stone-800">
              <AmbientSoundPanel
                compact
                customTracks={customAmbientTracks}
                onAddCustomTrack={onAddCustomAmbientTrack}
                onDeleteCustomTrack={onDeleteCustomAmbientTrack}
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );

  // Mobile (<1024px): iPhone frosted-glass half-height bottom sheet
  if (!isDesktop && typeof document !== 'undefined') {
    return (
      <>
        {createPortal(
          <div className="fixed inset-0 z-[70] flex items-end justify-center">
            <div
              className="fixed inset-0 ios-frosted-backdrop"
              onClick={onClose}
              aria-hidden="true"
            />
            <aside
              aria-label="Cài đặt nghe sách nói và giọng đọc"
              className="ios-sheet-enter ios-frosted-surface relative z-10 w-full max-w-lg h-auto max-h-[72dvh] rounded-t-[26px] text-stone-900 dark:text-stone-100 flex flex-col overflow-hidden"
            >
              <div className="w-10 h-1 rounded-full bg-stone-400/50 dark:bg-stone-600/70 mx-auto mt-2 shrink-0" />
              {panelBody}
            </aside>
          </div>,
          document.body
        )}
        {floatingMiniPlayer}
      </>
    );
  }

  return (
    <>
      <aside
        aria-label="Cài đặt nghe sách nói và giọng đọc"
        className="ios-frosted-surface w-[390px] shrink-0 sticky top-[52px] self-start h-auto max-h-[calc(100vh-52px)] text-stone-900 dark:text-stone-100 rounded-bl-[24px] flex flex-col overflow-hidden"
      >
        {panelBody}
      </aside>
      {floatingMiniPlayer}
    </>
  );
};
