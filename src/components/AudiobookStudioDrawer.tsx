import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  Moon,
  Lock,
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
  formatSleepCountdown,
  resolveSleepTimerConfig,
  sanitizeSleepHoursInput,
  sanitizeSleepMinutesInput,
} from '../utils/sleepTimer';
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
  analyzeBookTopCharacters,
  analyzeChapterOnDevice,
  applyNarratorVoiceToCharacters,
  buildAutoVoiceAssignments,
  computeReadingStyleModulation,
  READING_VOICE_STYLES,
} from '../utils/onDeviceCharacterAI';
import { applyPronunciationDict } from '../utils/pronunciationDict';
import { applySmartBreathingPauses, detectSpatialEffect } from '../utils/aiScriptDirector';
import { ramCache } from '../utils/ramCache';
import {
  buildBatchedPlaybackUnits,
  findBatchIndexForParagraph,
  resolveActiveHighlightInBatch,
  type PlaybackBatchUnit,
} from '../utils/audiobookPrefetch';
import {
  HIDDEN_SYSTEM_VOICES_EVENT,
  loadHiddenSystemVoiceKeys,
  resolveNarratorAssignmentFromDefault,
} from '../utils/studioCatalog';
import {
  collectRepeatedLineSignatures,
  evaluateParagraphForPreRead,
  resolveBatchSpeechWithPreRead,
  type PreReadDecision,
} from '../utils/aiContentCleaner';
import { runPreReadLookaheadAiScan } from '../utils/aiContentCleanerClient';
import { resolveApiUrl } from '../utils/apiClient';
import { AmbientSoundPanel } from './AmbientSoundPanel';
import { GlassSelect, type GlassSelectOption } from './GlassSelect';
import { IosSheet } from './IosSheet';
import { useI18n } from '../contexts/LanguageContext';
import {
  resolveDefaultCharacterAssignment,
  resolveSpeechEngineRoute,
  sliceRemainingSpeechFromCursor,
} from '../utils/ttsRouter';

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
  audioCommandSignal?: { action: 'toggle' | 'next' | 'stop'; tick: number } | null;
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
  onToggleCharacterVoices?: (enabled: boolean) => void;
  externalVoices: ExternalVoiceAsset[];
  onAddExternalVoice?: (voice: ExternalVoiceAsset) => Promise<void>;
  customAmbientTracks?: CustomAmbientTrack[];
  onAddCustomAmbientTrack?: (track: CustomAmbientTrack) => Promise<void>;
  onDeleteCustomAmbientTrack?: (trackId: string) => Promise<void>;
  onHighlightParagraph: (
    paragraphIndex: number | null,
    progressRatio?: number,
    charOffsetInParagraph?: number
  ) => void;
  onSyncReadingParagraph?: (paragraphIndex: number, charOffset?: number) => void;
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
const PREREAD_AI_STORAGE_KEY = 'bookhad_preread_ai_enabled';

const VALID_PRESET_VOICES: GeminiVoiceName[] = [
  'Kore',
  'Charon',
  'Zephyr',
  'Fenrir',
  'Puck',
  'Aoede',
];

const BUILTIN_VOICE_LABELS: Record<GeminiVoiceName, string> = {
  Kore: 'Nữ ấm (Gốc)',
  Charon: 'Nam trầm',
  Zephyr: 'Nữ dịu',
  Fenrir: 'Nam vang',
  Puck: 'Nam trẻ',
  Aoede: 'Nữ thanh',
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
  audioCommandSignal = null,
  onSaveChapterAnalysis,
  onUpdateVoiceAssignment,
  onBatchUpdateVoiceAssignments,
  onUpdateReadingStyle,
  onToggleCharacterVoices,
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
  const { strings } = useI18n();
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
  const [hiddenSystemVoices, setHiddenSystemVoices] = useState<string[]>(() =>
    loadHiddenSystemVoiceKeys()
  );
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );
  // Local draft map for character voices so page-turns while listening NEVER overwrite or interrupt editing
  const [draftCharAssignments, setDraftCharAssignments] = useState<
    Record<string, CharacterVoiceAssignment>
  >({});
  const [hasPendingCharEdits, setHasPendingCharEdits] = useState(false);

  // Job 2: Live Pre-Read Lookahead AI (runs AHEAD of AI Voice Reader to skip links/junk & repair errors)
  const [preReadAiEnabled, setPreReadAiEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(PREREAD_AI_STORAGE_KEY);
      if (saved === '0' || saved === 'false') return false;
    } catch {
      // ignore storage errors
    }
    return true;
  });
  const [preReadStats, setPreReadStats] = useState<{
    skipped: number;
    fixed: number;
    lastReason: string;
  }>({ skipped: 0, fixed: 0, lastReason: '' });
  const preReadAiEnabledRef = useRef(preReadAiEnabled);
  preReadAiEnabledRef.current = preReadAiEnabled;
  const preReadDecisionsRef = useRef<Map<number, PreReadDecision>>(new Map());
  const preReadAiRequestedRef = useRef<Set<number>>(new Set());
  const preReadAbortRef = useRef<AbortController | null>(null);

  // Strict Character Toggle: OFF & locked until user scans whole book (top 10 chars) and clicks "Xác nhận"
  const [localCharsConfigured, setLocalCharsConfigured] = useState<boolean>(() =>
    Boolean(book.characterVoicesConfigured)
  );
  const [scannedBookCharacters, setScannedBookCharacters] = useState<
    import('../types/book').CharacterInfo[]
  >([]);
  const characterVoicesConfigured = Boolean(book.characterVoicesConfigured || localCharsConfigured);
  const characterVoicesEnabled = Boolean(book.characterVoicesEnabled && characterVoicesConfigured);
  const characterVoicesEnabledRef = useRef(characterVoicesEnabled);
  characterVoicesEnabledRef.current = characterVoicesEnabled;

  // Sleep Timer ("Hẹn giờ tắt"): empty/0 -> stop at end of current chapter; >0 -> countdown + 2.5s fade-out
  const [sleepHoursInput, setSleepHoursInput] = useState<string>('');
  const [sleepMinutesInput, setSleepMinutesInput] = useState<string>('');
  const [sleepRemainingSec, setSleepRemainingSec] = useState<number>(0);
  const sleepTimerConfig = useMemo(
    () => resolveSleepTimerConfig(sleepHoursInput, sleepMinutesInput),
    [sleepHoursInput, sleepMinutesInput]
  );
  const sleepTimerConfigRef = useRef(sleepTimerConfig);
  sleepTimerConfigRef.current = sleepTimerConfig;

  const filteredPlayerRef = useRef<FilteredAudioPlayer | null>(null);
  const aiTtsCacheRef = useRef<Map<string, Promise<string | null>>>(new Map());
  const activeAiTtsAbortRef = useRef<AbortController | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);
  const aiTtsCooldownUntilRef = useRef<number>(0);
  const isPlayingRef = useRef(false);
  const playbackRunIdRef = useRef(0);
  const handledSignalRef = useRef(0);
  const handledToggleSignalRef = useRef(0);
  const handledAudioCmdTickRef = useRef(0);
  const autoContinueChapterRef = useRef(false);
  const speedRef = useRef(playbackSpeed);
  const currentBatchIndexRef = useRef(currentBatchIndex);
  const previewingIdRef = useRef<string | null>(previewingId);
  previewingIdRef.current = previewingId;
  const activeCursorCharInBatchRef = useRef<number>(0);

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
    setLocalCharsConfigured(Boolean(book.characterVoicesConfigured));
    setScannedBookCharacters([]);
  }, [book.id, book.characterVoicesConfigured]);

  // Countdown tick for numeric Sleep Timer (hours/minutes > 0) — 2.5s fade-out & pause BOTH AI Voice & Ambient Audio
  useEffect(() => {
    if (sleepTimerConfig.mode !== 'countdown' || sleepTimerConfig.totalSeconds <= 0) {
      setSleepRemainingSec(0);
      return;
    }
    setSleepRemainingSec(sleepTimerConfig.totalSeconds);
    const interval = window.setInterval(() => {
      setSleepRemainingSec((prev) => {
        if (prev <= 1) {
          window.clearInterval(interval);
          setSleepHoursInput('');
          setSleepMinutesInput('');
          void (async () => {
            try {
              await Promise.all([
                filteredPlayerRef.current?.fadeOutAndStop(2500),
                ambientSoundManager.fadeOutAndStopAll(2500),
              ]);
            } catch {
              // ignore
            }
            stopAllAudio(true);
            ambientSoundManager.stopAll();
            setInfoNotice('Hẹn giờ tắt đã kết thúc — đã giảm dần âm lượng và tạm dừng phát.');
          })();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sleepTimerConfig.mode, sleepTimerConfig.totalSeconds]);

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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncHidden = () => setHiddenSystemVoices(loadHiddenSystemVoiceKeys());
    window.addEventListener(HIDDEN_SYSTEM_VOICES_EVENT, syncHidden);
    window.addEventListener('storage', syncHidden);
    return () => {
      window.removeEventListener(HIDDEN_SYSTEM_VOICES_EVENT, syncHidden);
      window.removeEventListener('storage', syncHidden);
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
  const activeParagraphsRef = useRef<string[]>(activeParagraphs);
  activeParagraphsRef.current = activeParagraphs;

  const repeatedLineSignatures = useMemo(
    () => collectRepeatedLineSignatures(book.chapters),
    [book.chapters]
  );
  const repeatedLineSignaturesRef = useRef<Set<string>>(repeatedLineSignatures);
  repeatedLineSignaturesRef.current = repeatedLineSignatures;

  // Reset Pre-Read AI lookahead cache whenever chapter or book changes
  useEffect(() => {
    preReadAbortRef.current?.abort();
    preReadAbortRef.current = null;
    preReadDecisionsRef.current = new Map();
    preReadAiRequestedRef.current = new Set();
    setPreReadStats({ skipped: 0, fixed: 0, lastReason: '' });
  }, [book.id, chapter.id]);

  // Runs Pre-Read Scanner AI ahead of the AI Voice Reader on upcoming paragraphs
  const schedulePreReadLookahead = (startParagraphIndex: number) => {
    if (!preReadAiEnabledRef.current) return;
    const paras = activeParagraphsRef.current;
    const bookTitle = bookRef.current.title;
    const repeated = repeatedLineSignaturesRef.current;
    const decisions = preReadDecisionsRef.current;
    const requested = preReadAiRequestedRef.current;

    const toSendToAi: Array<{ paragraphIndex: number; text: string }> = [];
    const maxWindow = Math.min(paras.length, startParagraphIndex + 12);

    for (let pIdx = Math.max(0, startParagraphIndex); pIdx < maxWindow; pIdx++) {
      const text = (paras[pIdx] || '').trim();
      if (!decisions.has(pIdx)) {
        decisions.set(
          pIdx,
          evaluateParagraphForPreRead(text, pIdx, bookTitle, repeated)
        );
      }
      const existing = decisions.get(pIdx);
      // Queue non-skipped paragraphs (up to 8 per lookahead wave) for background Gemini AI lookahead check
      if (!requested.has(pIdx) && text.length > 0 && existing?.action !== 'skip' && toSendToAi.length < 8) {
        requested.add(pIdx);
        toSendToAi.push({ paragraphIndex: pIdx, text });
      }
    }

    if (toSendToAi.length === 0) return;

    const controller = new AbortController();
    preReadAbortRef.current = controller;
    const targetChapterId = chapterRef.current.id;

    void runPreReadLookaheadAiScan(
      {
        bookTitle,
        chapterTitle: chapterRef.current.title,
        items: toSendToAi,
      },
      controller.signal
    ).then((aiDecisions) => {
      if (chapterRef.current.id !== targetChapterId || aiDecisions.length === 0) return;
      for (const dec of aiDecisions) {
        const local = decisions.get(dec.paragraphIndex);
        // Never downgrade a definite local skip (e.g. vtbook/http) back to keep
        if (local?.action === 'skip' && dec.action !== 'skip') continue;
        if (dec.action === 'skip' || dec.action === 'fix') {
          decisions.set(dec.paragraphIndex, dec);
        }
      }
    });
  };

  const getPlayer = () => {
    if (!filteredPlayerRef.current) {
      filteredPlayerRef.current = new FilteredAudioPlayer();
    }
    return filteredPlayerRef.current;
  };

  useEffect(() => {
    return () => {
      playbackRunIdRef.current += 1;
      activeAiTtsAbortRef.current?.abort();
      previewAbortRef.current?.abort();
      preReadAbortRef.current?.abort();
      filteredPlayerRef.current?.dispose();
      clearMediaSession();
      stopOnDeviceSpeech();
      stopAudioFocusKeepalive();
    };
  }, []);

  const effectiveScript = useMemo(() => {
    const narratorLabel =
      readingStyle === 'selfhelp' ? 'Diễn giả chính' : 'Người dẫn chuyện';
    if (analysis?.script && analysis.script.length > 0 && !isTranslatedView) {
      if (!characterVoicesEnabled) {
        return analysis.script.map((seg) => ({
          ...seg,
          speakerId: 'narrator',
          speakerName: narratorLabel,
        }));
      }
      return analysis.script;
    }
    return activeParagraphs.map((p, idx) => ({
      id: `para-${idx}`,
      paragraphIndex: idx,
      speakerId: 'narrator',
      speakerName: narratorLabel,
      emotionStyle: 'Truyền cảm, tự nhiên',
      text: p,
    }));
  }, [analysis?.script, isTranslatedView, activeParagraphs, readingStyle, characterVoicesEnabled]);

  const batchedUnits = useMemo(
    () => buildBatchedPlaybackUnits(effectiveScript, 260, activeParagraphs),
    [effectiveScript, activeParagraphs]
  );

  const batchedUnitsRef = useRef<PlaybackBatchUnit[]>(batchedUnits);
  useEffect(() => {
    batchedUnitsRef.current = batchedUnits;
  }, [batchedUnits]);

  const runOnDeviceCharacterScan = (): ChapterAnalysis => {
    const liveBook = bookRef.current;
    const liveExt = externalVoicesRef.current;

    // AI 5: Scan ENTIRE book across all chapters and rank Top 10 most frequent characters
    const bookScan = analyzeBookTopCharacters(liveBook, readingStyle, 10);
    const chapterScriptAnalysis = analyzeChapterOnDevice(
      chapter.title,
      activeParagraphs,
      readingStyle
    );
    const mergedAnalysis: ChapterAnalysis = {
      ...chapterScriptAnalysis,
      estimatedTotalCharacters: Math.max(1, bookScan.topCharacters.length - 1),
      summary: bookScan.summary,
      characters: bookScan.topCharacters,
    };

    const seededAssignments: Record<string, CharacterVoiceAssignment> = {
      ...(liveBook.voiceAssignments || {}),
      narrator:
        liveBook.voiceAssignments?.narrator ||
        resolveNarratorAssignmentFromDefault(defaultVoiceRef.current, liveExt),
    };
    const autoMap = buildAutoVoiceAssignments(mergedAnalysis.characters, seededAssignments, {
      inheritNarratorVoice: true,
    });
    onSaveChapterAnalysis(chapter.id, mergedAnalysis, autoMap);
    setScannedBookCharacters(bookScan.topCharacters.filter((c) => c.id !== 'narrator'));

    // Pre-populate local draft map so user customizes Top 10 characters then taps "Xác nhận" to unlock toggle
    const nextDrafts: Record<string, CharacterVoiceAssignment> = {};
    for (const ch of mergedAnalysis.characters) {
      if (ch.id !== 'narrator' && autoMap[ch.id]) {
        nextDrafts[ch.id] = autoMap[ch.id];
      }
    }
    setDraftCharAssignments(nextDrafts);
    setHasPendingCharEdits(true);
    return mergedAnalysis;
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
        const nextMap = applyNarratorVoiceToCharacters(
          bookRef.current.voiceAssignments || {},
          nextNarrator
        );
        bookRef.current = { ...bookRef.current, voiceAssignments: nextMap };
        hotReloadCurrentPlayback({
          voiceOverrides: nextMap,
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
      book.currentParagraphIndex || 0,
      book.currentPageCharOffset || 0
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
          : findBatchIndexForParagraph(
              unitsToUse,
              book.currentParagraphIndex || 0,
              book.currentPageCharOffset || 0
            );
      setErrorMsg('');
      setShowMiniBar(true);
      setCurrentBatchIndex(startBatchIdx);
      startPlaybackAt(startBatchIdx, unitsToUse);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [togglePlaySignal]);

  // Handle remote commands from merged FloatingBookDisc on the main screen (Play/Pause, Next, Stop)
  useEffect(() => {
    if (!audioCommandSignal || audioCommandSignal.tick === handledAudioCmdTickRef.current) return;
    handledAudioCmdTickRef.current = audioCommandSignal.tick;
    if (audioCommandSignal.action === 'stop') {
      stopAllAudio(true);
      return;
    }
    if (audioCommandSignal.action === 'toggle') {
      unlockAudioPlaybackSync();
      if (isPlayingRef.current) {
        stopAllAudio(false);
      } else {
        startPlaybackAt(currentBatchIndexRef.current);
      }
      return;
    }
    if (audioCommandSignal.action === 'next') {
      unlockAudioPlaybackSync();
      const next = Math.min(
        Math.max(0, batchedUnitsRef.current.length - 1),
        currentBatchIndexRef.current + 1
      );
      setCurrentBatchIndex(next);
      currentBatchIndexRef.current = next;
      startPlaybackAt(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioCommandSignal?.tick]);

  const onPlaybackStateChangeRef = useRef(onPlaybackStateChange);
  onPlaybackStateChangeRef.current = onPlaybackStateChange;

  useEffect(() => {
    onPlaybackStateChangeRef.current?.(isPlaying);
  }, [isPlaying]);

  useEffect(() => {
    onSessionActiveChange?.(showMiniBar || isPlaying);
  }, [showMiniBar, isPlaying, onSessionActiveChange]);

  // Mini-bar is now unified directly into FloatingBookDisc — never render a duplicate bar here
  useEffect(() => {
    onMiniPlayerVisibilityChange?.(false);
  }, [onMiniPlayerVisibilityChange]);

  const stopAllAudio = (hideBar = true) => {
    playbackRunIdRef.current += 1;
    activeAiTtsAbortRef.current?.abort();
    activeAiTtsAbortRef.current = null;
    previewAbortRef.current?.abort();
    previewAbortRef.current = null;
    isPlayingRef.current = false;
    setIsPlaying(false);
    previewingIdRef.current = null;
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
    onHighlightParagraph(null, 0, 0);
  };

  const getAssignment = (
    charId: string,
    _suggested?: GeminiVoiceName,
    overrideMap?: Record<string, CharacterVoiceAssignment>
  ): CharacterVoiceAssignment => {
    const liveBook = bookRef.current;
    const liveExt = externalVoicesRef.current;
    const liveDefault = defaultVoiceRef.current;
    const mapSource = overrideMap || liveBook.voiceAssignments;
    const existing = mapSource?.[charId];
    if (charId === 'narrator') {
      if (existing) {
        const normalizedVoice: GeminiVoiceName = VALID_PRESET_VOICES.includes(
          existing.geminiVoice
        )
          ? existing.geminiVoice
          : 'Kore';
        return { ...existing, geminiVoice: normalizedVoice };
      }
      return resolveNarratorAssignmentFromDefault(liveDefault, liveExt);
    }
    const narratorBase = getAssignment('narrator', undefined, overrideMap);
    const resolved = resolveDefaultCharacterAssignment(charId, narratorBase, mapSource);
    const normalizedVoice: GeminiVoiceName = VALID_PRESET_VOICES.includes(resolved.geminiVoice)
      ? resolved.geminiVoice
      : 'Kore';
    return { ...resolved, geminiVoice: normalizedVoice };
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
      const key = `gemini:${gv.name}`;
      if (hiddenSystemVoices.includes(key)) continue;
      items.push({
        key,
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
      const key = `browser:${bv.voiceURI}`;
      if (hiddenSystemVoices.includes(key)) continue;
      items.push({
        key,
        label: bv.name,
        source: 'browser',
        geminiVoice: 'Kore',
        browserVoiceURI: bv.voiceURI,
      });
    }
    return items;
  }, [externalVoices, browserVoices, hiddenSystemVoices]);

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
    const effectiveSpeakerId =
      overrideAssign || characterVoicesEnabledRef.current ? speakerId : 'narrator';
    const assign = overrideAssign || getAssignment(effectiveSpeakerId, undefined, overrideMap);
    const assignTone: VoiceToneSettings = assign.toneSettings || {
      ...DEFAULT_VOICE_TONE,
      pitch: assign.browserPitch,
      rate: assign.browserRate,
    };

    const route = resolveSpeechEngineRoute(assign, liveExt, activeStyle);

    if (route.engine === 'ON_DEVICE_CLONED') {
      if (route.missingEmbeddingError || !route.externalVoice) {
        return {
          voiceName: assign.geminiVoice,
          stylePrompt: assign.stylePrompt || '',
          pitch: 1.0,
          rate: 1.0,
          preferGender: 'neutral' as const,
          voiceSlotIndex: 0,
          voiceURI: undefined as string | undefined,
          tone: assignTone,
          externalAsset: route.externalVoice,
          speakerEmbedding: undefined as import('../types/book').SpeakerEmbeddingVector | undefined,
          missingEmbeddingError:
            route.missingEmbeddingError ||
            'Giọng nhân bản chưa có Speaker Embedding. Hãy nạp lại file mẫu 5–8 giây.',
          useAiTts: false,
          useVoiceDesign: false,
        };
      }

      const ext = route.externalVoice;
      const extSpeech = computeExternalVoiceSpeechParams(ext);
      const cloned = route.clonedSynthesis;
      const modulated = computeReadingStyleModulation(
        activeStyle,
        emotionStyle,
        cloned?.pitch ?? extSpeech.pitch,
        cloned?.rate ?? extSpeech.rate
      );
      const mergedTone: VoiceToneSettings = {
        ...DEFAULT_VOICE_TONE,
        warmthDb: cloned?.warmthDb ?? extSpeech.warmthDb,
        clarityDb: cloned?.clarityDb ?? extSpeech.clarityDb,
        pitch: modulated.pitch,
        rate: modulated.rate,
        styleDirection: cloned?.stylePrompt || extSpeech.stylePrompt,
        ...(ext.toneSettings || {}),
      };
      return {
        voiceName: cloned?.baseVoice ?? extSpeech.baseVoice,
        stylePrompt: `${cloned?.stylePrompt || extSpeech.stylePrompt}. ${modulated.stylePrompt}`,
        pitch: modulated.pitch,
        rate: modulated.rate,
        preferGender: cloned?.gender ?? extSpeech.preferGender,
        voiceSlotIndex: extSpeech.voiceSlotIndex,
        voiceURI: undefined as string | undefined,
        tone: mergedTone,
        externalAsset: ext,
        speakerEmbedding: route.embedding,
        missingEmbeddingError: undefined as string | undefined,
        useAiTts: true,
        useVoiceDesign: true,
      };
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
        speakerEmbedding: undefined as import('../types/book').SpeakerEmbeddingVector | undefined,
        missingEmbeddingError: undefined as string | undefined,
        useAiTts: false,
        useVoiceDesign: false,
      };
    }

    const presetTone = getOnDeviceVoiceTone(assign.geminiVoice as GeminiVoiceName);
    const customPitch =
      assign.toneSettings && Number.isFinite(assign.toneSettings.pitch) && assign.toneSettings.pitch !== 1.0
        ? assign.toneSettings.pitch
        : presetTone.pitch;
    const customRate =
      assign.toneSettings && Number.isFinite(assign.toneSettings.rate) && assign.toneSettings.rate !== 1.0
        ? assign.toneSettings.rate
        : presetTone.rate;
    const modulated = computeReadingStyleModulation(
      activeStyle,
      emotionStyle,
      customPitch,
      customRate
    );

    return {
      voiceName: assign.geminiVoice,
      stylePrompt: `${assign.stylePrompt}. ${modulated.stylePrompt}`,
      pitch: modulated.pitch,
      rate: modulated.rate,
      preferGender: presetTone.preferGender,
      voiceSlotIndex: presetTone.voiceSlotIndex,
      voiceURI: assign.browserVoiceURI,
      tone: {
        ...assignTone,
        pitch: modulated.pitch,
        rate: modulated.rate,
      },
      externalAsset: undefined,
      speakerEmbedding: undefined as import('../types/book').SpeakerEmbeddingVector | undefined,
      missingEmbeddingError: undefined as string | undefined,
      useAiTts: true,
      useVoiceDesign: false,
    };
  };

  /**
   * Fetches real Gemini AI TTS / Voice Design WAV audio when online (with caching & instant offline cooldown).
   * Returns null immediately if offline, browser-voice selected, or quota temporarily reached so on-device TTS runs with 0ms lag.
   */
  const fetchAiTtsAudio = (
    text: string,
    params: ReturnType<typeof resolveTtsParamsForSpeaker>,
    styleOverride?: BookReadingStyle,
    opts?: { bypassCooldown?: boolean; timeoutMs?: number; abortSlot?: 'playback' | 'preview' }
  ): Promise<string | null> => {
    if (!params.useAiTts || !text.trim()) return Promise.resolve(null);
    if (!opts?.bypassCooldown && Date.now() < aiTtsCooldownUntilRef.current) {
      return Promise.resolve(null);
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return Promise.resolve(null);
    }

    const activeStyle = styleOverride || bookRef.current.readingStyle || 'novel';
    const targetLang = mapLangCodeToSpeechLocale(
      ttsLanguageCodeRef.current || bookRef.current.language
    );
    const cacheKey = `${params.voiceName}|${params.useVoiceDesign ? 1 : 0}|${activeStyle}|${params.stylePrompt.slice(0, 80)}|${text}`;
    const existing = aiTtsCacheRef.current.get(cacheKey);
    if (existing) return existing;

    // Cap cache size to keep RAM low on mobile phones
    if (aiTtsCacheRef.current.size > 32) {
      const oldestKey = aiTtsCacheRef.current.keys().next().value;
      if (oldestKey) aiTtsCacheRef.current.delete(oldestKey);
    }

    const promise = (async () => {
      const controller = new AbortController();
      if (opts?.abortSlot === 'preview') {
        previewAbortRef.current?.abort();
        previewAbortRef.current = controller;
      } else if (opts?.abortSlot === 'playback') {
        activeAiTtsAbortRef.current?.abort();
        activeAiTtsAbortRef.current = controller;
      }
      const timer = window.setTimeout(() => controller.abort(), opts?.timeoutMs ?? 4200);
      try {
        const resp = await fetch(resolveApiUrl('/api/ai/tts'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            text,
            voiceName: params.voiceName,
            stylePrompt: params.stylePrompt,
            expressive: true,
            useVoiceDesign: params.useVoiceDesign,
            readingStyle: activeStyle,
            lang: targetLang,
          }),
        });
        if (!resp.ok) {
          aiTtsCooldownUntilRef.current = Date.now() + 8000;
          aiTtsCacheRef.current.delete(cacheKey);
          return null;
        }
        const data = await resp.json();
        if (data?.quotaExceeded || !data?.audioBase64) {
          aiTtsCooldownUntilRef.current = Date.now() + 45000;
          aiTtsCacheRef.current.delete(cacheKey);
          return null;
        }
        return `data:${data.mimeType || 'audio/wav'};base64,${data.audioBase64}`;
      } catch (err) {
        const isAbort = err instanceof Error && err.name === 'AbortError';
        if (!isAbort) {
          aiTtsCooldownUntilRef.current = Date.now() + 8000;
        }
        aiTtsCacheRef.current.delete(cacheKey);
        return null;
      } finally {
        window.clearTimeout(timer);
        if (opts?.abortSlot === 'preview' && previewAbortRef.current === controller) {
          previewAbortRef.current = null;
        }
        if (opts?.abortSlot === 'playback' && activeAiTtsAbortRef.current === controller) {
          activeAiTtsAbortRef.current = null;
        }
      }
    })();

    aiTtsCacheRef.current.set(cacheKey, promise);
    return promise;
  };

  const playBrowserBatch = async (
    unit: PlaybackBatchUnit,
    pitch: number,
    rate: number,
    voiceURI: string | undefined,
    runId: number,
    preferGender?: 'female' | 'male' | 'neutral',
    voiceSlotIndex = 0,
    speedOverride?: number,
    spokenTextOverride?: string,
    baseCharOffsetInBatch = 0,
    fullBatchPreparedLen?: number
  ): Promise<boolean> => {
    const text = (spokenTextOverride ?? unit.combinedText).trim();
    if (!text) return true;
    const totalBatchLen = Math.max(
      1,
      fullBatchPreparedLen ?? (baseCharOffsetInBatch + text.length)
    );
    const activeSpeed = speedOverride ?? speedRef.current;
    const finalRate = Math.min(
      MAX_READING_SPEED,
      Math.max(MIN_READING_SPEED, rate * activeSpeed)
    );
    const targetLang = mapLangCodeToSpeechLocale(
      ttsLanguageCodeRef.current || bookRef.current.language
    );
    let lastSyncedPara = -1;

    const applyProgress = (charIndexInSlice: number) => {
      if (playbackRunIdRef.current !== runId || !isPlayingRef.current) return;
      const absBatchChar = Math.min(totalBatchLen, baseCharOffsetInBatch + Math.max(0, charIndexInSlice));
      activeCursorCharInBatchRef.current = absBatchChar;
      const absRatio = Math.min(0.99, absBatchChar / totalBatchLen);
      const resolved = resolveActiveHighlightInBatch(unit, absRatio, absBatchChar);
      onHighlightParagraphRef.current(
        resolved.paragraphIndex,
        resolved.paragraphRatio,
        resolved.charOffsetInParagraph
      );
      if (resolved.paragraphIndex !== lastSyncedPara) {
        lastSyncedPara = resolved.paragraphIndex;
        onSyncReadingParagraphRef.current?.(resolved.paragraphIndex, resolved.charOffsetInParagraph);
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
        applyProgress(0);
      },
      onBoundary: (charIndex) => {
        applyProgress(charIndex);
      },
    });

    if (ok && playbackRunIdRef.current === runId && isPlayingRef.current) {
      activeCursorCharInBatchRef.current = totalBatchLen;
      const lastSpan = unit.spans[unit.spans.length - 1];
      if (lastSpan) {
        onHighlightParagraphRef.current(
          lastSpan.paragraphIndex,
          1,
          (lastSpan.paragraphCharStart || 0) + lastSpan.text.length
        );
      }
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
    // Preserve exact live reading cursor (position D) so switching voices NEVER resets back to A
    const resumeCharOffset = Math.max(0, activeCursorCharInBatchRef.current);

    playbackRunIdRef.current += 1;
    const runId = playbackRunIdRef.current;
    activeAiTtsAbortRef.current?.abort();
    activeAiTtsAbortRef.current = null;
    filteredPlayerRef.current?.stop();
    stopOnDeviceSpeech();
    void playBatchAt(idx, runId, units, {
      ...opts,
      startCharOffsetInBatch: resumeCharOffset,
    });
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
    activeCursorCharInBatchRef.current = 0;
    playbackRunIdRef.current += 1;
    const runId = playbackRunIdRef.current;
    activeAiTtsAbortRef.current?.abort();
    activeAiTtsAbortRef.current = null;
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
      startCharOffsetInBatch?: number;
    }
  ) => {
    if (playbackRunIdRef.current !== runId || !isPlayingRef.current) return;

    if (index >= units.length) {
      // Sleep Timer default (empty / 0): stop smoothly at end of current chapter
      if (sleepTimerConfigRef.current.mode === 'chapter') {
        try {
          await Promise.all([
            filteredPlayerRef.current?.fadeOutAndStop(2200),
            ambientSoundManager.fadeOutAndStopAll(2200),
          ]);
        } catch {
          // ignore
        }
        stopAllAudio(true);
        ambientSoundManager.stopAll();
        setInfoNotice('Đã hết chương — tự động dừng giọng đọc và nhạc nền.');
        return;
      }
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

    // Smart Mobile Pre-fetch: silently pre-process Chapters N+1 and N+2 into RAM cache while listening
    if (index === 0) {
      const liveChapters = bookRef.current.chapters || [];
      const curIdx = liveChapters.findIndex((c) => c.id === chapterRef.current.id);
      for (const offset of [1, 2]) {
        const upcoming = liveChapters[curIdx + offset];
        if (upcoming) {
          const cacheKey = `ch-preproc:${bookRef.current.id}:${upcoming.id}`;
          if (!ramCache.get(cacheKey)) {
            const preAnalyzed = analyzeChapterOnDevice(
              upcoming.title,
              upcoming.paragraphs || [],
              bookRef.current.readingStyle || 'novel'
            );
            ramCache.set(cacheKey, preAnalyzed);
          }
        }
      }
    }

    // Job 2: Pre-Read Lookahead AI inspects upcoming paragraphs AHEAD of the AI Voice Reader
    let effectiveSpokenText = unit.combinedText;
    if (preReadAiEnabledRef.current) {
      schedulePreReadLookahead(unit.firstParagraphIndex);
      const preReadEval = resolveBatchSpeechWithPreRead(
        unit.spans,
        preReadDecisionsRef.current,
        bookRef.current.title,
        repeatedLineSignaturesRef.current
      );
      if (preReadEval.shouldSkipBatch) {
        setPreReadStats((prev) => ({
          skipped: prev.skipped + Math.max(1, preReadEval.skippedCount),
          fixed: prev.fixed,
          lastReason: preReadEval.skipReason || 'Nội dung địa chỉ / thừa',
        }));
        await playBatchAt(index + 1, runId, batchedUnitsRef.current, opts);
        return;
      }
      effectiveSpokenText = preReadEval.spokenText;
      if (preReadEval.skippedCount > 0 || preReadEval.fixedCount > 0) {
        setPreReadStats((prev) => ({
          skipped: prev.skipped + preReadEval.skippedCount,
          fixed: prev.fixed + preReadEval.fixedCount,
          lastReason: preReadEval.skipReason || prev.lastReason,
        }));
      }
    }

    // Apply Personalized Pronunciation Dictionary + AI Smart Breathing Pauses before TTS
    effectiveSpokenText = applySmartBreathingPauses(applyPronunciationDict(effectiveSpokenText));
    const fullPreparedLen = Math.max(1, effectiveSpokenText.length);

    // Resume seamlessly from position D when hot-reloading mid-batch
    let spokenSegmentText = effectiveSpokenText;
    let baseCharOffset = 0;
    if (opts?.startCharOffsetInBatch && opts.startCharOffsetInBatch > 0) {
      const sliced = sliceRemainingSpeechFromCursor(
        effectiveSpokenText,
        opts.startCharOffsetInBatch
      );
      if (!sliced.remainingText) {
        activeCursorCharInBatchRef.current = 0;
        await playBatchAt(index + 1, runId, batchedUnitsRef.current);
        return;
      }
      spokenSegmentText = sliced.remainingText;
      baseCharOffset = sliced.effectiveStartOffset;
      activeCursorCharInBatchRef.current = baseCharOffset;
    } else {
      activeCursorCharInBatchRef.current = 0;
    }

    // Detect Spatial Audio Effect (inner_thought reverb / whisper / shout)
    const segType =
      unit.speakerId === 'narrator'
        ? 'narration'
        : /nội tâm|suy tư|thầm nghĩ/i.test(unit.emotionStyle)
        ? 'inner_thought'
        : 'dialogue';
    const spatialEffect = detectSpatialEffect(segType, unit.emotionStyle, spokenSegmentText);

    syncMediaSessionForUnit(unit, 'playing');

    const initialHighlight = resolveActiveHighlightInBatch(
      unit,
      Math.min(0.99, baseCharOffset / fullPreparedLen),
      baseCharOffset
    );
    onHighlightParagraphRef.current(
      initialHighlight.paragraphIndex,
      initialHighlight.paragraphRatio,
      initialHighlight.charOffsetInParagraph
    );
    onSyncReadingParagraphRef.current?.(
      initialHighlight.paragraphIndex,
      initialHighlight.charOffsetInParagraph
    );

    const params = resolveTtsParamsForSpeaker(
      unit.speakerId,
      unit.emotionStyle,
      undefined,
      opts?.voiceOverrides,
      opts?.styleOverride
    );

    // Strict TTS Router guard: NEVER silently fall back to System Default TTS when cloned embedding is missing
    if (params.missingEmbeddingError) {
      stopAllAudio(false);
      setErrorMsg(params.missingEmbeddingError);
      return;
    }

    // Zero-Latency Rolling RAM Queue: prefetch BOTH batch N+1 and N+2 while batch N plays
    for (const lookaheadOffset of [1, 2]) {
      const nextUnit = units[index + lookaheadOffset];
      if (!nextUnit || !params.useAiTts) continue;
      const nextSpoken = preReadAiEnabledRef.current
        ? resolveBatchSpeechWithPreRead(
            nextUnit.spans,
            preReadDecisionsRef.current,
            bookRef.current.title,
            repeatedLineSignaturesRef.current
          )
        : { shouldSkipBatch: false, spokenText: nextUnit.combinedText };
      if (!nextSpoken.shouldSkipBatch && nextSpoken.spokenText) {
        const preparedNextText = applySmartBreathingPauses(
          applyPronunciationDict(nextSpoken.spokenText)
        );
        const nextParams = resolveTtsParamsForSpeaker(
          nextUnit.speakerId,
          nextUnit.emotionStyle,
          undefined,
          opts?.voiceOverrides,
          opts?.styleOverride
        );
        if (nextParams.useAiTts && !nextParams.missingEmbeddingError) {
          void fetchAiTtsAudio(preparedNextText, nextParams, opts?.styleOverride);
        }
      }
    }

    let spokeOk = false;

    // Engine 1: Real Gemini AI TTS / Voice Design + Web Audio Tone Color EQ & Spatial Effects
    if (params.useAiTts) {
      const aiAudioUrl = await fetchAiTtsAudio(spokenSegmentText, params, opts?.styleOverride, {
        timeoutMs: 4200,
        abortSlot: 'playback',
      });
      if (playbackRunIdRef.current !== runId || !isPlayingRef.current) return;
      if (aiAudioUrl) {
        try {
          const activeSpeed = opts?.speedOverride ?? speedRef.current;
          let lastSyncedPara = initialHighlight.paragraphIndex;
          await getPlayer().play(
            aiAudioUrl,
            params.tone,
            activeSpeed,
            (ratio) => {
              if (playbackRunIdRef.current !== runId || !isPlayingRef.current) return;
              const currentBatchChar = Math.min(
                fullPreparedLen,
                baseCharOffset + Math.round(ratio * spokenSegmentText.length)
              );
              activeCursorCharInBatchRef.current = currentBatchChar;
              const batchRatio = Math.min(0.99, currentBatchChar / fullPreparedLen);
              const resolved = resolveActiveHighlightInBatch(unit, batchRatio, currentBatchChar);
              onHighlightParagraphRef.current(
                resolved.paragraphIndex,
                resolved.paragraphRatio,
                resolved.charOffsetInParagraph
              );
              if (resolved.paragraphIndex !== lastSyncedPara) {
                lastSyncedPara = resolved.paragraphIndex;
                onSyncReadingParagraphRef.current?.(
                  resolved.paragraphIndex,
                  resolved.charOffsetInParagraph
                );
              }
            },
            spatialEffect,
            params.speakerEmbedding
          );
          spokeOk = playbackRunIdRef.current === runId && isPlayingRef.current;
        } catch {
          spokeOk = false;
        }
      }
    }

    // Engine 2: Multi-voice on-device TTS fallback (100% offline Android/WebView)
    if (!spokeOk && playbackRunIdRef.current === runId && isPlayingRef.current) {
      spokeOk = await playBrowserBatch(
        unit,
        params.pitch,
        params.rate,
        params.voiceURI,
        runId,
        params.preferGender,
        params.voiceSlotIndex,
        opts?.speedOverride,
        spokenSegmentText,
        baseCharOffset,
        fullPreparedLen
      );
    }

    if (!spokeOk && isPlayingRef.current && playbackRunIdRef.current === runId) {
      stopAllAudio(false);
      setErrorMsg(
        'Không phát được âm thanh TTS trên thiết bị. Hãy kiểm tra âm lượng hoặc bật Text-to-Speech trên máy.'
      );
      return;
    }

    if (isPlayingRef.current && playbackRunIdRef.current === runId) {
      activeCursorCharInBatchRef.current = 0;
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

  // Preview uses the EXACT same AI Voice Design + EQ / on-device pipeline as actual audiobook playback!
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
    previewingIdRef.current = charId;
    setPreviewingId(charId);
    previewAbortRef.current?.abort();
    previewAbortRef.current = null;
    const runId = playbackRunIdRef.current;
    const base = draftCharAssignments[charId] || getAssignment(charId);
    const assign = override ? { ...base, ...override } : base;
    const params = resolveTtsParamsForSpeaker(charId, 'Tự nhiên', assign);
    const textToSpeak = sampleText || 'Xin chào, đây là giọng đọc thử của BOOKHAD.';

    if (params.missingEmbeddingError) {
      setErrorMsg(params.missingEmbeddingError);
      previewingIdRef.current = null;
      setPreviewingId(null);
      return;
    }

    try {
      let played = false;
      if (params.useAiTts) {
        const aiAudioUrl = await fetchAiTtsAudio(textToSpeak, params, undefined, {
          timeoutMs: 3000,
          abortSlot: 'preview',
        });
        if (aiAudioUrl && playbackRunIdRef.current === runId) {
          try {
            await getPlayer().play(
              aiAudioUrl,
              params.tone,
              speedRef.current,
              undefined,
              'none',
              params.speakerEmbedding
            );
            played = true;
          } catch {
            played = false;
          }
        }
      }
      if (!played && playbackRunIdRef.current === runId) {
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
      }
    } finally {
      if (playbackRunIdRef.current === runId) {
        previewingIdRef.current = null;
        setPreviewingId(null);
      }
    }
  };

  const currentUnit = batchedUnits[currentBatchIndex];
  const discoveredCharacters =
    scannedBookCharacters.length > 0
      ? scannedBookCharacters.slice(0, 10)
      : (analysis?.characters || []).filter((c) => c.id !== 'narrator').slice(0, 10);

  const shouldShowDrawer = isOpen && isReaderActive;

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
              <span>{strings.back}</span>
            </button>
          )}
          <h2 className="text-[14px] font-sans font-semibold truncate">
            {strings.listenBook}
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
        {/* 1. Enlarged 1.5x Play/Pause + Adjacent Compact Speed Cluster (No large "Tốc độ" header row) */}
        <div className="p-3 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 space-y-2.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  const prev = Math.max(0, currentBatchIndex - 1);
                  setCurrentBatchIndex(prev);
                  if (isPlaying) startPlaybackAt(prev);
                }}
                aria-label="Đoạn trước"
                className="w-8 h-8 rounded-full border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 flex items-center justify-center shrink-0"
              >
                <SkipBack className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                data-testid="audiobook-play-pause-btn"
                onClick={handleTogglePlay}
                aria-label={isPlaying ? strings.pause : strings.play}
                className="inline-flex items-center justify-center gap-2 px-7 min-h-[48px] rounded-full bg-amber-800 text-white text-sm font-bold whitespace-nowrap shrink-0 hover:bg-amber-900 active:scale-[0.98] transition-all shadow-md"
              >
                {isPlaying ? (
                  <Pause className="w-4 h-4 shrink-0" />
                ) : (
                  <Play className="w-4 h-4 shrink-0 ml-0.5" />
                )}
                <span>{isPlaying ? strings.pause : strings.play}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const next = Math.min(batchedUnits.length - 1, currentBatchIndex + 1);
                  setCurrentBatchIndex(next);
                  if (isPlaying) startPlaybackAt(next);
                }}
                aria-label="Đoạn tiếp theo"
                className="w-8 h-8 rounded-full border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 flex items-center justify-center shrink-0"
              >
                <SkipForward className="w-3.5 h-3.5" />
              </button>

              {(isPlaying || showMiniBar) && (
                <button
                  type="button"
                  onClick={() => stopAllAudio(true)}
                  aria-label="Dừng hẳn"
                  className="w-8 h-8 rounded-full border border-stone-300 dark:border-stone-700 text-stone-600 hover:text-red-600 flex items-center justify-center shrink-0"
                >
                  <Square className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Compact Speed Cluster placed right beside Play/Pause */}
            <div
              data-testid="audiobook-speed-cluster"
              className="inline-flex items-center gap-1 shrink-0"
            >
              <button
                type="button"
                onClick={() => applyReadingSpeed(stepReadingSpeed(playbackSpeed, -1))}
                disabled={playbackSpeed <= MIN_READING_SPEED}
                aria-label="Giảm tốc độ đọc 0.1"
                className="w-7 h-7 rounded-lg border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-800/80 text-xs font-bold text-stone-800 dark:text-stone-100 hover:border-amber-700 disabled:opacity-40 flex items-center justify-center"
              >
                −
              </button>
              <div className="inline-flex items-center rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-1.5 h-7 focus-within:border-amber-700">
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
                  className="w-9 text-center text-[11px] font-semibold tabular-nums bg-transparent text-stone-900 dark:text-stone-100 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="text-[10.5px] font-medium text-stone-500 select-none">x</span>
              </div>
              <button
                type="button"
                onClick={() => applyReadingSpeed(stepReadingSpeed(playbackSpeed, 1))}
                disabled={playbackSpeed >= MAX_READING_SPEED}
                aria-label="Tăng tốc độ đọc 0.1"
                className="w-7 h-7 rounded-lg border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-800/80 text-xs font-bold text-stone-800 dark:text-stone-100 hover:border-amber-700 disabled:opacity-40 flex items-center justify-center"
              >
                +
              </button>
            </div>
          </div>

          <label className="flex items-center justify-between gap-2 cursor-pointer pt-2 border-t border-stone-100 dark:border-stone-800">
            <span className="text-[11px] font-medium text-stone-700 dark:text-stone-300">
              {strings.highlightSpoken}
            </span>
            <input
              type="checkbox"
              checked={highlightSpokenText}
              onChange={(e) => onToggleHighlightSpoken?.(e.target.checked)}
              className="accent-amber-800 w-4 h-4 shrink-0"
            />
          </label>

          <label className="flex items-start justify-between gap-2 cursor-pointer pt-2 border-t border-stone-100 dark:border-stone-800">
            <div className="min-w-0">
              <div
                data-testid="ai-fix-errors-label"
                className="text-[11px] font-medium text-stone-700 dark:text-stone-300"
              >
                {strings.aiFixErrors}
              </div>
              <div
                data-testid="preread-ai-status"
                className="text-[10px] text-stone-500 dark:text-stone-400 leading-snug"
              >
                {preReadAiEnabled
                  ? preReadStats.skipped > 0 || preReadStats.fixed > 0
                    ? `Đã bỏ qua ${preReadStats.skipped} đoạn thừa · Sửa ${preReadStats.fixed} lỗi`
                    : 'Tự bỏ link/địa chỉ tải & sửa lỗi chữ trước khi đọc'
                  : 'Đang tắt — đọc nguyên văn từng dòng'}
              </div>
            </div>
            <input
              type="checkbox"
              data-testid="toggle-preread-ai-checkbox"
              checked={preReadAiEnabled}
              onChange={(e) => {
                const next = e.target.checked;
                setPreReadAiEnabled(next);
                preReadAiEnabledRef.current = next;
                try {
                  localStorage.setItem(PREREAD_AI_STORAGE_KEY, next ? '1' : '0');
                } catch {
                  // ignore storage errors
                }
              }}
              className="accent-amber-800 w-4 h-4 shrink-0 mt-0.5"
            />
          </label>

          {/* Sleep Timer (Hẹn giờ tắt — compact 1-row numeric inputs, empty = stop at end of chapter) */}
          <div
            data-testid="sleep-timer-section"
            className="pt-2 border-t border-stone-100 dark:border-stone-800 space-y-1"
          >
            <div className="flex items-center justify-between gap-1.5 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0 shrink-0">
                <Moon className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400 shrink-0" />
                <span className="text-[11px] font-semibold text-stone-700 dark:text-stone-300 whitespace-nowrap">
                  {strings.sleepTimer}:
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <label className="inline-flex items-center gap-1 text-[11px] text-stone-600 dark:text-stone-300">
                  <input
                    type="number"
                    data-testid="sleep-timer-hours-input"
                    inputMode="numeric"
                    min={0}
                    max={23}
                    step={1}
                    placeholder="0"
                    aria-label="Số giờ hẹn giờ tắt"
                    value={sleepHoursInput}
                    onChange={(e) => setSleepHoursInput(sanitizeSleepHoursInput(e.target.value))}
                    className="w-10 px-1 py-0.5 rounded-md border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-[11px] font-semibold text-center tabular-nums text-stone-900 dark:text-stone-100 focus:outline-none focus:border-amber-700 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="whitespace-nowrap">{strings.hours}</span>
                </label>

                <label className="inline-flex items-center gap-1 text-[11px] text-stone-600 dark:text-stone-300">
                  <input
                    type="number"
                    data-testid="sleep-timer-minutes-input"
                    inputMode="numeric"
                    min={0}
                    max={59}
                    step={1}
                    placeholder="0"
                    aria-label="Số phút hẹn giờ tắt (0 đến 59)"
                    value={sleepMinutesInput}
                    onChange={(e) => setSleepMinutesInput(sanitizeSleepMinutesInput(e.target.value))}
                    className="w-10 px-1 py-0.5 rounded-md border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-[11px] font-semibold text-center tabular-nums text-stone-900 dark:text-stone-100 focus:outline-none focus:border-amber-700 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="whitespace-nowrap">{strings.minutes}</span>
                </label>

                <button
                  type="button"
                  data-testid="sleep-timer-clear-btn"
                  disabled={!sleepHoursInput && !sleepMinutesInput}
                  onClick={() => {
                    setSleepHoursInput('');
                    setSleepMinutesInput('');
                  }}
                  aria-label="Xóa nhanh hẹn giờ tắt"
                  title="Xóa nhanh"
                  className="w-6 h-6 rounded-md border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-900 text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 disabled:opacity-35 flex items-center justify-center shrink-0"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 text-[10px]">
              <span
                data-testid="sleep-timer-hint"
                className="text-stone-400 dark:text-stone-500"
              >
                {strings.sleepTimerHint}
              </span>
              {sleepTimerConfig.mode === 'countdown' && sleepRemainingSec > 0 && (
                <span
                  data-testid="sleep-timer-countdown"
                  className="font-semibold px-1.5 py-0.5 rounded bg-amber-800/12 text-amber-900 dark:text-amber-300 tabular-nums shrink-0"
                >
                  Còn {formatSleepCountdown(sleepRemainingSec)}
                </span>
              )}
            </div>
          </div>
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

        {/* 2. Reading Voice Style Selector */}
        <section className="p-3 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 space-y-2">
          <div className="text-[11.5px] font-semibold text-stone-800 dark:text-stone-200">
            {strings.readingStyle}
          </div>
          <GlassSelect<BookReadingStyle>
            title={strings.readingStyle}
            ariaLabel="Chọn phong cách giọng đọc"
            value={readingStyle}
            options={readingStyleOptions}
            onChange={(nextStyle) => {
              onUpdateReadingStyle?.(nextStyle);
              hotReloadCurrentPlayback({ styleOverride: nextStyle });
            }}
          />
        </section>

        {/* 3. Narrator Voice Selector */}
        <section className="p-3 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11.5px] font-semibold text-stone-800 dark:text-stone-200">
              {strings.narrator}
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
              <span>{previewingId === 'narrator' ? strings.playing : strings.previewShort}</span>
            </button>
          </div>

          <GlassSelect
            title={strings.narrator}
            ariaLabel="Chọn giọng dẫn truyện"
            value={currentNarratorChoiceKey}
            placeholder={activeVoiceLabel}
            options={voiceSelectOptions}
            onChange={(key) => {
              const chosen = unifiedVoiceChoices.find((v) => v.key === key);
              if (!chosen) return;
              const wasPreviewingNarrator = previewingIdRef.current === 'narrator';
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
              const nextMap = applyNarratorVoiceToCharacters(
                bookRef.current.voiceAssignments || {},
                nextNarratorAssign
              );
              bookRef.current = { ...bookRef.current, voiceAssignments: nextMap };
              // Sync non-overridden character drafts to follow the updated Narrator voice
              setDraftCharAssignments((prevDraft) => {
                const synced: Record<string, CharacterVoiceAssignment> = {};
                for (const [cid, assign] of Object.entries(prevDraft)) {
                  synced[cid] = assign.isCustomOverride
                    ? assign
                    : { ...nextNarratorAssign, characterId: cid, isCustomOverride: false };
                }
                return synced;
              });
              if (onBatchUpdateVoiceAssignments) {
                onBatchUpdateVoiceAssignments(nextMap);
              } else {
                onUpdateVoiceAssignment('narrator', nextNarratorAssign);
              }
              setInfoNotice(`${strings.narrator}: ${chosen.label}`);
              // Seamless voice preview: if currently previewing narrator, immediately preview newly chosen voice
              if (wasPreviewingNarrator) {
                void handlePreviewVoiceChoice(
                  'narrator',
                  activeParagraphs[book.currentParagraphIndex || 0]?.slice(0, 80) ||
                    'Xin chào, đây là giọng dẫn truyện của BOOKHAD.',
                  nextNarratorAssign
                );
              } else {
                hotReloadCurrentPlayback({ voiceOverrides: nextMap });
              }
            }}
          />
        </section>

        {/* 4. Book-Wide Top 10 Character Voice Scan, Strict Locked Toggle & Confirm Button */}
        <section className="p-3 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-stone-800 dark:text-stone-200 min-w-0">
              <Users className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400 shrink-0" />
              <span className="truncate">
                {strings.characters}
                {discoveredCharacters.length > 0 ? ` (${discoveredCharacters.length}/10)` : ''}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                role="switch"
                aria-checked={characterVoicesEnabled}
                disabled={!characterVoicesConfigured}
                data-testid="toggle-character-voices-btn"
                title={
                  characterVoicesConfigured
                    ? 'Bật/tắt giọng nhân vật đã lưu'
                    : 'Hãy bấm Quét và Xác nhận lưu giọng nhân vật trước khi bật'
                }
                onClick={() => {
                  if (!characterVoicesConfigured) return;
                  const nextEnabled = !characterVoicesEnabled;
                  characterVoicesEnabledRef.current = nextEnabled;
                  bookRef.current = {
                    ...bookRef.current,
                    characterVoicesEnabled: nextEnabled,
                  };
                  onToggleCharacterVoices?.(nextEnabled);
                  setInfoNotice(
                    nextEnabled ? 'Đã bật giọng nhân vật.' : 'Đang đọc theo giọng dẫn truyện.'
                  );
                  hotReloadCurrentPlayback();
                }}
                aria-label={
                  !characterVoicesConfigured
                    ? 'Khóa giọng nhân vật — cần Quét và Xác nhận trước'
                    : characterVoicesEnabled
                    ? 'Tắt giọng nhân vật'
                    : 'Bật giọng nhân vật'
                }
                className={`inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full border text-[10.5px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  characterVoicesEnabled
                    ? 'border-amber-700/40 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200'
                    : 'border-stone-300 dark:border-stone-700 bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400'
                }`}
              >
                {!characterVoicesConfigured && <Lock className="w-2.5 h-2.5 shrink-0" />}
                <span>{characterVoicesEnabled ? strings.on : strings.off}</span>
                <span
                  className={`relative inline-flex w-7 h-4 rounded-full transition-colors ${
                    characterVoicesEnabled
                      ? 'bg-amber-800'
                      : 'bg-stone-300 dark:bg-stone-600'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-xs transition-transform ${
                      characterVoicesEnabled ? 'translate-x-3.5' : 'translate-x-0.5'
                    }`}
                  />
                </span>
              </button>

              <button
                type="button"
                data-testid="scan-characters-btn"
                onClick={() => {
                  const res = runOnDeviceCharacterScan();
                  const found = Math.max(0, res.characters.length - 1);
                  setInfoNotice(
                    found > 0
                      ? `Đã quét toàn bộ ${book.chapters.length} chương · Top ${found} nhân vật. Chọn giọng rồi bấm Xác nhận.`
                      : 'Không tìm thấy lời thoại nhân vật riêng trong sách.'
                  );
                }}
                className="px-3 py-1.5 rounded-full bg-amber-800 text-white text-[11px] font-semibold hover:bg-amber-900 shrink-0"
              >
                {strings.scan}
              </button>
            </div>
          </div>

          {!characterVoicesConfigured ? (
            <p className="text-[10.5px] text-stone-500 dark:text-stone-400 leading-snug">
              Nút bật đang khóa. Bấm <strong>Quét</strong> toàn bộ sách (tối đa 10 nhân vật), gán giọng rồi bấm <strong>Xác nhận</strong> để mở khóa.
            </p>
          ) : !characterVoicesEnabled ? (
            <p className="text-[10.5px] text-stone-500 dark:text-stone-400 leading-snug">
              Đang dùng giọng dẫn truyện cho mọi lời thoại.
            </p>
          ) : null}

          {discoveredCharacters.length > 0 && (
            <div className={`space-y-2 ${!characterVoicesEnabled ? 'opacity-60' : ''}`}>
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
                        <span>{previewingId === char.id ? strings.playing : strings.previewShort}</span>
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
                        const wasPreviewingChar = previewingIdRef.current === char.id;
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
                        if (wasPreviewingChar) {
                          void handlePreviewVoiceChoice(
                            char.id,
                            char.sampleQuote || char.voiceDescription,
                            updatedAssign
                          );
                        }
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
                  setLocalCharsConfigured(true);
                  characterVoicesEnabledRef.current = true;
                  bookRef.current = {
                    ...bookRef.current,
                    voiceAssignments: committed,
                    characterVoicesConfigured: true,
                    characterVoicesEnabled: true,
                  };
                  if (onBatchUpdateVoiceAssignments) {
                    onBatchUpdateVoiceAssignments(committed);
                  } else {
                    Object.entries(committed).forEach(([cid, assign]) => {
                      onUpdateVoiceAssignment(cid, assign);
                    });
                  }
                  onToggleCharacterVoices?.(true);
                  setHasPendingCharEdits(false);
                  setInfoNotice('Đã lưu & mở khóa giọng nhân vật cho toàn bộ sách.');
                  hotReloadCurrentPlayback({ voiceOverrides: committed });
                }}
                className={`w-full py-2 rounded-full text-[11.5px] font-semibold transition-colors ${
                  hasPendingCharEdits || !characterVoicesConfigured
                    ? 'bg-amber-800 hover:bg-amber-900 text-white shadow-sm'
                    : 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:opacity-90'
                }`}
              >
                {strings.confirm}
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
                {strings.ambientMusic}{ambientActiveCount > 0 ? ` (${ambientActiveCount})` : ''}
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
                readerMinimal
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

  return (
    <IosSheet
      isOpen={shouldShowDrawer}
      onClose={onClose}
      ariaLabel="Cài đặt nghe sách nói và giọng đọc"
      testId="reader-audio-drawer"
      variant={isDesktop ? 'drawer-right' : 'bottom-sheet'}
      inlineDesktop={isDesktop}
      showGrabHandle={!isDesktop}
      zIndexClass="z-[72]"
      backdropClassName={!isDesktop ? '!bg-black/15 !backdrop-blur-none' : ''}
      panelClassName={
        isDesktop
          ? 'w-[390px] shrink-0 sticky top-[52px] self-start h-auto max-h-[calc(100vh-52px)] text-stone-900 dark:text-stone-100 rounded-bl-[24px] flex flex-col overflow-hidden'
          : 'w-full max-w-lg h-auto max-h-[48dvh] rounded-t-[26px] text-stone-900 dark:text-stone-100 flex flex-col overflow-hidden'
      }
    >
      {panelBody}
    </IosSheet>
  );
};
