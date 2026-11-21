import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  ArrowLeft,
  Bookmark,
  BookMarked,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Disc3,
  Download,
  FileOutput,
  Headphones,
  Languages,
  Loader2,
  Menu,
  Music,
  Pause,
  Play,
  RotateCcw,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';
import type {
  AppBasicSettings,
  Book,
  ChapterAnalysis,
  CharacterVoiceAssignment,
  CustomAmbientTrack,
  CustomFontAsset,
  ExternalVoiceAsset,
  HighlightItem,
  ReaderSettings,
  TranslationMode,
} from '../types/book';
import {
  PAPER_THEMES,
  TARGET_LANGUAGES,
  downloadBlob,
  slugifyFilename,
} from '../utils/fileHelpers';
import {
  buildRenderedParagraphs,
  computeReadingProgress,
  isPageBookmarked,
  togglePageBookmark,
} from '../utils/textProcessing';
import {
  computeBookScreenPaginationSummary,
  findScreenPageForParagraph,
  findScreenPageForPosition,
  paginateChapterForViewport,
  resolveLocationForGlobalPage,
  type BookScreenPaginationSummary,
  type ScreenPage,
  type ScreenPageChunk,
} from '../utils/screenPaginator';
import {
  PAGE_TURN_STYLES,
  computeCornerCurlGeometry,
  computeInteractiveCornerCurlDrag,
  computeInteractiveSlideFade,
  getPageTurnAnimationClass,
  getVintagePaperTextureStyles,
} from '../utils/readerEffects';
import {
  bookPaginationRamCache,
  chapterPaginationRamCache,
} from '../utils/ramCache';
import { buildEpubBlob } from '../utils/epubBuilder';
import { ambientSoundManager } from '../utils/ambientSoundEngine';
import { getLanguagePackDefinition } from '../utils/languagePacks';
import {
  evaluateReaderTapZone,
  shouldShowReturnToListeningPill,
  syncSystemBarAppearance,
} from '../utils/edgeToEdge';
import {
  hasOriginalBookBackup,
  restoreOriginalBookFromBackup,
  translateEntireBookAndBuildEpub,
  translateParagraphsFast,
} from '../utils/bookTranslator';
import { triggerDeviceHaptic } from '../utils/deviceHardware';
import { unlockAudioPlaybackSync } from '../utils/deviceTtsEngine';
import {
  evaluateRightEdgeBackSwipe,
  isInRightEdgeBackZone,
  type EdgeSwipeStart,
} from '../utils/edgeSwipeBack';
import { ReaderSettingsDrawer } from './ReaderSettingsDrawer';
import { AudiobookStudioDrawer } from './AudiobookStudioDrawer';
import { AmbientSoundDrawer } from './AmbientSoundDrawer';
import { BookCleanupReviewModal } from './BookCleanupReviewModal';
import {
  applyBookCleanupByItemIds,
  type BookCleanupReport,
} from '../utils/aiContentCleaner';
import { runImportBookAiScan } from '../utils/aiContentCleanerClient';
import { GlassSelect, type GlassSelectOption } from './GlassSelect';
import { IosSheet } from './IosSheet';
import { useI18n } from '../contexts/LanguageContext';

interface ReaderViewProps {
  book: Book;
  initialOpenAudio?: boolean;
  basicSettings: AppBasicSettings;
  onBackToLibrary: () => void;
  onUpdateBook: (updated: Book) => void;
  onPatchBook?: (bookId: string, updater: (prev: Book) => Book) => void;
  onLogReadingTime: (seconds: number, bookId: string) => void;
  settings: ReaderSettings;
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void;
  customFonts: CustomFontAsset[];
  onAddCustomFont: (font: CustomFontAsset) => Promise<void>;
  externalVoices: ExternalVoiceAsset[];
  onAddExternalVoice: (voice: ExternalVoiceAsset) => Promise<void>;
  customAmbientTracks?: CustomAmbientTrack[];
  onAddCustomAmbientTrack?: (track: CustomAmbientTrack) => Promise<void>;
  onDeleteCustomAmbientTrack?: (trackId: string) => Promise<void>;
  onAudioPlayingChange?: (playing: boolean) => void;
  onAudioSessionActiveChange?: (active: boolean) => void;
  audioCommandSignal?: { action: 'toggle' | 'next' | 'stop'; tick: number } | null;
  audioDrawerToggleSignal?: number;
  isReaderActive?: boolean;
}

const WIDTH_CLASSES: Record<ReaderSettings['pageWidth'], string> = {
  narrow: 'max-w-xl',
  medium: 'max-w-2xl',
  wide: 'max-w-4xl',
  full: 'max-w-6xl',
};

const HIGHLIGHT_CLASSES: Record<HighlightItem['color'], string> = {
  amber: 'bg-amber-200/60 dark:bg-amber-700/35',
  emerald: 'bg-emerald-200/60 dark:bg-emerald-700/35',
  rose: 'bg-rose-200/60 dark:bg-rose-700/35',
  sky: 'bg-sky-200/60 dark:bg-sky-700/35',
};

interface CachedReadingPos {
  chapterIndex: number;
  paragraphIndex: number;
  pageIndex: number;
  charOffset: number;
  scrollRatio: number;
  updatedAt: number;
}

const READING_POS_STORAGE_PREFIX = 'bookhad_pos_';

function readCachedReadingPos(bookId: string): CachedReadingPos | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${READING_POS_STORAGE_PREFIX}${bookId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedReadingPos>;
    if (typeof parsed.chapterIndex !== 'number') return null;
    return {
      chapterIndex: Math.max(0, parsed.chapterIndex),
      paragraphIndex: Math.max(0, parsed.paragraphIndex ?? 0),
      pageIndex: Math.max(0, parsed.pageIndex ?? 0),
      charOffset: Math.max(0, parsed.charOffset ?? 0),
      scrollRatio: Math.min(1, Math.max(0, parsed.scrollRatio ?? 0)),
      updatedAt: parsed.updatedAt ?? 0,
    };
  } catch {
    return null;
  }
}

function writeCachedReadingPos(bookId: string, pos: CachedReadingPos): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${READING_POS_STORAGE_PREFIX}${bookId}`, JSON.stringify(pos));
  } catch {
    // Ignore storage quota errors
  }
}

function resolveSavedPositionForChapter(book: Book, targetChapterIdx: number): {
  paragraphIndex: number;
  pageIndex?: number;
  charOffset: number;
  scrollRatio: number;
} {
  const cached = readCachedReadingPos(book.id);
  const useCache =
    cached !== null &&
    cached.chapterIndex === targetChapterIdx &&
    (cached.updatedAt >= (book.lastReadAt || 0) ||
      (typeof book.currentPageIndex !== 'number' &&
        (cached.pageIndex > 0 || cached.charOffset > 0 || cached.scrollRatio > 0)));

  if (useCache && cached) {
    return {
      paragraphIndex: cached.paragraphIndex,
      pageIndex: cached.pageIndex,
      charOffset: cached.charOffset,
      scrollRatio: cached.scrollRatio,
    };
  }

  return {
    paragraphIndex: Math.max(0, book.currentParagraphIndex || 0),
    pageIndex:
      typeof book.currentPageIndex === 'number' ? Math.max(0, book.currentPageIndex) : undefined,
    charOffset: Math.max(0, book.currentPageCharOffset || 0),
    scrollRatio: Math.min(1, Math.max(0, book.currentScrollRatio || 0)),
  };
}

export const ReaderView: React.FC<ReaderViewProps> = ({
  book,
  initialOpenAudio = false,
  basicSettings,
  onBackToLibrary,
  onUpdateBook,
  onPatchBook,
  onLogReadingTime,
  settings,
  onUpdateSettings,
  customFonts,
  onAddCustomFont,
  externalVoices,
  onAddExternalVoice,
  customAmbientTracks = [],
  onAddCustomAmbientTrack = async () => {},
  onDeleteCustomAmbientTrack = async () => {},
  onAudioPlayingChange,
  onAudioSessionActiveChange,
  audioCommandSignal = null,
  audioDrawerToggleSignal = 0,
  isReaderActive = true,
}) => {
  const { strings } = useI18n();
  const [showToc, setShowToc] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAudio, setShowAudio] = useState(initialOpenAudio);
  const [showAmbient, setShowAmbient] = useState(false);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(false);
  // Clean Reader UI: default hidden chrome (only book text + bottom centered page counter); center-tap toggles menu
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [isAudioPlayingLocal, setIsAudioPlayingLocal] = useState(false);
  const [isAudioSessionActive, setIsAudioSessionActive] = useState(false);
  const [listeningChapterIndex, setListeningChapterIndex] = useState<number | null>(null);
  const [listeningPageIndex, setListeningPageIndex] = useState<number | null>(null);
  const [ambientActiveCount, setAmbientActiveCount] = useState(
    () => Object.keys(ambientSoundManager.getSnapshot().activeVolumes).length
  );
  const [autoPlaySignal, setAutoPlaySignal] = useState(0);
  const [togglePlaySignal, setTogglePlaySignal] = useState(0);

  useEffect(() => {
    return ambientSoundManager.subscribe((snap) => {
      setAmbientActiveCount(Object.keys(snap.activeVolumes).length);
    });
  }, []);

  useEffect(() => {
    if (initialOpenAudio) {
      setShowSettings(false);
      setShowAmbient(false);
      setShowAudio(true);
    }
  }, [initialOpenAudio]);

  useEffect(() => {
    if (audioDrawerToggleSignal > 0) {
      setShowSettings(false);
      setShowAmbient(false);
      setShowAudio((v) => !v);
    }
  }, [audioDrawerToggleSignal]);

  const [isTranslating, setIsTranslating] = useState(false);
  const [translateError, setTranslateError] = useState('');
  const [translateStatusMsg, setTranslateStatusMsg] = useState('');
  const [isScanningCleanup, setIsScanningCleanup] = useState(false);
  const [cleanScanVerified, setCleanScanVerified] = useState(false);
  const [cleanupReviewReport, setCleanupReviewReport] = useState<BookCleanupReport | null>(null);

  useEffect(() => {
    setCleanScanVerified(false);
  }, [book.id]);
  const [isTranslatingFullEpub, setIsTranslatingFullEpub] = useState(false);
  const [fullEpubProgress, setFullEpubProgress] = useState<{
    percent: number;
    message: string;
  } | null>(null);
  const fullTranslateAbortRef = useRef<AbortController | null>(null);

  const chapterIndex = Math.min(
    Math.max(0, book.currentChapterIndex),
    Math.max(0, book.chapters.length - 1)
  );
  const currentChapter = book.chapters[chapterIndex];

  const initialResolvedPos = resolveSavedPositionForChapter(book, chapterIndex);

  const [currentPageIndex, setCurrentPageIndex] = useState(() =>
    Math.max(0, initialResolvedPos.pageIndex ?? 0)
  );
  const [turnDirection, setTurnDirection] = useState<'next' | 'prev'>('next');
  const [turnTick, setTurnTick] = useState(0);
  const [liveTurn, setLiveTurn] = useState<
    | null
    | {
        mode: 'curl';
        direction: 'next' | 'prev';
        peel: number;
        isAnimating: boolean;
      }
    | {
        mode: 'slide';
        direction: 'next' | 'prev';
        translateXPx: number;
        opacity: number;
        progress: number;
        isAnimating: boolean;
      }
  >(null);
  const turnAnimRafRef = useRef<number | null>(null);
  const skipCssTurnAnimRef = useRef(false);
  const [spokenParaIndex, setSpokenParaIndex] = useState<number | null>(null);
  const [spokenCharOffset, setSpokenCharOffset] = useState(0);
  const [activeParaAction, setActiveParaAction] = useState<{
    paragraphIndex: number;
    copied?: boolean;
  } | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [fontsLoadedTick, setFontsLoadedTick] = useState(0);
  const [domHeightPenaltyPx, setDomHeightPenaltyPx] = useState(0);
  const [showPageJump, setShowPageJump] = useState(false);
  const [pageJumpInput, setPageJumpInput] = useState('1');
  const [stageSize, setStageSize] = useState<{ width: number; height: number }>(() => {
    if (typeof window === 'undefined') return { width: 360, height: 560 };
    const widthLimitMap: Record<ReaderSettings['pageWidth'], number> = {
      narrow: 576,
      medium: 672,
      wide: 896,
      full: 1152,
    };
    const rawW = window.innerWidth;
    const rawH = Math.max(300, window.innerHeight - 132);
    const horizPad = rawW >= 640 ? 64 : 32;
    const maxArticleW = widthLimitMap[settings.pageWidth] || 672;
    return {
      width: Math.max(220, Math.min(rawW - horizPad, maxArticleW)),
      height: Math.max(220, rawH - 36),
    };
  });

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pageMeasureBoxRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const overflowGuardPassesRef = useRef(0);
  const paraRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const dragStartXRef = useRef<number | null>(null);
  const dragStartYRef = useRef<number | null>(null);
  const isHorizontalDragRef = useRef(false);
  const suppressNextClickRef = useRef(false);
  const readerEdgeSwipeRef = useRef<EdgeSwipeStart | null>(null);
  const [readerEdgeSwipeProgress, setReaderEdgeSwipeProgress] = useState(0);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null);
  const pendingLastPageOnPrevChapterRef = useRef(false);
  const pendingTargetPageRef = useRef<number | null>(null);
  const hasUserTurnedRef = useRef(false);
  const isFollowingAudioRef = useRef(true);
  const lastSpokenPageIdxRef = useRef<number | null>(null);
  const anchorParagraphRef = useRef<number>(initialResolvedPos.paragraphIndex);
  const anchorCharOffsetRef = useRef<number>(initialResolvedPos.charOffset);
  const anchorPageIndexRef = useRef<number | null>(initialResolvedPos.pageIndex ?? null);
  const anchorScrollRatioRef = useRef<number>(initialResolvedPos.scrollRatio);
  const currentPageIndexRef = useRef<number>(currentPageIndex);
  currentPageIndexRef.current = currentPageIndex;

  const activeTheme = useMemo(() => {
    if (settings.paperTheme === 'custom') {
      return {
        id: 'custom' as const,
        label: 'Tùy chỉnh',
        bg: settings.customBgColor,
        text: settings.customTextColor,
        muted: settings.customTextColor,
        border: 'rgba(128,128,128,0.22)',
        surface: 'rgba(128,128,128,0.08)',
        isDark: false,
      };
    }
    return PAPER_THEMES.find((t) => t.id === settings.paperTheme) || PAPER_THEMES[0];
  }, [settings.paperTheme, settings.customBgColor, settings.customTextColor]);

  // Active reading time tracking (every 10 seconds while in ReaderView)
  useEffect(() => {
    const timer = window.setInterval(() => {
      onLogReadingTime(10, book.id);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [book.id, onLogReadingTime]);

  const translateCurrentChapter = async (targetLang: string) => {
    if (!currentChapter) return;
    setTranslateError('');
    setTranslateStatusMsg('');
    setIsTranslating(true);
    try {
      const result = await translateParagraphsFast({
        paragraphs: currentChapter.paragraphs,
        targetLang,
        contextTitle: `${book.title} - ${currentChapter.title}`,
      });

      const updatedChapters = book.chapters.map((ch, idx) =>
        idx === chapterIndex
          ? {
              ...ch,
              translations: {
                ...(ch.translations || {}),
                [targetLang]: {
                  targetLang,
                  paragraphs: result.translations,
                  translatedAt: Date.now(),
                },
              },
            }
          : ch
      );
      onUpdateBook({ ...book, chapters: updatedChapters });
      setTranslateStatusMsg(
        result.engine === 'on-device'
          ? `Đã dịch tức thì bằng gói ngôn ngữ trên máy (${targetLang.toUpperCase()}).`
          : `Đã dịch nhanh chương hiện tại sang ${getLanguagePackDefinition(targetLang).label}.`
      );
    } catch (err) {
      setTranslateError(err instanceof Error ? err.message : 'Lỗi dịch trực tiếp.');
    } finally {
      setIsTranslating(false);
    }
  };

  const handleTranslateEntireBookAndOverwriteEpub = async () => {
    if (isTranslatingFullEpub) return;
    setTranslateError('');
    setTranslateStatusMsg('');
    setIsTranslatingFullEpub(true);
    const controller = new AbortController();
    fullTranslateAbortRef.current = controller;

    try {
      const { overwrittenBook, epubBlob, translatedChapterCount } =
        await translateEntireBookAndBuildEpub({
          book,
          targetLang: settings.targetLang,
          signal: controller.signal,
          onProgress: ({ percent, message }) => {
            setFullEpubProgress({ percent, message });
          },
        });

      // Overwrite the book inside LaziRead library & switch display cleanly to overwritten text
      onUpdateBook(overwrittenBook);
      onUpdateSettings({ translationMode: 'original' });

      // Save / download overwritten EPUB file
      const epubFileName = `${slugifyFilename(overwrittenBook.title)}-${settings.targetLang}-epupdich.epub`;
      downloadBlob(epubBlob, epubFileName);

      setTranslateStatusMsg(
        `Đã AI dịch xong ${translatedChapterCount} chương, ghi đè trực tiếp vào sách trong Thư viện và lưu tệp ${epubFileName}!`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Lỗi dịch toàn bộ sách sang EPUB.';
      setTranslateError(msg);
    } finally {
      setIsTranslatingFullEpub(false);
      setFullEpubProgress(null);
      fullTranslateAbortRef.current = null;
    }
  };

  const handleRestoreOriginalBookText = () => {
    const restored = restoreOriginalBookFromBackup(book);
    if (!restored) return;
    onUpdateBook(restored);
    onUpdateSettings({ translationMode: 'original' });
    setTranslateStatusMsg('Đã khôi phục nội dung văn bản gốc ban đầu của sách.');
  };

  const handleTranslationModeChange = async (mode: TranslationMode) => {
    onUpdateSettings({ translationMode: mode });
    if (
      mode !== 'original' &&
      currentChapter &&
      !currentChapter.translations?.[settings.targetLang]
    ) {
      await translateCurrentChapter(settings.targetLang);
    }
  };

  const renderedParagraphs = useMemo(() => {
    if (!currentChapter) return [];
    return buildRenderedParagraphs(
      currentChapter,
      settings.translationMode,
      settings.targetLang
    );
  }, [currentChapter, settings.translationMode, settings.targetLang]);

  // Measure the real available phone/desktop viewport reading box so 1 frame = 1 exact page
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const widthLimitMap: Record<ReaderSettings['pageWidth'], number> = {
      narrow: 576,
      medium: 672,
      wide: 896,
      full: 1152,
    };

    const updateSize = () => {
      // Do not overwrite stageSize while ReaderView is hidden (display:none during background audio)
      if (!isReaderActive) return;
      const box = pageMeasureBoxRef.current || scrollContainerRef.current;
      if (box && (box.clientWidth < 80 || box.clientHeight < 80)) return;
      const rawW = box ? box.clientWidth : window.innerWidth;
      const rawH = box ? box.clientHeight : Math.max(300, window.innerHeight - 132);
      const padTop = Math.max(0, settings.marginTopPx ?? 12);
      const padBottom = Math.max(0, settings.marginBottomPx ?? 20);
      const padHoriz = Math.max(4, settings.marginHorizontalPx ?? 16);
      const horizPad = padHoriz * 2;
      const maxArticleW = widthLimitMap[settings.pageWidth] || 672;
      const contentW = Math.max(180, Math.min(rawW - horizPad, maxArticleW));
      // Subtract real box vertical padding + generous 20px clearance so text NEVER touches or hides behind bottom buttons
      const contentH = Math.max(180, Math.floor(rawH - padTop - padBottom - 20));
      setStageSize((prev) =>
        Math.abs(prev.width - contentW) > 3 || Math.abs(prev.height - contentH) > 3
          ? { width: contentW, height: contentH }
          : prev
      );
    };

    updateSize();
    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateSize) : null;
    if (ro && (pageMeasureBoxRef.current || scrollContainerRef.current)) {
      ro.observe((pageMeasureBoxRef.current || scrollContainerRef.current)!);
    }
    window.addEventListener('resize', updateSize);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, [
    settings.pageWidth,
    settings.readingMode,
    settings.marginTopPx,
    settings.marginBottomPx,
    settings.marginHorizontalPx,
    showAudio,
    showSettings,
    showAmbient,
    isReaderActive,
  ]);

  // Reset post-render DOM height penalty whenever typography or viewport geometry changes
  useEffect(() => {
    overflowGuardPassesRef.current = 0;
    setDomHeightPenaltyPx(0);
  }, [
    book.id,
    stageSize.width,
    stageSize.height,
    settings.fontFamily,
    settings.fontSize,
    settings.lineHeight,
    settings.paragraphSpacing,
    settings.letterSpacing,
    settings.fontWeight,
    settings.marginTopPx,
    settings.marginBottomPx,
    settings.marginHorizontalPx,
    settings.firstLineIndent,
    settings.dropCap,
    settings.columnsInPaginated,
    settings.translationMode,
    settings.targetLang,
    fontsLoadedTick,
  ]);

  // Re-run screen pagination once webfonts finish loading so exact glyph widths are measured
  useEffect(() => {
    if (typeof document === 'undefined' || !('fonts' in document)) return;
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled) setFontsLoadedTick((t) => t + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [settings.fontFamily]);

  const effectiveViewportHeight = Math.max(180, stageSize.height - domHeightPenaltyPx);

  // True screen-fitted pagination with invisible RAM cache for instant chapter/book resumption
  const screenPages = useMemo<ScreenPage[]>(() => {
    const cacheKey = `${book.id}:${currentChapter?.id || chapterIndex}:${
      renderedParagraphs.length
    }:${renderedParagraphs[0]?.original.length || 0}:${stageSize.width}x${effectiveViewportHeight}:${
      settings.fontFamily
    }:${settings.fontSize}:${settings.lineHeight}:${settings.paragraphSpacing}:${
      settings.letterSpacing
    }:${settings.fontWeight}:${settings.firstLineIndent ? 1 : 0}:${settings.dropCap ? 1 : 0}:${
      settings.columnsInPaginated
    }:${settings.translationMode}:${settings.targetLang}:${fontsLoadedTick}`;
    const cached = chapterPaginationRamCache.get(cacheKey) as ScreenPage[] | undefined;
    if (cached) return cached;
    const computed = paginateChapterForViewport({
      paragraphs: renderedParagraphs,
      chapterTitle: currentChapter?.title || book.title,
      viewportWidth: stageSize.width,
      viewportHeight: effectiveViewportHeight,
      settings,
    });
    chapterPaginationRamCache.set(cacheKey, computed);
    return computed;
  }, [
    book.id,
    currentChapter?.id,
    chapterIndex,
    renderedParagraphs,
    currentChapter?.title,
    book.title,
    stageSize.width,
    effectiveViewportHeight,
    settings.fontFamily,
    settings.fontSize,
    settings.lineHeight,
    settings.paragraphSpacing,
    settings.letterSpacing,
    settings.fontWeight,
    settings.firstLineIndent,
    settings.dropCap,
    settings.columnsInPaginated,
    settings.translationMode,
    settings.targetLang,
    fontsLoadedTick,
  ]);

  // Book-wide dynamic display pagination (RAM-cached across chapters for zero-lag flipping)
  const bookPaginationChapters = useMemo(
    () =>
      book.chapters.map((ch) => ({
        title: ch.title,
        paragraphs: buildRenderedParagraphs(ch, settings.translationMode, settings.targetLang),
      })),
    [book.chapters, settings.translationMode, settings.targetLang]
  );

  const bookPaginationSummary = useMemo<BookScreenPaginationSummary>(() => {
    const summaryKey = `${book.id}:${book.chapters.length}:${chapterIndex}:${screenPages.length}:${
      stageSize.width
    }x${effectiveViewportHeight}:${settings.fontFamily}:${settings.fontSize}:${
      settings.lineHeight
    }:${settings.paragraphSpacing}:${settings.letterSpacing}:${settings.fontWeight}:${
      settings.firstLineIndent ? 1 : 0
    }:${settings.dropCap ? 1 : 0}:${settings.columnsInPaginated}:${settings.translationMode}:${
      settings.targetLang
    }:${fontsLoadedTick}`;
    const cached = bookPaginationRamCache.get(summaryKey) as
      | BookScreenPaginationSummary
      | undefined;
    if (cached) return cached;
    const computed = computeBookScreenPaginationSummary({
      chapters: bookPaginationChapters,
      currentChapterIndex: chapterIndex,
      currentChapterPageCount: screenPages.length,
      viewportWidth: stageSize.width,
      viewportHeight: effectiveViewportHeight,
      settings,
    });
    bookPaginationRamCache.set(summaryKey, computed);
    return computed;
  }, [
    book.id,
    book.chapters.length,
    bookPaginationChapters,
    chapterIndex,
    screenPages.length,
    stageSize.width,
    effectiveViewportHeight,
    settings.fontFamily,
    settings.fontSize,
    settings.lineHeight,
    settings.paragraphSpacing,
    settings.letterSpacing,
    settings.fontWeight,
    settings.firstLineIndent,
    settings.dropCap,
    settings.columnsInPaginated,
    settings.translationMode,
    settings.targetLang,
    fontsLoadedTick,
  ]);

  // Post-render DOM overflow guard: guarantees text NEVER clips behind the bottom 3 buttons on any font or device
  useEffect(() => {
    if (settings.readingMode !== 'paginated' || !isReaderActive) return;
    if (overflowGuardPassesRef.current >= 3) return;
    const rafId = window.requestAnimationFrame(() => {
      const box = pageMeasureBoxRef.current;
      const art = articleRef.current;
      if (!box || !art) return;
      const cs = window.getComputedStyle(box);
      const padTop = parseFloat(cs.paddingTop || '0') || 0;
      const padBottom = parseFloat(cs.paddingBottom || '0') || 0;
      const availH = box.clientHeight - padTop - padBottom - 8;
      if (availH < 120) return;
      const overflowPx = Math.ceil(art.scrollHeight - availH);
      if (overflowPx > 2) {
        overflowGuardPassesRef.current += 1;
        setDomHeightPenaltyPx((prev) =>
          Math.min(Math.floor(stageSize.height * 0.45), prev + overflowPx + 14)
        );
      }
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [
    currentPageIndex,
    chapterIndex,
    screenPages,
    stageSize.height,
    domHeightPenaltyPx,
    settings.readingMode,
    isReaderActive,
  ]);

  // Keep user anchored on their exact reading page & character offset whenever fontSize or viewport re-paginates
  useEffect(() => {
    if (settings.readingMode !== 'paginated') return;
    if (pendingTargetPageRef.current !== null) {
      const requested = pendingTargetPageRef.current;
      pendingTargetPageRef.current = null;
      const clamped = Math.min(Math.max(0, requested), Math.max(0, screenPages.length - 1));
      const chunk = screenPages[clamped]?.chunks[0];
      if (chunk) {
        anchorParagraphRef.current = chunk.paragraphIndex;
        anchorCharOffsetRef.current = chunk.charOffset ?? 0;
      }
      anchorPageIndexRef.current = clamped;
      setCurrentPageIndex(clamped);
      syncReadingPosition({
        paragraphIndex: chunk?.paragraphIndex ?? anchorParagraphRef.current,
        pageIndex: clamped,
        charOffset: chunk?.charOffset ?? 0,
      });
      return;
    }
    if (pendingLastPageOnPrevChapterRef.current) {
      pendingLastPageOnPrevChapterRef.current = false;
      const lastIdx = Math.max(0, screenPages.length - 1);
      const lastChunk = screenPages[lastIdx]?.chunks[0];
      if (lastChunk) {
        anchorParagraphRef.current = lastChunk.paragraphIndex;
        anchorCharOffsetRef.current = lastChunk.charOffset ?? 0;
      }
      anchorPageIndexRef.current = lastIdx;
      setCurrentPageIndex(lastIdx);
      syncReadingPosition({
        paragraphIndex: lastChunk?.paragraphIndex ?? 0,
        pageIndex: lastIdx,
        charOffset: lastChunk?.charOffset ?? 0,
      });
      return;
    }
    const targetIdx = findScreenPageForPosition(screenPages, {
      paragraphIndex: anchorParagraphRef.current,
      charOffset: anchorCharOffsetRef.current,
      pageIndex: anchorPageIndexRef.current ?? undefined,
    });
    const clamped = Math.min(Math.max(0, targetIdx), Math.max(0, screenPages.length - 1));
    anchorPageIndexRef.current = clamped;
    setCurrentPageIndex((prev) => (prev === clamped ? prev : clamped));
  }, [screenPages, settings.readingMode]);

  // Keep exact spoken word visible: auto-flip smoothly when audio crosses a screen page boundary,
  // while NEVER yanking the user back if they manually turn to another page while listening.
  useEffect(() => {
    if (spokenParaIndex === null) {
      lastSpokenPageIdxRef.current = null;
      return;
    }
    if (settings.readingMode === 'paginated') {
      const targetPageIdx = findScreenPageForPosition(screenPages, {
        paragraphIndex: spokenParaIndex,
        charOffset: spokenCharOffset,
      });
      if (targetPageIdx < 0) return;

      setListeningChapterIndex((prev) => (prev === null ? chapterIndex : prev));
      if (listeningChapterIndex === null || listeningChapterIndex === chapterIndex) {
        setListeningPageIndex(targetPageIdx);
      }

      if (targetPageIdx === currentPageIndexRef.current) {
        // User is viewing the spoken page — keep auto-follow engaged
        isFollowingAudioRef.current = true;
        lastSpokenPageIdxRef.current = targetPageIdx;
        anchorParagraphRef.current = spokenParaIndex;
        anchorCharOffsetRef.current = spokenCharOffset;
        anchorPageIndexRef.current = targetPageIdx;
        return;
      }

      lastSpokenPageIdxRef.current = targetPageIdx;

      if (isFollowingAudioRef.current && targetPageIdx > currentPageIndexRef.current) {
        // Audio crossed forward onto a new screen page — auto-flip immediately
        hasUserTurnedRef.current = true;
        setTurnDirection('next');
        setTurnTick((t) => t + 1);
        currentPageIndexRef.current = targetPageIdx;
        anchorPageIndexRef.current = targetPageIdx;
        anchorParagraphRef.current = spokenParaIndex;
        anchorCharOffsetRef.current = spokenCharOffset;
        setCurrentPageIndex(targetPageIdx);
        syncReadingPosition({
          paragraphIndex: spokenParaIndex,
          pageIndex: targetPageIdx,
          charOffset: spokenCharOffset,
        });
      }
      return;
    }
    anchorParagraphRef.current = spokenParaIndex;
    anchorCharOffsetRef.current = spokenCharOffset;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spokenParaIndex, spokenCharOffset, settings.readingMode, screenPages]);

  // Smoothly scroll to active paragraph in scroll mode only when paragraph changes
  useEffect(() => {
    if (spokenParaIndex === null || settings.readingMode === 'paginated') return;
    const timer = window.setTimeout(() => {
      const el = paraRefs.current.get(spokenParaIndex);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 60);
    return () => window.clearTimeout(timer);
  }, [spokenParaIndex, settings.readingMode]);

  useEffect(() => {
    hasUserTurnedRef.current = false;
  }, [book.id]);

  // Restore exact saved page / character offset / scroll position when opening a book or switching chapters
  useEffect(() => {
    setActiveParaAction(null);
    if (pendingTargetPageRef.current !== null) {
      const requested = pendingTargetPageRef.current;
      const clamped = Math.min(Math.max(0, requested), Math.max(0, screenPages.length - 1));
      setCurrentPageIndex(clamped);
      const chunk = screenPages[clamped]?.chunks[0];
      anchorParagraphRef.current = chunk?.paragraphIndex ?? 0;
      anchorCharOffsetRef.current = chunk?.charOffset ?? 0;
      anchorPageIndexRef.current = clamped;
    } else if (pendingLastPageOnPrevChapterRef.current) {
      const lastIdx = Math.max(0, screenPages.length - 1);
      setCurrentPageIndex(lastIdx);
      const lastChunk = screenPages[lastIdx]?.chunks[0];
      anchorParagraphRef.current = lastChunk?.paragraphIndex ?? 0;
      anchorCharOffsetRef.current = lastChunk?.charOffset ?? 0;
      anchorPageIndexRef.current = lastIdx;
    } else {
      const saved = resolveSavedPositionForChapter(book, chapterIndex);
      anchorParagraphRef.current = saved.paragraphIndex;
      anchorCharOffsetRef.current = saved.charOffset;
      anchorPageIndexRef.current = saved.pageIndex ?? null;
      anchorScrollRatioRef.current = saved.scrollRatio;

      const startPage = findScreenPageForPosition(screenPages, {
        paragraphIndex: saved.paragraphIndex,
        charOffset: saved.charOffset,
        pageIndex: saved.pageIndex,
      });
      anchorPageIndexRef.current = startPage;
      setCurrentPageIndex(startPage);

      // In scroll mode, restore exact scroll position instead of jumping back to top of chapter
      if (settings.readingMode === 'scroll' && typeof window !== 'undefined') {
        const restoreScroll = () => {
          const maxScroll = Math.max(
            0,
            document.documentElement.scrollHeight - window.innerHeight
          );
          if (saved.scrollRatio > 0 && maxScroll > 0) {
            window.scrollTo({ top: Math.round(saved.scrollRatio * maxScroll), behavior: 'auto' });
          } else if (saved.paragraphIndex > 0) {
            const el = paraRefs.current.get(saved.paragraphIndex);
            if (el) {
              el.scrollIntoView({ behavior: 'auto', block: 'start' });
            }
          } else {
            window.scrollTo({ top: 0, behavior: 'auto' });
          }
        };
        const raf1 = window.requestAnimationFrame(() => {
          window.requestAnimationFrame(restoreScroll);
        });
        return () => window.cancelAnimationFrame(raf1);
      }
    }
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterIndex, book.id]);

  // Continuously save scroll position in vertical scroll mode so "Đọc tiếp" resumes at exact spot
  useEffect(() => {
    if (settings.readingMode !== 'scroll' || !isReaderActive || typeof window === 'undefined') {
      return;
    }
    let throttleTimer: number | null = null;
    const captureScrollPos = () => {
      const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const ratio = Math.min(1, Math.max(0, window.scrollY / maxScroll));
      anchorScrollRatioRef.current = ratio;

      // Find top-most visible paragraph
      let topPara = anchorParagraphRef.current;
      let bestTop = Number.POSITIVE_INFINITY;
      paraRefs.current.forEach((el, pIdx) => {
        const rect = el.getBoundingClientRect();
        if (rect.bottom >= 60 && Math.abs(rect.top - 64) < bestTop) {
          bestTop = Math.abs(rect.top - 64);
          topPara = pIdx;
        }
      });
      anchorParagraphRef.current = topPara;
      const estimatedPage = findScreenPageForParagraph(screenPages, topPara);
      anchorPageIndexRef.current = estimatedPage;

      syncReadingPosition({
        paragraphIndex: topPara,
        pageIndex: estimatedPage,
        charOffset: 0,
        scrollRatio: ratio,
      });
    };

    const onScroll = () => {
      if (throttleTimer !== null) return;
      throttleTimer = window.setTimeout(() => {
        throttleTimer = null;
        captureScrollPos();
      }, 240);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (throttleTimer !== null) window.clearTimeout(throttleTimer);
    };
  }, [settings.readingMode, isReaderActive, book.id, chapterIndex, screenPages]);

  // Auto-scroll effect in vertical scroll mode
  useEffect(() => {
    if (settings.readingMode !== 'scroll' || settings.autoScrollSpeed === 0) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    const timer = window.setInterval(() => {
      container.scrollTop += settings.autoScrollSpeed * 0.9;
    }, 32);

    return () => window.clearInterval(timer);
  }, [settings.readingMode, settings.autoScrollSpeed]);

  const cancelLiveTurnAnim = () => {
    if (turnAnimRafRef.current !== null) {
      window.cancelAnimationFrame(turnAnimRafRef.current);
      turnAnimRafRef.current = null;
    }
  };

  useEffect(() => {
    return () => cancelLiveTurnAnim();
  }, []);

  const commitPageChange = (
    nextPageIdx: number,
    direction: 'next' | 'prev',
    opts?: { skipCssAnim?: boolean }
  ) => {
    setActiveParaAction(null);
    setShowPageJump(false);
    hasUserTurnedRef.current = true;
    skipCssTurnAnimRef.current = Boolean(opts?.skipCssAnim);
    // Allow free manual page browsing during audio startup or playback without highlight ticks snapping back
    if (isAudioPlayingLocal || isAudioSessionActive || spokenParaIndex !== null) {
      isFollowingAudioRef.current =
        lastSpokenPageIdxRef.current !== null && nextPageIdx === lastSpokenPageIdxRef.current;
    } else {
      isFollowingAudioRef.current = false;
    }
    setTurnDirection(direction);
    setTurnTick((t) => t + 1);
    setCurrentPageIndex(nextPageIdx);
    currentPageIndexRef.current = nextPageIdx;
    anchorPageIndexRef.current = nextPageIdx;
    const firstChunk = screenPages[nextPageIdx]?.chunks[0];
    const nextPara = firstChunk ? firstChunk.paragraphIndex : anchorParagraphRef.current;
    const nextCharOffset = firstChunk?.charOffset ?? 0;
    anchorParagraphRef.current = nextPara;
    anchorCharOffsetRef.current = nextCharOffset;
    syncReadingPosition({
      paragraphIndex: nextPara,
      pageIndex: nextPageIdx,
      charOffset: nextCharOffset,
    });
    triggerDeviceHaptic('page', basicSettings.hapticFeedback !== false);
  };

  // Flicker-free smooth reflow: lock exact reading character anchor before typography/margin updates
  const applySmoothReaderSetting = (patch: Partial<ReaderSettings>) => {
    const liveIdx = Math.min(currentPageIndexRef.current, Math.max(0, screenPages.length - 1));
    const firstChunk = screenPages[liveIdx]?.chunks[0];
    if (firstChunk) {
      anchorParagraphRef.current = firstChunk.paragraphIndex;
      anchorCharOffsetRef.current = firstChunk.charOffset ?? 0;
    }
    anchorPageIndexRef.current = null;
    skipCssTurnAnimRef.current = true;
    onUpdateSettings(patch);
  };

  const goNextPageImmediate = (skipCssAnim = false) => {
    const liveIdx = Math.min(currentPageIndexRef.current, Math.max(0, screenPages.length - 1));
    if (liveIdx < screenPages.length - 1) {
      commitPageChange(liveIdx + 1, 'next', { skipCssAnim });
    } else if (chapterIndex < book.chapters.length - 1) {
      pendingLastPageOnPrevChapterRef.current = false;
      hasUserTurnedRef.current = true;
      skipCssTurnAnimRef.current = skipCssAnim;
      setTurnDirection('next');
      setTurnTick((t) => t + 1);
      goToChapter(chapterIndex + 1);
      triggerDeviceHaptic('page', basicSettings.hapticFeedback !== false);
    }
  };

  const goPrevPageImmediate = (skipCssAnim = false) => {
    const liveIdx = Math.min(currentPageIndexRef.current, Math.max(0, screenPages.length - 1));
    if (liveIdx > 0) {
      commitPageChange(liveIdx - 1, 'prev', { skipCssAnim });
    } else if (chapterIndex > 0) {
      pendingLastPageOnPrevChapterRef.current = true;
      hasUserTurnedRef.current = true;
      skipCssTurnAnimRef.current = skipCssAnim;
      setTurnDirection('prev');
      setTurnTick((t) => t + 1);
      goToChapter(chapterIndex - 1);
      triggerDeviceHaptic('page', basicSettings.hapticFeedback !== false);
    }
  };

  const animateCornerCurl = (
    direction: 'next' | 'prev',
    fromPeel: number,
    toPeel: number,
    durationMs: number,
    onDone?: () => void
  ) => {
    cancelLiveTurnAnim();
    const startTime = performance.now();
    const step = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / Math.max(80, durationMs));
      const eased = 1 - Math.pow(1 - t, 3);
      const currentPeel = fromPeel + (toPeel - fromPeel) * eased;
      setLiveTurn({
        mode: 'curl',
        direction,
        peel: currentPeel,
        isAnimating: true,
      });
      if (t < 1) {
        turnAnimRafRef.current = window.requestAnimationFrame(step);
      } else {
        turnAnimRafRef.current = null;
        setLiveTurn(null);
        onDone?.();
      }
    };
    turnAnimRafRef.current = window.requestAnimationFrame(step);
  };

  const animateSlideFade = (
    direction: 'next' | 'prev',
    fromX: number,
    toX: number,
    fromOpacity: number,
    toOpacity: number,
    durationMs: number,
    onDone?: () => void
  ) => {
    cancelLiveTurnAnim();
    const startTime = performance.now();
    const safeW = Math.max(180, stageSize.width);
    const step = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / Math.max(80, durationMs));
      const eased = 1 - Math.pow(1 - t, 3);
      const curX = fromX + (toX - fromX) * eased;
      const curOp = fromOpacity + (toOpacity - fromOpacity) * eased;
      setLiveTurn({
        mode: 'slide',
        direction,
        translateXPx: curX,
        opacity: Math.max(0, Math.min(1, curOp)),
        progress: Math.min(1, Math.abs(curX) / (safeW * 0.85)),
        isAnimating: true,
      });
      if (t < 1) {
        turnAnimRafRef.current = window.requestAnimationFrame(step);
      } else {
        turnAnimRafRef.current = null;
        setLiveTurn(null);
        onDone?.();
      }
    };
    turnAnimRafRef.current = window.requestAnimationFrame(step);
  };

  const goNextPage = () => {
    const liveIdx = Math.min(currentPageIndexRef.current, Math.max(0, screenPages.length - 1));
    const canGoNext = liveIdx < screenPages.length - 1 || chapterIndex < book.chapters.length - 1;
    if (!canGoNext) return;
    if (settings.readingMode === 'paginated' && settings.pageTurnStyle === 'curl') {
      if (turnAnimRafRef.current !== null) {
        cancelLiveTurnAnim();
        setLiveTurn(null);
        goNextPageImmediate(true);
        return;
      }
      animateCornerCurl('next', 0.04, 1, 290, () => goNextPageImmediate(true));
      return;
    }
    if (settings.readingMode === 'paginated' && settings.pageTurnStyle === 'slide') {
      if (turnAnimRafRef.current !== null) {
        cancelLiveTurnAnim();
        setLiveTurn(null);
        goNextPageImmediate(true);
        return;
      }
      animateSlideFade('next', 0, -(stageSize.width * 0.88), 1, 0, 210, () =>
        goNextPageImmediate(true)
      );
      return;
    }
    goNextPageImmediate(false);
  };

  const goPrevPage = () => {
    const liveIdx = Math.min(currentPageIndexRef.current, Math.max(0, screenPages.length - 1));
    const canGoPrev = liveIdx > 0 || chapterIndex > 0;
    if (!canGoPrev) return;
    if (settings.readingMode === 'paginated' && settings.pageTurnStyle === 'curl') {
      if (turnAnimRafRef.current !== null) {
        cancelLiveTurnAnim();
        setLiveTurn(null);
        goPrevPageImmediate(true);
        return;
      }
      animateCornerCurl('prev', 0.94, 0, 290, () => goPrevPageImmediate(true));
      return;
    }
    if (settings.readingMode === 'paginated' && settings.pageTurnStyle === 'slide') {
      if (turnAnimRafRef.current !== null) {
        cancelLiveTurnAnim();
        setLiveTurn(null);
        goPrevPageImmediate(true);
        return;
      }
      animateSlideFade('prev', 0, stageSize.width * 0.88, 1, 0, 210, () =>
        goPrevPageImmediate(true)
      );
      return;
    }
    goPrevPageImmediate(false);
  };

  // Keyboard & Phone Hardware Volume/PageUp-Down navigation
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
      const allowVolumeKeys = basicSettings.volumeKeyPageTurn !== false;
      if (settings.readingMode === 'paginated') {
        if (
          e.key === 'ArrowRight' ||
          (allowVolumeKeys && (e.key === 'AudioVolumeDown' || e.key === 'PageDown'))
        ) {
          if (e.key === 'AudioVolumeDown' || e.key === 'PageDown') e.preventDefault();
          goNextPage();
        } else if (
          e.key === 'ArrowLeft' ||
          (allowVolumeKeys && (e.key === 'AudioVolumeUp' || e.key === 'PageUp'))
        ) {
          if (e.key === 'AudioVolumeUp' || e.key === 'PageUp') e.preventDefault();
          goPrevPage();
        }
      } else if (allowVolumeKeys && scrollContainerRef.current) {
        if (e.key === 'AudioVolumeDown' || e.key === 'PageDown') {
          e.preventDefault();
          scrollContainerRef.current.scrollBy({ top: window.innerHeight * 0.78, behavior: 'smooth' });
          triggerDeviceHaptic('page', basicSettings.hapticFeedback !== false);
        } else if (e.key === 'AudioVolumeUp' || e.key === 'PageUp') {
          e.preventDefault();
          scrollContainerRef.current.scrollBy({ top: -window.innerHeight * 0.78, behavior: 'smooth' });
          triggerDeviceHaptic('page', basicSettings.hapticFeedback !== false);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    settings.readingMode,
    screenPages.length,
    currentPageIndex,
    chapterIndex,
    basicSettings.volumeKeyPageTurn,
    basicSettings.hapticFeedback,
  ]);

  const patchActiveBook = (updater: (prev: Book) => Book) => {
    if (onPatchBook) {
      onPatchBook(book.id, updater);
    } else {
      onUpdateBook(updater(book));
    }
  };

  const syncReadingPosition = (pos: {
    paragraphIndex: number;
    pageIndex?: number;
    charOffset?: number;
    scrollRatio?: number;
  }) => {
    const now = Date.now();
    const resolvedPageIndex =
      typeof pos.pageIndex === 'number'
        ? Math.max(0, pos.pageIndex)
        : Math.max(0, currentPageIndexRef.current);
    const resolvedCharOffset =
      typeof pos.charOffset === 'number'
        ? Math.max(0, pos.charOffset)
        : Math.max(0, anchorCharOffsetRef.current);
    const resolvedScrollRatio =
      typeof pos.scrollRatio === 'number'
        ? Math.min(1, Math.max(0, pos.scrollRatio))
        : anchorScrollRatioRef.current;

    writeCachedReadingPos(book.id, {
      chapterIndex,
      paragraphIndex: pos.paragraphIndex,
      pageIndex: resolvedPageIndex,
      charOffset: resolvedCharOffset,
      scrollRatio: resolvedScrollRatio,
      updatedAt: now,
    });

    patchActiveBook((prev) => {
      const safeChIdx = Math.min(
        Math.max(0, prev.currentChapterIndex),
        Math.max(0, prev.chapters.length - 1)
      );
      const pct = computeReadingProgress(prev.chapters, safeChIdx, pos.paragraphIndex);
      return {
        ...prev,
        currentParagraphIndex: pos.paragraphIndex,
        currentPageIndex: resolvedPageIndex,
        currentPageCharOffset: resolvedCharOffset,
        currentScrollRatio: resolvedScrollRatio,
        progressPercent: pct,
        lastReadAt: now,
      };
    });
  };

  const syncParagraphPosition = (paraIdx: number, charOffset = 0, forceManual = false) => {
    if (!forceManual && !isFollowingAudioRef.current && settings.readingMode === 'paginated') {
      return;
    }
    const targetPage =
      settings.readingMode === 'paginated'
        ? findScreenPageForPosition(screenPages, {
            paragraphIndex: paraIdx,
            charOffset,
          })
        : currentPageIndexRef.current;
    anchorParagraphRef.current = paraIdx;
    anchorCharOffsetRef.current = Math.max(0, charOffset);
    anchorPageIndexRef.current = targetPage;
    syncReadingPosition({
      paragraphIndex: paraIdx,
      pageIndex: targetPage,
      charOffset: Math.max(0, charOffset),
    });
  };

  const flushLivePosition = () => {
    const safeIdx = Math.min(
      Math.max(0, currentPageIndexRef.current),
      Math.max(0, screenPages.length - 1)
    );
    const firstChunk = screenPages[safeIdx]?.chunks[0];
    const livePara = firstChunk?.paragraphIndex ?? anchorParagraphRef.current;
    const liveCharOffset = firstChunk?.charOffset ?? anchorCharOffsetRef.current;
    let liveScrollRatio = anchorScrollRatioRef.current;
    if (settings.readingMode === 'scroll' && typeof window !== 'undefined') {
      const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      liveScrollRatio = Math.min(1, Math.max(0, window.scrollY / maxScroll));
    }
    syncReadingPosition({
      paragraphIndex: livePara,
      pageIndex: safeIdx,
      charOffset: liveCharOffset,
      scrollRatio: liveScrollRatio,
    });
  };

  const flushLivePositionRef = useRef(flushLivePosition);
  flushLivePositionRef.current = flushLivePosition;

  // Guarantee exact exit page is saved on mobile backgrounding / tab close / unmount
  useEffect(() => {
    const handleVisibilityOrHide = () => {
      if (document.visibilityState === 'hidden') {
        flushLivePositionRef.current();
      }
    };
    const handlePageHide = () => {
      flushLivePositionRef.current();
    };
    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityOrHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityOrHide);
      flushLivePositionRef.current();
    };
  }, []);

  const handleBackToLibraryClick = () => {
    flushLivePosition();
    onBackToLibrary();
  };

  const goToChapter = (
    idx: number,
    opts?: { targetPageIndex?: number; targetParagraphIndex?: number }
  ) => {
    const clamped = Math.min(Math.max(0, idx), book.chapters.length - 1);
    hasUserTurnedRef.current = true;
    setTurnDirection(clamped >= chapterIndex ? 'next' : 'prev');
    setTurnTick((t) => t + 1);

    const targetPara = opts?.targetParagraphIndex ?? 0;
    const targetPage = typeof opts?.targetPageIndex === 'number' ? opts.targetPageIndex : 0;
    if (typeof opts?.targetPageIndex === 'number') {
      pendingTargetPageRef.current = opts.targetPageIndex;
    } else {
      pendingTargetPageRef.current = null;
    }
    if (!pendingLastPageOnPrevChapterRef.current) {
      anchorParagraphRef.current = targetPara;
      anchorCharOffsetRef.current = 0;
      anchorPageIndexRef.current = targetPage;
      anchorScrollRatioRef.current = 0;
    }

    if (
      clamped === chapterIndex &&
      typeof opts?.targetPageIndex === 'number' &&
      settings.readingMode === 'paginated'
    ) {
      const clampedPage = Math.min(
        Math.max(0, opts.targetPageIndex),
        Math.max(0, screenPages.length - 1)
      );
      pendingTargetPageRef.current = null;
      if (isAudioPlayingLocal || spokenParaIndex !== null) {
        isFollowingAudioRef.current =
          lastSpokenPageIdxRef.current !== null && clampedPage === lastSpokenPageIdxRef.current;
      }
      setCurrentPageIndex(clampedPage);
      currentPageIndexRef.current = clampedPage;
      anchorPageIndexRef.current = clampedPage;
      const chunk = screenPages[clampedPage]?.chunks[0];
      if (chunk) {
        anchorParagraphRef.current = chunk.paragraphIndex;
        anchorCharOffsetRef.current = chunk.charOffset ?? 0;
        syncReadingPosition({
          paragraphIndex: chunk.paragraphIndex,
          pageIndex: clampedPage,
          charOffset: chunk.charOffset ?? 0,
          scrollRatio: 0,
        });
      }
      setShowToc(false);
      setShowPageJump(false);
      return;
    }

    const now = Date.now();
    writeCachedReadingPos(book.id, {
      chapterIndex: clamped,
      paragraphIndex: targetPara,
      pageIndex: pendingLastPageOnPrevChapterRef.current ? 0 : targetPage,
      charOffset: 0,
      scrollRatio: 0,
      updatedAt: now,
    });

    const pct = computeReadingProgress(book.chapters, clamped, targetPara);
    patchActiveBook((prev) => ({
      ...prev,
      currentChapterIndex: clamped,
      currentParagraphIndex: targetPara,
      currentPageIndex: pendingLastPageOnPrevChapterRef.current ? undefined : targetPage,
      currentPageCharOffset: 0,
      currentScrollRatio: 0,
      progressPercent: pct,
      lastReadAt: now,
    }));
    setShowToc(false);
  };

  const toggleHighlight = (paraIdx: number, color: HighlightItem['color']) => {
    if (!currentChapter) return;
    const existing = book.highlights.find(
      (h) => h.chapterId === currentChapter.id && h.paragraphIndex === paraIdx
    );
    if (existing && existing.color === color) {
      onUpdateBook({
        ...book,
        highlights: book.highlights.filter((h) => h.id !== existing.id),
      });
    } else {
      const filtered = book.highlights.filter(
        (h) => !(h.chapterId === currentChapter.id && h.paragraphIndex === paraIdx)
      );
      onUpdateBook({
        ...book,
        highlights: [
          ...filtered,
          {
            id: `hl-${Date.now()}`,
            chapterId: currentChapter.id,
            paragraphIndex: paraIdx,
            text: currentChapter.paragraphs[paraIdx] || '',
            color,
            createdAt: Date.now(),
          },
        ],
      });
    }
    setActiveParaAction(null);
  };

  const handleSaveAnalysis = (
    chapterId: string,
    analysis: ChapterAnalysis,
    mergedVoiceAssignments?: Record<string, CharacterVoiceAssignment>
  ) => {
    patchActiveBook((prev) => ({
      ...prev,
      chapters: prev.chapters.map((c) => (c.id === chapterId ? { ...c, analysis } : c)),
      ...(mergedVoiceAssignments
        ? {
            voiceAssignments: {
              ...(prev.voiceAssignments || {}),
              ...mergedVoiceAssignments,
            },
          }
        : {}),
    }));
  };

  const handleUpdateVoiceAssignment = (
    characterId: string,
    assignment: CharacterVoiceAssignment
  ) => {
    patchActiveBook((prev) => ({
      ...prev,
      voiceAssignments: {
        ...(prev.voiceAssignments || {}),
        [characterId]: assignment,
      },
    }));
  };

  const handleExportCurrentEpub = async () => {
    setIsExporting(true);
    try {
      const blob = await buildEpubBlob(book, {
        translationMode: settings.translationMode,
        targetLang: settings.targetLang,
      });
      const suffix =
        settings.translationMode === 'bilingual'
          ? '-song-ngu'
          : settings.translationMode === 'override'
          ? `-${settings.targetLang}`
          : '';
      downloadBlob(blob, `${slugifyFilename(book.title)}${suffix}.epub`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleContinueListenFromHere = () => {
    unlockAudioPlaybackSync();
    isFollowingAudioRef.current = true;
    lastSpokenPageIdxRef.current = null;
    setShowSettings(false);
    setShowAmbient(false);
    setShowToolsMenu(false);
    // Keep reading page unobstructed — playback runs inline with slim bottom bar & live word highlight
    setShowAudio(false);
    setAutoPlaySignal((s) => s + 1);
  };

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressOriginRef.current = null;
  };

  useEffect(() => {
    return () => clearLongPressTimer();
  }, []);

  const startParagraphLongPress = (
    paraIndex: number,
    clientX: number,
    clientY: number
  ) => {
    clearLongPressTimer();
    longPressTriggeredRef.current = false;
    longPressOriginRef.current = { x: clientX, y: clientY };
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      longPressTimerRef.current = null;
      syncParagraphPosition(paraIndex, 0, true);
      setActiveParaAction({ paragraphIndex: paraIndex });
      triggerDeviceHaptic('tap', basicSettings.hapticFeedback !== false);
    }, 450);
  };

  const handleParagraphPointerMove = (clientX: number, clientY: number) => {
    const origin = longPressOriginRef.current;
    if (!origin) return;
    if (Math.hypot(clientX - origin.x, clientY - origin.y) > 10) {
      clearLongPressTimer();
    }
  };

  const handleCanvasTapForPagination = (e: React.MouseEvent<HTMLDivElement>) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    if (activeParaAction !== null) {
      setActiveParaAction(null);
      return;
    }
    if ((e.target as HTMLElement).closest('button, select, input, a')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const xRatio = (e.clientX - rect.left) / Math.max(1, rect.width);
    const { zone } = evaluateReaderTapZone(xRatio);

    // Center 40% zone ALWAYS toggles Clean Reader UI menu chrome (in both paginated & scroll modes)
    if (zone === 'center-menu') {
      setIsMenuVisible((prev) => {
        const next = !prev;
        if (!next) {
          setShowQuickActions(false);
          setShowToolsMenu(false);
        }
        return next;
      });
      return;
    }

    if (settings.readingMode !== 'paginated' || !basicSettings.tapToTurnPage) return;
    if (isMenuVisible) {
      setIsMenuVisible(false);
      setShowQuickActions(false);
      setShowToolsMenu(false);
    }
    if (zone === 'prev') {
      goPrevPage();
    } else if (zone === 'next') {
      goNextPage();
    }
  };

  const isBottomRightCurlTouchZone = (clientX: number, clientY: number) => {
    if (typeof window === 'undefined') return false;
    return (
      settings.readingMode === 'paginated' &&
      settings.pageTurnStyle === 'curl' &&
      clientY >= window.innerHeight * 0.56 &&
      clientX >= window.innerWidth * 0.45
    );
  };

  const handleReaderRootPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (typeof window === 'undefined') return;
    suppressNextClickRef.current = false;
    // Never let right-edge back-swipe interfere with bottom bar buttons, controls, or bottom-right paper curl corner
    if ((e.target as HTMLElement).closest('button, select, input, footer')) return;
    if (isBottomRightCurlTouchZone(e.clientX, e.clientY)) return;
    if (isInRightEdgeBackZone(e.clientX, window.innerWidth)) {
      readerEdgeSwipeRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        viewportWidth: window.innerWidth,
      };
      setReaderEdgeSwipeProgress(0);
    }
  };

  const handleReaderRootPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!readerEdgeSwipeRef.current) return;
    if (e.pointerType === 'mouse' && e.buttons !== 1) return;
    const res = evaluateRightEdgeBackSwipe(readerEdgeSwipeRef.current, e.clientX, e.clientY);
    if (res.isHorizontalBack) {
      clearLongPressTimer();
      setReaderEdgeSwipeProgress(res.progress);
    }
  };

  const finishReaderRootEdgeSwipe = (clientX?: number, clientY?: number) => {
    const start = readerEdgeSwipeRef.current;
    readerEdgeSwipeRef.current = null;
    setReaderEdgeSwipeProgress(0);
    if (!start || typeof clientX !== 'number' || typeof clientY !== 'number') return;
    const res = evaluateRightEdgeBackSwipe(start, clientX, clientY);
    if (res.shouldNavigateBack) {
      suppressNextClickRef.current = true;
      triggerDeviceHaptic('tap', basicSettings.hapticFeedback !== false);
      handleBackToLibraryClick();
    }
  };

  const handleStagePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (settings.readingMode !== 'paginated') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    suppressNextClickRef.current = false;
    if ((e.target as HTMLElement).closest('button, select, input, footer')) return;
    // Upper right-edge inward swipe is reserved for global Back-to-Main-Screen gesture,
    // while bottom-right corner belongs to 3D Paper Corner Curl!
    if (
      typeof window !== 'undefined' &&
      !isBottomRightCurlTouchZone(e.clientX, e.clientY) &&
      isInRightEdgeBackZone(e.clientX, window.innerWidth)
    ) {
      return;
    }
    cancelLiveTurnAnim();
    dragStartXRef.current = e.clientX;
    dragStartYRef.current = e.clientY;
    isHorizontalDragRef.current = false;
  };

  const handleStagePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (settings.readingMode !== 'paginated' || dragStartXRef.current === null) return;
    if (e.pointerType === 'mouse' && e.buttons !== 1) return;
    const dx = e.clientX - dragStartXRef.current;
    const dy = e.clientY - (dragStartYRef.current ?? e.clientY);
    const isCurlMode = settings.pageTurnStyle === 'curl';
    const isSlideMode = settings.pageTurnStyle === 'slide';

    if (!isHorizontalDragRef.current) {
      // In curl mode allow diagonal bottom-right upward-left drag as well as horizontal drag
      const startedDiagonalCurl =
        isCurlMode && (Math.hypot(dx, dy) > 10 && (dx < -6 || dy < -10 || dx > 10));
      const startedHoriz = Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 0.95;
      if (startedDiagonalCurl || startedHoriz) {
        isHorizontalDragRef.current = true;
        clearLongPressTimer();
      } else {
        return;
      }
    }

    const liveIdx = Math.min(currentPageIndexRef.current, Math.max(0, screenPages.length - 1));
    const canGoNext = liveIdx < screenPages.length - 1 || chapterIndex < book.chapters.length - 1;
    const canGoPrev = liveIdx > 0 || chapterIndex > 0;

    if (isCurlMode) {
      const dragEval = computeInteractiveCornerCurlDrag(
        dx,
        dy,
        stageSize.width,
        stageSize.height
      );
      if (dragEval.direction === 'next' && !canGoNext) {
        setLiveTurn({
          mode: 'curl',
          direction: 'next',
          peel: Math.min(0.08, dragEval.progress * 0.2),
          isAnimating: false,
        });
        return;
      }
      if (dragEval.direction === 'prev' && !canGoPrev) {
        setLiveTurn(null);
        return;
      }
      const peel =
        dragEval.direction === 'next'
          ? Math.min(0.98, Math.max(0.02, dragEval.progress))
          : Math.max(0.02, Math.min(0.98, 1 - dragEval.progress));
      setLiveTurn({
        mode: 'curl',
        direction: dragEval.direction,
        peel,
        isAnimating: false,
      });
    } else if (isSlideMode) {
      const slideEval = computeInteractiveSlideFade(dx, stageSize.width);
      if ((slideEval.direction === 'next' && !canGoNext) || (slideEval.direction === 'prev' && !canGoPrev)) {
        // Gentle rubber-band resistance at book boundaries
        setLiveTurn({
          mode: 'slide',
          direction: slideEval.direction,
          translateXPx: dx * 0.22,
          opacity: 0.95,
          progress: 0.05,
          isAnimating: false,
        });
        return;
      }
      setLiveTurn({
        mode: 'slide',
        direction: slideEval.direction,
        translateXPx: slideEval.translateXPx,
        opacity: slideEval.opacity,
        progress: slideEval.progress,
        isAnimating: false,
      });
    }
  };

  const finishStageDrag = (clientX?: number, clientY?: number) => {
    clearLongPressTimer();
    const startX = dragStartXRef.current;
    const startY = dragStartYRef.current;
    const wasHorizontal = isHorizontalDragRef.current;
    dragStartXRef.current = null;
    dragStartYRef.current = null;
    isHorizontalDragRef.current = false;

    if (!wasHorizontal || startX === null || typeof clientX !== 'number') {
      if (liveTurn && !liveTurn.isAnimating) {
        setLiveTurn(null);
      }
      return;
    }

    suppressNextClickRef.current = true;
    const dx = clientX - startX;
    const dy = typeof clientY === 'number' && startY !== null ? clientY - startY : 0;
    const liveIdx = Math.min(currentPageIndexRef.current, Math.max(0, screenPages.length - 1));
    const canGoNext = liveIdx < screenPages.length - 1 || chapterIndex < book.chapters.length - 1;
    const canGoPrev = liveIdx > 0 || chapterIndex > 0;

    if (settings.pageTurnStyle === 'curl') {
      const dragEval = computeInteractiveCornerCurlDrag(
        dx,
        dy,
        stageSize.width,
        stageSize.height
      );
      if (dragEval.direction === 'next') {
        const curPeel = Math.min(0.98, Math.max(0.02, dragEval.progress));
        if (dragEval.shouldCommitFlip && canGoNext) {
          animateCornerCurl('next', curPeel, 1, 240, () => goNextPageImmediate(true));
        } else {
          animateCornerCurl('next', curPeel, 0, 180);
        }
      } else {
        const curPeel = Math.max(0.02, Math.min(0.98, 1 - dragEval.progress));
        if (dragEval.shouldCommitFlip && canGoPrev) {
          animateCornerCurl('prev', curPeel, 0, 240, () => goPrevPageImmediate(true));
        } else {
          animateCornerCurl('prev', curPeel, 1, 180);
        }
      }
      return;
    }

    if (settings.pageTurnStyle === 'slide') {
      const slideEval = computeInteractiveSlideFade(dx, stageSize.width);
      const canFlipDir = slideEval.direction === 'next' ? canGoNext : canGoPrev;
      if (slideEval.shouldCommitFlip && canFlipDir) {
        const targetX =
          slideEval.direction === 'next' ? -(stageSize.width * 0.96) : stageSize.width * 0.96;
        animateSlideFade(
          slideEval.direction,
          slideEval.translateXPx,
          targetX,
          slideEval.opacity,
          0,
          200,
          () => {
            if (slideEval.direction === 'next') {
              goNextPageImmediate(true);
            } else {
              goPrevPageImmediate(true);
            }
          }
        );
      } else {
        animateSlideFade(slideEval.direction, slideEval.translateXPx, 0, slideEval.opacity, 1, 180);
      }
      return;
    }

    setLiveTurn(null);
    if (Math.abs(dx) > 40) {
      if (dx < 0) {
        goNextPage();
      } else {
        goPrevPage();
      }
    }
  };

  const renderIlluminatedText = (
    text: string,
    isChunkSpoken: boolean,
    localCharOffset: number
  ) => {
    if (!isChunkSpoken || settings.highlightSpokenText === false) return text;
    const tokens = text.split(/(\s+)/);
    const clampedChar = Math.max(0, Math.min(Math.max(0, text.length - 1), localCharOffset));

    // Locate the EXACT single word token covering clampedChar (no box, no yellow block, no underline)
    let cursor = 0;
    let activeTokenIdx = -1;
    let lastWordTokenIdx = -1;
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      const start = cursor;
      const end = cursor + tok.length;
      cursor = end;
      if (tok.trim().length > 0) {
        lastWordTokenIdx = i;
        if (clampedChar >= start && clampedChar <= end) {
          activeTokenIdx = i;
          break;
        }
        if (activeTokenIdx === -1 && clampedChar < start) {
          activeTokenIdx = i;
          break;
        }
      }
    }
    if (activeTokenIdx === -1) activeTokenIdx = lastWordTokenIdx;

    return tokens.map((token, idx) => {
      if (idx !== activeTokenIdx || token.trim().length === 0) return token;
      return (
        <span
          key={idx}
          data-testid="spoken-active-word"
          style={{
            textShadow: '0 0 10px rgba(245, 158, 11, 0.55)',
            textDecoration: 'none',
          }}
          className="text-amber-600 dark:text-amber-300 font-semibold no-underline transition-colors duration-100"
        >
          {token}
        </span>
      );
    });
  };

  const safePageIndex = Math.min(currentPageIndex, Math.max(0, screenPages.length - 1));
  const globalCurrentPage =
    (bookPaginationSummary.chapterStartPageOffsets[chapterIndex] || 0) + safePageIndex + 1;
  const globalTotalPages = Math.max(1, bookPaginationSummary.totalBookPages);
  const activeScreenPage = screenPages[safePageIndex] || {
    pageIndex: 0,
    chunks: [],
    hasChapterHeader: true,
  };
  const visibleChunks: ScreenPageChunk[] =
    settings.readingMode === 'paginated'
      ? activeScreenPage.chunks
      : renderedParagraphs.map((p) => ({
          paragraphIndex: p.index,
          original: p.original,
          translated: p.translated,
          isFirstOfParagraph: true,
          isContinuation: false,
        }));

  const isPaginatedMode = settings.readingMode === 'paginated';
  const handleJumpToGlobalPage = (targetGlobalPage: number) => {
    const clamped = Math.max(1, Math.min(globalTotalPages, Math.round(targetGlobalPage)));
    const loc = resolveLocationForGlobalPage(bookPaginationSummary, clamped);
    setShowPageJump(false);
    if (isAudioPlayingLocal || spokenParaIndex !== null) {
      isFollowingAudioRef.current = false;
    }
    if (loc.chapterIndex === chapterIndex) {
      commitPageChange(loc.pageIndex, loc.pageIndex >= safePageIndex ? 'next' : 'prev');
    } else {
      goToChapter(loc.chapterIndex, { targetPageIndex: loc.pageIndex });
    }
  };
  const activePageAnchorParagraph =
    activeScreenPage.chunks[0]?.paragraphIndex ?? book.currentParagraphIndex ?? 0;
  const isCurrentPageBookmarked = isPageBookmarked(
    book.bookmarks,
    currentChapter?.id,
    safePageIndex,
    isPaginatedMode,
    activePageAnchorParagraph
  );

  const togglePageBookmarkHandler = (overrideParaIdx?: number) => {
    if (!currentChapter) return;
    const paraIdx =
      !isPaginatedMode && typeof overrideParaIdx === 'number'
        ? overrideParaIdx
        : activePageAnchorParagraph;
    const targetPage = isPaginatedMode ? safePageIndex : 0;
    const excerpt =
      activeScreenPage.chunks[0]?.original.slice(0, 100) ||
      currentChapter.paragraphs[paraIdx]?.slice(0, 100) ||
      currentChapter.title;
    const { nextBookmarks } = togglePageBookmark(book.bookmarks, {
      chapterId: currentChapter.id,
      chapterTitle: currentChapter.title,
      pageIndex: targetPage,
      isPaginated: isPaginatedMode,
      paragraphIndex: paraIdx,
      excerpt,
    });
    onUpdateBook({
      ...book,
      bookmarks: nextBookmarks,
    });
    triggerDeviceHaptic('tap', basicSettings.hapticFeedback !== false);
  };

  const translationModeOptions: GlassSelectOption<TranslationMode>[] = [
    { value: 'original', label: 'Văn bản gốc', subtitle: 'Hiển thị nguyên bản chưa dịch' },
    { value: 'override', label: 'Dịch đè', subtitle: 'Thay văn bản bằng bản dịch' },
    { value: 'bilingual', label: 'Song ngữ', subtitle: 'Hiện song song gốc & bản dịch' },
  ];

  const targetLangOptions: GlassSelectOption[] = TARGET_LANGUAGES.map((l) => ({
    value: l.code,
    label: l.label,
  }));

  const vintageTexture = getVintagePaperTextureStyles(activeTheme.id);
  const liveCurlGeom =
    isPaginatedMode && liveTurn?.mode === 'curl'
      ? computeCornerCurlGeometry(liveTurn.peel)
      : null;
  const liveSlideState =
    isPaginatedMode && liveTurn?.mode === 'slide'
      ? {
          ...liveTurn,
          underlayScale: Number((0.95 + 0.05 * Math.min(1, Math.max(0, liveTurn.progress))).toFixed(4)),
          underlayOpacity: Number((0.72 + 0.28 * Math.min(1, Math.max(0, liveTurn.progress))).toFixed(3)),
          underlayBrightness: Number((0.86 + 0.14 * Math.min(1, Math.max(0, liveTurn.progress))).toFixed(3)),
          edgeShadowOpacity: Number((0.28 * (1 - Math.min(1, Math.max(0, liveTurn.progress)) * 0.6)).toFixed(3)),
        }
      : null;

  // Resolve adjacent Next / Prev page content for true two-layer curl & slide-fade reveal
  const adjacentNextPage = useMemo<{
    page: ScreenPage;
    chapterTitle: string;
    chapterNum: number;
  } | null>(() => {
    if (!isPaginatedMode) return null;
    if (safePageIndex < screenPages.length - 1) {
      return {
        page: screenPages[safePageIndex + 1],
        chapterTitle: currentChapter?.title || book.title,
        chapterNum: chapterIndex + 1,
      };
    }
    const nextCh = book.chapters[chapterIndex + 1];
    if (!nextCh) return null;
    const nextRendered = buildRenderedParagraphs(
      nextCh,
      settings.translationMode,
      settings.targetLang
    );
    const nextPages = paginateChapterForViewport({
      paragraphs: nextRendered,
      chapterTitle: nextCh.title,
      viewportWidth: stageSize.width,
      viewportHeight: effectiveViewportHeight,
      settings,
    });
    return nextPages[0]
      ? { page: nextPages[0], chapterTitle: nextCh.title, chapterNum: chapterIndex + 2 }
      : null;
  }, [
    isPaginatedMode,
    safePageIndex,
    screenPages,
    currentChapter?.title,
    book.title,
    book.chapters,
    chapterIndex,
    settings,
    stageSize.width,
    effectiveViewportHeight,
  ]);

  const adjacentPrevPage = useMemo<{
    page: ScreenPage;
    chapterTitle: string;
    chapterNum: number;
  } | null>(() => {
    if (!isPaginatedMode) return null;
    if (safePageIndex > 0) {
      return {
        page: screenPages[safePageIndex - 1],
        chapterTitle: currentChapter?.title || book.title,
        chapterNum: chapterIndex + 1,
      };
    }
    const prevCh = book.chapters[chapterIndex - 1];
    if (!prevCh) return null;
    const prevRendered = buildRenderedParagraphs(
      prevCh,
      settings.translationMode,
      settings.targetLang
    );
    const prevPages = paginateChapterForViewport({
      paragraphs: prevRendered,
      chapterTitle: prevCh.title,
      viewportWidth: stageSize.width,
      viewportHeight: effectiveViewportHeight,
      settings,
    });
    const last = prevPages[prevPages.length - 1];
    return last
      ? { page: last, chapterTitle: prevCh.title, chapterNum: chapterIndex }
      : null;
  }, [
    isPaginatedMode,
    safePageIndex,
    screenPages,
    currentChapter?.title,
    book.title,
    book.chapters,
    chapterIndex,
    settings,
    stageSize.width,
    effectiveViewportHeight,
  ]);

  // Decide which page is underneath vs on top during live curl / slide-fade
  const underlayTarget =
    liveTurn?.mode === 'curl'
      ? liveTurn.direction === 'next'
        ? adjacentNextPage
        : {
            page: activeScreenPage,
            chapterTitle: currentChapter?.title || book.title,
            chapterNum: chapterIndex + 1,
          }
      : liveTurn?.mode === 'slide'
      ? liveTurn.direction === 'next'
        ? adjacentNextPage
        : adjacentPrevPage
      : null;

  const isCurlPrevPeelingBack = liveTurn?.mode === 'curl' && liveTurn.direction === 'prev' && Boolean(adjacentPrevPage);
  const topLayerPage = isCurlPrevPeelingBack && adjacentPrevPage ? adjacentPrevPage.page : activeScreenPage;
  const topLayerChapterTitle =
    isCurlPrevPeelingBack && adjacentPrevPage
      ? adjacentPrevPage.chapterTitle
      : currentChapter?.title || '';
  const topLayerChapterNum =
    isCurlPrevPeelingBack && adjacentPrevPage ? adjacentPrevPage.chapterNum : chapterIndex + 1;
  const topLayerChunks: ScreenPageChunk[] = isPaginatedMode
    ? topLayerPage.chunks
    : visibleChunks;

  const pageTurnClass =
    isPaginatedMode &&
    !liveTurn &&
    !skipCssTurnAnimRef.current &&
    hasUserTurnedRef.current &&
    turnTick > 0
      ? getPageTurnAnimationClass(settings.pageTurnStyle, turnDirection)
      : '';
  const activeTurnLabel =
    PAGE_TURN_STYLES.find((s) => s.id === (settings.pageTurnStyle || 'curl'))?.label ||
    'Lật cong góc 3D';

  const renderStaticPageContent = (target: {
    page: ScreenPage;
    chapterTitle: string;
    chapterNum: number;
  }) => (
    <div
      className={`mx-auto ${WIDTH_CLASSES[settings.pageWidth]}`}
      style={{
        fontFamily: settings.fontFamily,
        fontSize: `${settings.fontSize}px`,
        lineHeight: settings.lineHeight,
        letterSpacing: `${settings.letterSpacing}em`,
        fontWeight: settings.fontWeight,
        textAlign: settings.textAlign,
      }}
    >
      {target.page.hasChapterHeader && (
        <header
          className="mb-2 pb-1.5 border-b"
          style={{ borderColor: activeTheme.border }}
        >
          <p className="text-[8.5px] sm:text-[9.5px] uppercase tracking-wider opacity-60 font-sans mb-0.5 tabular-nums truncate">
            {book.title} · Ch.{target.chapterNum}/{book.chapters.length}
          </p>
          <h1 className="text-[11px] sm:text-[13px] font-display font-semibold leading-tight text-left truncate">
            {target.chapterTitle}
          </h1>
        </header>
      )}
      <div className={settings.columnsInPaginated === 2 ? 'md:columns-2 md:gap-10' : ''}>
        {target.page.chunks.map((chunk, idx) => {
          const useDropCap =
            settings.dropCap &&
            chunk.paragraphIndex === 0 &&
            chunk.isFirstOfParagraph &&
            idx === 0;
          return (
            <div
              key={`u-${chunk.paragraphIndex}-${idx}`}
              style={{ marginBottom: `${settings.paragraphSpacing}px` }}
              className="relative rounded-lg px-1.5 py-0.5 select-none"
            >
              <p
                className={`${useDropCap ? 'editorial-dropcap' : ''} ${
                  settings.firstLineIndent && chunk.isFirstOfParagraph && !useDropCap
                    ? 'indent-7'
                    : ''
                }`}
              >
                {chunk.original}
              </p>
              {chunk.translated && (
                <p className="mt-2 pl-4 opacity-75 italic text-[0.92em]">
                  {chunk.translated}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  // Sync Android Edge-to-Edge Status Bar color & clock/icon contrast with active Reader paper theme
  useEffect(() => {
    if (!isReaderActive) return;
    syncSystemBarAppearance({
      backgroundHex: activeTheme.bg,
      isDark: activeTheme.isDark,
    });
  }, [isReaderActive, activeTheme.bg, activeTheme.isDark]);

  const showReturnToListeningBtn = shouldShowReturnToListeningPill({
    isListeningActive: isAudioPlayingLocal || spokenParaIndex !== null,
    listeningChapterIndex,
    listeningPageIndex,
    currentChapterIndex: chapterIndex,
    currentPageIndex: safePageIndex,
    isPaginatedMode,
  });

  const handleReturnToListeningPage = () => {
    if (listeningChapterIndex === null) return;
    isFollowingAudioRef.current = true;
    const targetPage = listeningPageIndex ?? 0;
    if (listeningChapterIndex === chapterIndex) {
      commitPageChange(targetPage, targetPage >= safePageIndex ? 'next' : 'prev');
    } else {
      goToChapter(listeningChapterIndex, { targetPageIndex: targetPage });
    }
  };

  return (
    <div
      data-testid="reader-surface"
      data-menu-visible={isMenuVisible ? 'true' : 'false'}
      onPointerDown={handleReaderRootPointerDown}
      onPointerMove={handleReaderRootPointerMove}
      onPointerUp={(e) => finishReaderRootEdgeSwipe(e.clientX, e.clientY)}
      onPointerCancel={() => finishReaderRootEdgeSwipe()}
      style={{
        backgroundColor: activeTheme.bg,
        color: activeTheme.text,
        filter: `brightness(${settings.brightness}%) sepia(${settings.warmth}%)`,
        ...vintageTexture,
      }}
      className={`${
        isPaginatedMode ? 'h-[100dvh] overflow-hidden' : 'min-h-screen'
      } w-full flex flex-col transition-colors duration-200 relative`}
    >
      {/* Right-Edge Swipe-Back Visual Pill Indicator */}
      {readerEdgeSwipeProgress > 0.08 && (
        <div
          data-testid="reader-edge-back-indicator"
          aria-hidden="true"
          style={{
            transform: `translateY(-50%) translateX(${Math.round(-readerEdgeSwipeProgress * 18)}px) scale(${0.85 + readerEdgeSwipeProgress * 0.2})`,
            opacity: Math.min(1, readerEdgeSwipeProgress * 1.35),
          }}
          className="fixed right-1 top-1/2 z-[120] pointer-events-none w-9 h-12 rounded-l-full bg-stone-900/90 dark:bg-white/90 text-white dark:text-stone-900 shadow-lg flex items-center justify-center"
        >
          <ChevronLeft className="w-5 h-5" />
        </div>
      )}
      {/* Edge-to-Edge Floating Overlay Top Bar (hidden by default; center-tap toggles smoothly with zero reflow) */}
      <div
        data-testid="reader-top-bar"
        aria-hidden={!isMenuVisible}
        style={{
          borderColor: activeTheme.border,
          backgroundColor: activeTheme.bg,
        }}
        className={`fixed top-0 inset-x-0 z-40 pt-[env(safe-area-inset-top)] border-b px-3 sm:px-5 transition-all duration-200 ease-out ${
          isMenuVisible
            ? 'translate-y-0 opacity-100 shadow-sm'
            : '-translate-y-full opacity-0 pointer-events-none'
        }`}
      >
        <div className="h-[52px] flex items-center justify-between gap-2">
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={handleBackToLibraryClick}
            aria-label="Quay lại tủ sách"
            className="ios-liquid-pill inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full ios-liquid-bar border border-white/60 dark:border-white/15 text-xs font-medium text-stone-800 dark:text-stone-100 whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>{strings.backToLibrary}</span>
          </button>
        </div>

        {/* Center 3-Bar TOC Trigger */}
        <div className="flex-1 flex items-center justify-center min-w-0">
          <button
            type="button"
            onClick={() => setShowToc((v) => !v)}
            aria-label="Mở mục lục và đánh dấu"
            title="Mục lục & đánh dấu"
            className={`ios-liquid-pill w-9 h-9 rounded-full border flex items-center justify-center shrink-0 ${
              showToc
                ? 'ios-liquid-pill-active border-amber-700/40 text-amber-800 dark:text-amber-300'
                : 'ios-liquid-bar border-white/65 dark:border-white/15 text-stone-800 dark:text-stone-100'
            }`}
          >
            <Menu className="w-4 h-4" />
          </button>
        </div>

        {/* Right Corner Controls: Bookmark + Play/Pause + ! Quick Actions + Settings */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => togglePageBookmarkHandler()}
            aria-label={
              isCurrentPageBookmarked ? 'Bỏ đánh dấu trang hiện tại' : 'Đánh dấu trang hiện tại'
            }
            aria-pressed={isCurrentPageBookmarked}
            title={
              isCurrentPageBookmarked
                ? `Đã đánh dấu Trang ${safePageIndex + 1} (nhấn để bỏ)`
                : `Đánh dấu Trang ${safePageIndex + 1}`
            }
            className={`ios-liquid-pill w-9 h-9 rounded-full border flex items-center justify-center shrink-0 ${
              isCurrentPageBookmarked
                ? 'ios-liquid-pill-active border-amber-700/40 text-amber-800 dark:text-amber-300'
                : 'ios-liquid-bar border-white/65 dark:border-white/15 text-stone-800 dark:text-stone-100'
            }`}
          >
            {isCurrentPageBookmarked ? (
              <BookMarked className="w-4 h-4" />
            ) : (
              <Bookmark className="w-4 h-4" />
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              unlockAudioPlaybackSync();
              if (!isAudioPlayingLocal) {
                isFollowingAudioRef.current = true;
                lastSpokenPageIdxRef.current = null;
              }
              setTogglePlaySignal((s) => s + 1);
            }}
            aria-label={isAudioPlayingLocal ? 'Tạm dừng đọc sách' : 'Phát đọc sách'}
            title={isAudioPlayingLocal ? 'Tạm dừng' : 'Đọc thành tiếng'}
            className={`ios-liquid-pill w-9 h-9 rounded-full border flex items-center justify-center shrink-0 ${
              isAudioPlayingLocal
                ? 'ios-liquid-pill-active border-amber-700/50 bg-amber-800 text-white'
                : 'ios-liquid-bar border-white/65 dark:border-white/15 text-stone-800 dark:text-stone-100'
            }`}
          >
            {isAudioPlayingLocal ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4 ml-0.5" />
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setShowToolsMenu(false);
              setShowQuickActions((v) => !v);
            }}
            aria-label="Mở dịch nhanh"
            aria-expanded={showQuickActions}
            title="Dịch nhanh"
            className={`ios-liquid-pill relative w-9 h-9 rounded-full border flex items-center justify-center shrink-0 ${
              showQuickActions || settings.translationMode !== 'original'
                ? 'ios-liquid-pill-active border-amber-700/40 text-amber-800 dark:text-amber-300'
                : 'ios-liquid-bar border-white/65 dark:border-white/15 text-stone-800 dark:text-stone-100'
            }`}
          >
            <AlertCircle className="w-4 h-4" />
            {settings.translationMode !== 'original' && (
              <span className="w-2 h-2 rounded-full bg-amber-700 absolute -top-0.5 -right-0.5 ring-2 ring-[#FBF9F5] dark:ring-[#16181C]" />
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setShowQuickActions(false);
              setShowToolsMenu((v) => !v);
            }}
            aria-label="Mở menu tùy chọn đọc sách"
            aria-expanded={showToolsMenu}
            title="Tùy chọn đọc sách"
            className={`ios-liquid-pill relative w-9 h-9 rounded-full border flex items-center justify-center shrink-0 ${
              showToolsMenu || showSettings || showAmbient
                ? 'ios-liquid-pill-active border-amber-700/40 text-amber-800 dark:text-amber-300'
                : 'ios-liquid-bar border-white/65 dark:border-white/15 text-stone-800 dark:text-stone-100'
            }`}
          >
            <Settings className="w-4 h-4" />
            {ambientActiveCount > 0 && (
              <span className="w-2 h-2 rounded-full bg-amber-700 absolute -top-0.5 -right-0.5 ring-2 ring-[#FBF9F5] dark:ring-[#16181C]" />
            )}
          </button>
        </div>
        </div>
      </div>

      {/* Quick Actions Floating Popover (!) — Translation ONLY */}
      {showQuickActions &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[70] bg-transparent flex items-start justify-end pt-[56px] pr-3 sm:pr-5"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowQuickActions(false);
            }}
          >
            <div
              role="dialog"
              data-testid="quick-actions-popover"
              aria-label="Dịch nhanh"
              className="ios-sheet-enter ios-frosted-surface rounded-[18px] p-2 w-[176px] text-stone-900 dark:text-stone-100 shadow-xl"
            >
              <button
                type="button"
                data-testid="quick-translate-btn"
                disabled={isTranslating}
                onClick={() => {
                  const nextMode: TranslationMode =
                    settings.translationMode === 'override' ? 'original' : 'override';
                  void handleTranslationModeChange(nextMode);
                }}
                aria-pressed={settings.translationMode === 'override'}
                className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold transition-colors whitespace-nowrap ${
                  settings.translationMode === 'override'
                    ? 'bg-amber-800 text-white shadow-sm'
                    : 'bg-black/5 dark:bg-white/10 text-stone-800 dark:text-stone-100 hover:bg-black/10 dark:hover:bg-white/15'
                }`}
              >
                <Languages className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {settings.translationMode === 'override'
                    ? strings.translated
                    : strings.translateQuick}
                </span>
              </button>
            </div>
          </div>,
          document.body
        )}

      {/* Collapsible Corner Options Popover / Sheet (3 Stacked List Items + Dịch nhanh + Xuất EPUB) */}
      <IosSheet
        isOpen={showToolsMenu}
        onClose={() => setShowToolsMenu(false)}
        variant="popover-top-right"
        zIndexClass="z-[70]"
        ariaLabel="Tùy chọn trình đọc sách"
        panelClassName="ios-frosted-surface w-full max-w-full sm:w-[348px] text-stone-900 dark:text-stone-100 rounded-t-[26px] sm:rounded-[24px] overflow-hidden max-h-[92vh] flex flex-col"
      >
              <div className="sm:hidden flex justify-center pt-2 shrink-0">
                <div className="w-10 h-1 rounded-full bg-stone-400/50 dark:bg-stone-600/70" />
              </div>

              <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-stone-300/40 dark:border-white/10 shrink-0">
                <h2 className="text-[13px] font-sans font-semibold truncate">
                  {strings.readerOptions}
                </h2>
                <button
                  type="button"
                  onClick={() => setShowToolsMenu(false)}
                  aria-label="Đóng menu tùy chọn đọc"
                  className="w-7 h-7 rounded-full bg-black/5 dark:bg-white/10 flex items-center justify-center text-stone-600 dark:text-stone-300 shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="p-3.5 pb-5 sm:pb-3.5 space-y-3 overflow-y-auto overflow-x-hidden text-xs">
                {/* 3 Stacked List Items */}
                <div className="rounded-2xl border border-stone-200/70 dark:border-white/10 divide-y divide-stone-200/60 dark:divide-white/10 overflow-hidden bg-white/75 dark:bg-stone-900/50">
                  <button
                    type="button"
                    onClick={() => {
                      setShowToolsMenu(false);
                      setShowAudio(false);
                      setShowAmbient(false);
                      setShowSettings(true);
                    }}
                    className="w-full px-3 py-2.5 flex items-center justify-between gap-2 text-left hover:bg-black/5 dark:hover:bg-white/10"
                  >
                    <span className="flex items-center gap-2 font-medium text-stone-900 dark:text-stone-100">
                      <SlidersHorizontal className="w-4 h-4 text-amber-800 dark:text-amber-400 shrink-0" />
                      <span>{strings.textBgAndTurn}</span>
                    </span>
                    <ChevronRight className="w-4 h-4 text-stone-400 shrink-0" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowToolsMenu(false);
                      setShowSettings(false);
                      setShowAmbient(false);
                      setShowAudio(true);
                    }}
                    className="w-full px-3 py-2.5 flex items-center justify-between gap-2 text-left hover:bg-black/5 dark:hover:bg-white/10"
                  >
                    <span className="flex items-center gap-2 font-medium text-stone-900 dark:text-stone-100">
                      <Headphones className="w-4 h-4 text-amber-800 dark:text-amber-400 shrink-0" />
                      <span>{strings.readingVoice}</span>
                    </span>
                    <ChevronRight className="w-4 h-4 text-stone-400 shrink-0" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowToolsMenu(false);
                      setShowSettings(false);
                      setShowAudio(false);
                      setShowAmbient(true);
                    }}
                    className="w-full px-3 py-2.5 flex items-center justify-between gap-2 text-left hover:bg-black/5 dark:hover:bg-white/10"
                  >
                    <span className="flex items-center gap-2 font-medium text-stone-900 dark:text-stone-100">
                      <Music className="w-4 h-4 text-amber-800 dark:text-amber-400 shrink-0" />
                      <span>
                        {strings.ambientMusic}{ambientActiveCount > 0 ? ` (${ambientActiveCount})` : ''}
                      </span>
                    </span>
                    <ChevronRight className="w-4 h-4 text-stone-400 shrink-0" />
                  </button>

                  <button
                    type="button"
                    data-testid="reader-ai-cleanup-btn"
                    disabled={isScanningCleanup}
                    onClick={async () => {
                      setIsScanningCleanup(true);
                      try {
                        const report = await runImportBookAiScan(book);
                        if (report.totalIssues > 0) {
                          setShowToolsMenu(false);
                          setCleanScanVerified(false);
                          setCleanupReviewReport(report);
                        } else {
                          // Clean book: NO green banner & NO popup — only show compact checkmark inside menu
                          setCleanScanVerified(true);
                        }
                      } finally {
                        setIsScanningCleanup(false);
                      }
                    }}
                    className="w-full px-3 py-2.5 flex items-center justify-between gap-2 text-left hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50"
                  >
                    <span className="flex items-center gap-2 font-medium text-stone-900 dark:text-stone-100">
                      <Sparkles className="w-4 h-4 text-amber-800 dark:text-amber-400 shrink-0" />
                      <span>{isScanningCleanup ? strings.scanning : strings.aiCleanScan}</span>
                    </span>
                    {cleanScanVerified ? (
                      <span
                        data-testid="ai-clean-verified-check"
                        aria-label="Sách đã sạch"
                        className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 shrink-0"
                      >
                        <Check className="w-3.5 h-3.5 stroke-[2.6]" />
                      </span>
                    ) : (
                      <ChevronRight className="w-4 h-4 text-stone-400 shrink-0" />
                    )}
                  </button>
                </div>

                {/* Compact Inline Dịch nhanh Controls with GlassSelect */}
                <div className="space-y-2 pt-2 border-t border-stone-300/40 dark:border-white/10">
                  <div className="text-[11px] font-semibold text-stone-600 dark:text-stone-400">
                    {strings.quickTranslate}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <GlassSelect<TranslationMode>
                      title="Chế độ dịch nhanh"
                      ariaLabel="Chế độ dịch nhanh"
                      value={settings.translationMode}
                      options={translationModeOptions}
                      onChange={(mode) => {
                        void handleTranslationModeChange(mode);
                      }}
                    />

                    <GlassSelect
                      title="Ngôn ngữ dịch sách"
                      ariaLabel="Ngôn ngữ dịch sách"
                      value={settings.targetLang}
                      options={targetLangOptions}
                      onChange={async (lang) => {
                        onUpdateSettings({ targetLang: lang });
                        if (settings.translationMode !== 'original') {
                          await translateCurrentChapter(lang);
                        }
                      }}
                    />
                  </div>

                  {hasOriginalBookBackup(book) && (
                    <button
                      type="button"
                      onClick={handleRestoreOriginalBookText}
                      className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl border border-stone-300/70 dark:border-white/10 bg-white/60 dark:bg-stone-900/40 text-[11px] text-stone-600 dark:text-stone-300"
                    >
                      <RotateCcw className="w-3 h-3 shrink-0" />
                      <span>Khôi phục bản gốc</span>
                    </button>
                  )}
                </div>

                {/* Full-width Export EPUB Action */}
                <div className="pt-2 border-t border-stone-300/40 dark:border-white/10">
                  <button
                    type="button"
                    disabled={isExporting || isTranslatingFullEpub}
                    onClick={() => {
                      setShowToolsMenu(false);
                      if (settings.translationMode !== 'original') {
                        handleTranslateEntireBookAndOverwriteEpub();
                      } else {
                        handleExportCurrentEpub();
                      }
                    }}
                    className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-2xl border border-stone-300/70 dark:border-white/10 bg-white/80 dark:bg-stone-900/60 hover:border-amber-700/60 text-[12px] font-semibold transition-colors"
                  >
                    {settings.translationMode !== 'original' ? (
                      <FileOutput className="w-3.5 h-3.5 shrink-0" />
                    ) : (
                      <Download className="w-3.5 h-3.5 shrink-0" />
                    )}
                    <span>
                      {settings.translationMode !== 'original'
                        ? strings.translateAndExportEpub
                        : strings.exportEpub}
                    </span>
                  </button>
                </div>
              </div>
      </IosSheet>

      {/* Main Content + Docked Side Drawers */}
      <div className={`flex-1 flex relative min-h-0 ${isPaginatedMode ? 'overflow-hidden' : 'items-start'}`}>
        <div
          ref={scrollContainerRef}
          onClick={handleCanvasTapForPagination}
          onPointerDown={handleStagePointerDown}
          onPointerMove={handleStagePointerMove}
          onPointerUp={(e) => finishStageDrag(e.clientX)}
          onPointerCancel={() => finishStageDrag()}
          className={`flex-1 min-w-0 page-turn-stage ${
            isPaginatedMode
              ? 'h-full flex flex-col overflow-hidden select-none'
              : 'overflow-x-hidden'
          }`}
          style={
            isPaginatedMode
              ? { touchAction: 'pan-y' }
              : {
                  paddingTop: `calc(env(safe-area-inset-top, 0px) + ${settings.marginTopPx ?? 12}px)`,
                  paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + ${Math.max(44, settings.marginBottomPx ?? 20)}px)`,
                  paddingLeft: `${settings.marginHorizontalPx ?? 16}px`,
                  paddingRight: `${settings.marginHorizontalPx ?? 16}px`,
                }
          }
        >
          {/* Reading viewport box (measured by ResizeObserver in paginated mode so 1 screen = 1 exact page above centered page counter) */}
          <div
            ref={pageMeasureBoxRef}
            data-testid="reader-page-box"
            className={
              isPaginatedMode
                ? 'flex-1 min-h-0 w-full relative overflow-hidden'
                : 'w-full'
            }
          >
            {/* Underlay Layer: Next/Prev page revealed cleanly beneath curled corner or sliding page with Depth Parallax */}
            {isPaginatedMode && underlayTarget && (
              <div
                aria-hidden="true"
                data-testid="reader-underlay-page"
                className="absolute inset-0 overflow-hidden pointer-events-none"
                style={{
                  backgroundColor: activeTheme.bg,
                  color: activeTheme.text,
                  paddingTop: `calc(env(safe-area-inset-top, 0px) + ${settings.marginTopPx ?? 12}px)`,
                  paddingBottom: `${settings.marginBottomPx ?? 20}px`,
                  paddingLeft: `${settings.marginHorizontalPx ?? 16}px`,
                  paddingRight: `${settings.marginHorizontalPx ?? 16}px`,
                  ...vintageTexture,
                  transform: liveSlideState
                    ? `scale(${liveSlideState.underlayScale})`
                    : undefined,
                  opacity: liveSlideState ? liveSlideState.underlayOpacity : 1,
                  filter: liveSlideState
                    ? `brightness(${liveSlideState.underlayBrightness})`
                    : undefined,
                  transition: !liveTurn?.isAnimating ? 'none' : 'transform 220ms cubic-bezier(0.22,1,0.36,1), opacity 220ms ease, filter 220ms ease',
                }}
              >
                {renderStaticPageContent(underlayTarget)}
              </div>
            )}

            {/* Foreground / Active Reading Page Layer */}
            <div
              data-testid="reader-foreground-page"
              className={
                isPaginatedMode
                  ? 'relative z-10 h-full w-full overflow-hidden'
                  : 'w-full'
              }
              style={
                isPaginatedMode
                  ? {
                      backgroundColor: activeTheme.bg,
                      color: activeTheme.text,
                      paddingTop: `calc(env(safe-area-inset-top, 0px) + ${settings.marginTopPx ?? 12}px)`,
                      paddingBottom: `${settings.marginBottomPx ?? 20}px`,
                      paddingLeft: `${settings.marginHorizontalPx ?? 16}px`,
                      paddingRight: `${settings.marginHorizontalPx ?? 16}px`,
                      ...vintageTexture,
                      transition: !liveTurn
                        ? 'padding 180ms cubic-bezier(0.22,1,0.36,1)'
                        : undefined,
                      ...(liveCurlGeom && liveCurlGeom.peel > 0.002
                        ? {
                            clipPath: liveCurlGeom.frontClipPath,
                            WebkitClipPath: liveCurlGeom.frontClipPath,
                          }
                        : {}),
                      ...(liveSlideState
                        ? {
                            transform: `translate3d(${liveSlideState.translateXPx}px, 0, 0)`,
                            opacity: liveSlideState.opacity,
                            boxShadow:
                              liveSlideState.direction === 'next'
                                ? `12px 0 28px rgba(0, 0, 0, ${liveSlideState.edgeShadowOpacity})`
                                : `-12px 0 28px rgba(0, 0, 0, ${liveSlideState.edgeShadowOpacity})`,
                            transition:
                              !liveTurn?.isAnimating
                                ? 'none'
                                : 'transform 220ms cubic-bezier(0.22,1,0.36,1), opacity 220ms ease',
                          }
                        : {}),
                    }
                  : {
                      transition: 'padding 180ms cubic-bezier(0.22,1,0.36,1)',
                    }
              }
            >
              <article
                ref={articleRef}
                data-testid="reader-article"
                key={
                  isPaginatedMode
                    ? `${chapterIndex}-${turnTick}`
                    : chapterIndex
                }
                className={`mx-auto ${WIDTH_CLASSES[settings.pageWidth]} ${pageTurnClass}`}
                style={{
                  fontFamily: settings.fontFamily,
                  fontSize: `${settings.fontSize}px`,
                  lineHeight: settings.lineHeight,
                  letterSpacing: `${settings.letterSpacing}em`,
                  fontWeight: settings.fontWeight,
                  textAlign: settings.textAlign,
                  transition: liveTurn
                    ? 'none'
                    : 'font-size 160ms cubic-bezier(0.22,1,0.36,1), line-height 160ms cubic-bezier(0.22,1,0.36,1), letter-spacing 160ms ease-out',
                }}
              >
                {translateError && (
                  <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs font-sans">
                    {translateError}
                  </div>
                )}

                {translateStatusMsg && !isTranslating && !isTranslatingFullEpub && (
                  <div className="mb-4 flex items-center justify-between gap-2 p-3 rounded-lg bg-emerald-600/10 border border-emerald-600/30 text-xs font-sans">
                    <span className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                      <span>{translateStatusMsg}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setTranslateStatusMsg('')}
                      aria-label="Ẩn thông báo dịch"
                      className="text-xs opacity-60 hover:opacity-100"
                    >
                      ✕
                    </button>
                  </div>
                )}

                {(isTranslating || isTranslatingFullEpub) && (
                  <div className="mb-4 p-3 rounded-lg bg-amber-700/10 border border-amber-700/25 text-xs font-sans space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                        <span>
                          {isTranslatingFullEpub && fullEpubProgress
                            ? fullEpubProgress.message
                            : `AI đang dịch nhanh sang ${getLanguagePackDefinition(settings.targetLang).label}...`}
                        </span>
                      </span>
                      {isTranslatingFullEpub && (
                        <button
                          type="button"
                          onClick={() => fullTranslateAbortRef.current?.abort()}
                          className="text-[11px] font-semibold text-red-600 underline shrink-0"
                        >
                          Hủy
                        </button>
                      )}
                    </div>
                    {isTranslatingFullEpub && fullEpubProgress && (
                      <div className="h-1.5 w-full rounded-full bg-amber-700/20 overflow-hidden">
                        <div
                          className="h-full bg-amber-700 transition-all duration-300"
                          style={{ width: `${fullEpubProgress.percent}%` }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Compact 1/2-size Chapter Header */}
                {(!isPaginatedMode || topLayerPage.hasChapterHeader) && (
                  <header
                    data-testid="reader-chapter-header"
                    className={isPaginatedMode ? 'mb-2 pb-1.5 border-b' : 'mb-4 pb-3 border-b'}
                    style={{ borderColor: activeTheme.border }}
                  >
                    <p className="text-[8.5px] sm:text-[9.5px] uppercase tracking-wider opacity-60 font-sans mb-0.5 tabular-nums truncate">
                      {book.title} · Ch.{topLayerChapterNum}/{book.chapters.length}
                    </p>
                    <h1
                      data-testid="reader-chapter-title"
                      className="text-[11px] sm:text-[13px] font-sans font-semibold leading-tight text-left truncate"
                    >
                      {topLayerChapterTitle}
                    </h1>
                  </header>
                )}

                {/* Paragraphs — clean reading view; long-press reveals Nghe từ đây / Đánh dấu */}
                <div
                  className={
                    isPaginatedMode && settings.columnsInPaginated === 2
                      ? 'md:columns-2 md:gap-10'
                      : ''
                  }
                >
                  {topLayerChunks.map((chunk, idx) => {
                    const highlight = book.highlights.find(
                      (h) => h.chapterId === currentChapter?.id && h.paragraphIndex === chunk.paragraphIndex
                    );
                    const isSpoken = !isCurlPrevPeelingBack && spokenParaIndex === chunk.paragraphIndex;
                    const chunkStart = chunk.charOffset ?? 0;
                    const chunkEnd = chunkStart + chunk.original.length;
                    const isChunkSpoken =
                      isSpoken &&
                      (!isPaginatedMode ||
                        (spokenCharOffset >= Math.max(0, chunkStart - 1) &&
                          spokenCharOffset <= chunkEnd + 1));
                    const localCharOffset = Math.max(0, spokenCharOffset - chunkStart);
                    const isLongPressed = activeParaAction?.paragraphIndex === chunk.paragraphIndex;
                    const useDropCap =
                      settings.dropCap &&
                      chunk.paragraphIndex === 0 &&
                      chunk.isFirstOfParagraph &&
                      idx === 0;

                    return (
                      <div
                        key={`${chunk.paragraphIndex}-${idx}`}
                        ref={(el) => {
                          if (el && chunk.isFirstOfParagraph && !isCurlPrevPeelingBack) {
                            paraRefs.current.set(chunk.paragraphIndex, el);
                          } else if (!el && !isCurlPrevPeelingBack) {
                            paraRefs.current.delete(chunk.paragraphIndex);
                          }
                        }}
                        style={{ marginBottom: `${settings.paragraphSpacing}px` }}
                        onPointerDown={(e) =>
                          startParagraphLongPress(chunk.paragraphIndex, e.clientX, e.clientY)
                        }
                        onPointerMove={(e) => handleParagraphPointerMove(e.clientX, e.clientY)}
                        onPointerUp={clearLongPressTimer}
                        onPointerCancel={clearLongPressTimer}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          syncParagraphPosition(chunk.paragraphIndex, chunk.charOffset ?? 0, true);
                          setActiveParaAction({ paragraphIndex: chunk.paragraphIndex });
                        }}
                        className={`relative rounded-lg px-1.5 py-0.5 transition-colors select-none ${
                          isLongPressed ? 'ring-1 ring-amber-700/60 bg-amber-500/10' : ''
                        } ${highlight ? HIGHLIGHT_CLASSES[highlight.color] : ''}`}
                      >
                        <p
                          className={`${useDropCap ? 'editorial-dropcap' : ''} ${
                            settings.firstLineIndent && chunk.isFirstOfParagraph && !useDropCap
                              ? 'indent-7'
                              : ''
                          }`}
                        >
                          {renderIlluminatedText(chunk.original, isChunkSpoken, localCharOffset)}
                        </p>

                        {chunk.translated && (
                          <p className="mt-2 pl-4 opacity-75 italic text-[0.92em]">
                            {chunk.translated}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Scroll-mode Chapter Footer */}
                {!isPaginatedMode && (
                  <footer
                    style={{ borderColor: activeTheme.border }}
                    className="mt-8 pt-5 border-t flex items-center justify-between gap-4 font-sans text-xs"
                  >
                    <button
                      type="button"
                      disabled={chapterIndex === 0}
                      onClick={() => goToChapter(chapterIndex - 1)}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-black/15 dark:border-white/15 disabled:opacity-40 min-h-[44px]"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>Chương trước</span>
                    </button>
                    <span className="tabular-nums opacity-70">
                      Chương {chapterIndex + 1} / {book.chapters.length}
                    </span>
                    <button
                      type="button"
                      disabled={chapterIndex >= book.chapters.length - 1}
                      onClick={() => goToChapter(chapterIndex + 1)}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-black/15 dark:border-white/15 disabled:opacity-40 min-h-[44px]"
                    >
                      <span>Chương tiếp</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </footer>
                )}
              </article>
            </div>

            {/* Apple Books-style Realistic 3D Corner Curl Flap: Mirrored Back-Face + Cast Shadow + Specular Crease */}
            {isPaginatedMode && liveCurlGeom && liveCurlGeom.peel > 0.005 && liveCurlGeom.flapPath && (
              <div
                aria-hidden="true"
                data-testid="reader-curl-overlay"
                className="absolute inset-0 z-20 pointer-events-none overflow-hidden"
              >
                {/* Mirrored slightly-faded back-face of current page clipped inside the curled underside flap */}
                <div
                  className="absolute inset-0 px-4 sm:px-8 pt-2.5 pb-5 overflow-hidden"
                  style={{
                    clipPath: liveCurlGeom.flapClipPath,
                    WebkitClipPath: liveCurlGeom.flapClipPath,
                    backgroundColor: activeTheme.surface || activeTheme.bg,
                  }}
                >
                  <div
                    className="w-full h-full opacity-[0.22] blur-[0.3px]"
                    style={{
                      transform: liveCurlGeom.backfaceTransform,
                      color: activeTheme.text,
                    }}
                  >
                    {renderStaticPageContent({
                      page: topLayerPage,
                      chapterTitle: topLayerChapterTitle,
                      chapterNum: topLayerChapterNum,
                    })}
                  </div>
                </div>

                {/* Curved Paper Highlight, Underside Shading & Dynamic Cast Shadow */}
                <svg
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  className="absolute inset-0 w-full h-full"
                >
                  <defs>
                    <linearGradient
                      id="bookhad-curl-flap-grad"
                      x1="0%"
                      y1="0%"
                      x2="100%"
                      y2="100%"
                    >
                      <stop offset="0%" stopColor={activeTheme.isDark ? '#32353d' : '#ffffff'} stopOpacity="0.65" />
                      <stop offset="52%" stopColor={activeTheme.surface || activeTheme.bg} stopOpacity="0.58" />
                      <stop offset="100%" stopColor={activeTheme.isDark ? '#111317' : '#d6cbb7'} stopOpacity="0.82" />
                    </linearGradient>
                    <linearGradient
                      id="bookhad-curl-shadow-grad"
                      x1="0%"
                      y1="0%"
                      x2="100%"
                      y2="100%"
                    >
                      <stop offset="0%" stopColor="#000000" stopOpacity={liveCurlGeom.shadowOpacity} />
                      <stop offset="100%" stopColor="#000000" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {liveCurlGeom.castShadowPath && (
                    <path d={liveCurlGeom.castShadowPath} fill="url(#bookhad-curl-shadow-grad)" />
                  )}
                  <path
                    d={liveCurlGeom.flapPath}
                    fill="url(#bookhad-curl-flap-grad)"
                    stroke={activeTheme.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(60,42,20,0.18)'}
                    strokeWidth="0.35"
                  />
                  {liveCurlGeom.creasePath && (
                    <path
                      d={liveCurlGeom.creasePath}
                      fill="none"
                      stroke={activeTheme.isDark ? 'rgba(255,255,255,0.34)' : 'rgba(255,255,255,0.85)'}
                      strokeWidth="0.7"
                      strokeOpacity={liveCurlGeom.creaseHighlightOpacity}
                    />
                  )}
                </svg>
              </div>
            )}
          </div>

          {/* Minimal Bottom-Centered Page Counter (always visible in Clean Reader Mode: "15 / 320") */}
          {isPaginatedMode && (
            <div
              data-testid="reader-clean-page-indicator"
              style={{ backgroundColor: activeTheme.bg, color: activeTheme.text }}
              className="shrink-0 relative z-20 flex items-center justify-center py-1.5 pb-[max(0.45rem,env(safe-area-inset-bottom))] text-[11px] font-sans font-medium tabular-nums opacity-65 select-none"
            >
              <span>
                {globalCurrentPage} / {globalTotalPages}
              </span>
            </div>
          )}

          {/* Floating Pill Button: "Về trang đang nghe" — shown bottom-center right above page number when user flips away while listening */}
          {showReturnToListeningBtn && (
            <div
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className={`fixed left-1/2 -translate-x-1/2 z-[48] transition-all duration-200 ${
                isMenuVisible
                  ? 'bottom-[calc(max(3.9rem,env(safe-area-inset-bottom)+3.5rem))]'
                  : 'bottom-[calc(max(2.15rem,env(safe-area-inset-bottom)+1.85rem))]'
              }`}
            >
              <button
                type="button"
                data-testid="return-to-listening-page-btn"
                onClick={handleReturnToListeningPage}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-amber-800 text-white text-[11px] font-sans font-semibold shadow-lg hover:bg-amber-900 active:scale-95 transition-all whitespace-nowrap ring-1 ring-white/25"
              >
                <Volume2 className="w-3.5 h-3.5 shrink-0 animate-pulse" />
                <span>{strings.returnToListeningPage}</span>
              </button>
            </div>
          )}

          {/* Floating Overlay 3-Button Bottom Navigation Bar (shown ONLY when center-tap menu is toggled open) */}
          {isPaginatedMode && (
            <footer
              data-testid="reader-bottom-bar"
              aria-hidden={!isMenuVisible}
              style={{
                borderColor: activeTheme.border,
                backgroundColor: activeTheme.bg,
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className={`fixed bottom-0 inset-x-0 z-40 px-3 sm:px-6 pt-2 pb-[max(0.55rem,env(safe-area-inset-bottom))] border-t grid grid-cols-3 gap-2 font-sans text-[11px] transition-all duration-200 ease-out ${
                isMenuVisible
                  ? 'translate-y-0 opacity-100 shadow-lg'
                  : 'translate-y-full opacity-0 pointer-events-none'
              }`}
            >
              <button
                type="button"
                data-testid="reader-prev-page-btn"
                disabled={safePageIndex === 0 && chapterIndex === 0}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  goPrevPage();
                }}
                aria-label="Trang trước"
                style={{ borderColor: activeTheme.border }}
                className="h-9 px-2.5 rounded-xl border bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.12] active:scale-[0.98] transition-all inline-flex items-center justify-center gap-1 font-semibold disabled:opacity-35"
              >
                <ChevronLeft className="w-3.5 h-3.5 shrink-0" />
                <span>{strings.prevPage}</span>
              </button>

              <button
                type="button"
                data-testid="reader-page-counter-btn"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setPageJumpInput(String(globalCurrentPage));
                  setShowPageJump((v) => !v);
                }}
                aria-label={`Trang ${globalCurrentPage} trên ${globalTotalPages}, nhấn để chọn trang`}
                title={`Ch.${chapterIndex + 1}/${book.chapters.length} · ${activeTurnLabel}`}
                style={{ borderColor: activeTheme.border }}
                className="h-9 px-2 rounded-xl border bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.12] active:scale-[0.98] transition-all inline-flex items-center justify-center font-semibold tabular-nums truncate"
              >
                <span>
                  {globalCurrentPage} / {globalTotalPages}
                </span>
              </button>

              <button
                type="button"
                data-testid="reader-next-page-btn"
                disabled={
                  safePageIndex >= screenPages.length - 1 &&
                  chapterIndex >= book.chapters.length - 1
                }
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  goNextPage();
                }}
                aria-label="Trang tiếp"
                style={{ borderColor: activeTheme.border }}
                className="h-9 px-2.5 rounded-xl border bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.12] active:scale-[0.98] transition-all inline-flex items-center justify-center gap-1 font-semibold disabled:opacity-35"
              >
                <span>{strings.nextPage}</span>
                <ChevronRight className="w-3.5 h-3.5 shrink-0" />
              </button>
            </footer>
          )}
        </div>

        {/* Quick Page Jump Popover triggered by Center Page Counter Button */}
        <IosSheet
          isOpen={showPageJump && isPaginatedMode}
          onClose={() => setShowPageJump(false)}
          variant="center-dialog"
          zIndexClass="z-[82]"
          ariaLabel="Chọn trang hiển thị"
          panelClassName="ios-frosted-surface w-full max-w-xs rounded-[22px] text-stone-900 dark:text-stone-100 p-4 space-y-3 font-sans text-xs shadow-2xl"
        >
                <div data-testid="reader-page-jump-modal" className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-[13px] font-sans font-semibold">Đi tới trang</h2>
                    <p className="text-[10.5px] text-stone-500 dark:text-stone-400 tabular-nums">
                      Trang {globalCurrentPage} / {globalTotalPages} · Ch.{chapterIndex + 1}/
                      {book.chapters.length}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowPageJump(false)}
                    aria-label="Đóng bảng chọn trang"
                    className="w-7 h-7 rounded-full bg-black/5 dark:bg-white/10 flex items-center justify-center text-stone-500"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <input
                  type="range"
                  min={1}
                  max={globalTotalPages}
                  value={Math.max(
                    1,
                    Math.min(globalTotalPages, Number(pageJumpInput) || globalCurrentPage)
                  )}
                  onChange={(e) => setPageJumpInput(e.target.value)}
                  className="w-full accent-amber-700"
                />

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const parsed = parseInt(pageJumpInput, 10);
                    if (!Number.isNaN(parsed)) {
                      handleJumpToGlobalPage(parsed);
                    }
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    type="number"
                    data-testid="reader-page-jump-input"
                    min={1}
                    max={globalTotalPages}
                    value={pageJumpInput}
                    onChange={(e) => setPageJumpInput(e.target.value)}
                    className="flex-1 h-9 px-3 rounded-xl border border-stone-300 dark:border-white/15 bg-white dark:bg-stone-900 text-xs font-semibold tabular-nums text-center focus:outline-none focus:ring-2 focus:ring-amber-600/40"
                  />
                  <button
                    type="submit"
                    data-testid="reader-page-jump-submit"
                    className="h-9 px-4 rounded-xl bg-amber-800 hover:bg-amber-900 text-white font-semibold shrink-0"
                  >
                    Đi tới
                  </button>
                </form>
                </div>
        </IosSheet>

        {/* Long-Press Floating Paragraph Action Menu (Nghe từ đây & Đánh dấu — hidden until long-press) */}
        {activeParaAction !== null &&
          typeof document !== 'undefined' &&
          createPortal(
            <div
              className="fixed inset-0 z-[80] ios-frosted-backdrop flex items-end sm:items-center justify-center p-4 pb-8"
              onClick={() => setActiveParaAction(null)}
            >
              <div
                role="dialog"
                aria-label="Tùy chọn đoạn văn bản"
                onClick={(e) => e.stopPropagation()}
                className="ios-sheet-enter ios-frosted-surface w-full max-w-sm rounded-[24px] text-stone-900 dark:text-stone-100 p-3.5 space-y-3 font-sans text-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[11px] text-stone-600 dark:text-stone-300 line-clamp-2 leading-relaxed">
                    &ldquo;
                    {currentChapter?.paragraphs[activeParaAction.paragraphIndex]?.slice(0, 110) ||
                      ''}
                    &rdquo;
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveParaAction(null)}
                    aria-label="Đóng bảng tùy chọn đoạn"
                    className="p-1 rounded-full text-stone-500 hover:text-stone-900 dark:hover:text-white shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      unlockAudioPlaybackSync();
                      const pIdx = activeParaAction.paragraphIndex;
                      syncParagraphPosition(pIdx, 0, true);
                      setActiveParaAction(null);
                      handleContinueListenFromHere();
                    }}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-amber-800 hover:bg-amber-900 text-white font-semibold"
                  >
                    <Play className="w-3.5 h-3.5 shrink-0" />
                    <span>Nghe tiếp</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      togglePageBookmarkHandler(activeParaAction.paragraphIndex);
                      setActiveParaAction(null);
                    }}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 font-medium"
                  >
                    <Bookmark className="w-3.5 h-3.5 shrink-0" />
                    <span>{isCurrentPageBookmarked ? 'Bỏ dấu' : 'Đánh dấu'}</span>
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-stone-300/40 dark:border-white/10">
                  <span className="text-[11px] text-stone-600 dark:text-stone-300">Đánh dấu màu:</span>
                  <div className="flex items-center gap-2">
                    {(['amber', 'emerald', 'rose', 'sky'] as const).map((clr) => (
                      <button
                        key={clr}
                        type="button"
                        onClick={() => toggleHighlight(activeParaAction.paragraphIndex, clr)}
                        aria-label={`Tô màu ${clr}`}
                        className={`w-6 h-6 rounded-full border-2 border-white/80 shadow-xs ${
                          clr === 'amber'
                            ? 'bg-amber-400'
                            : clr === 'emerald'
                            ? 'bg-emerald-400'
                            : clr === 'rose'
                            ? 'bg-rose-400'
                            : 'bg-sky-400'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )}

        {/* Table of Contents & Bookmarks Sidebar */}
        <IosSheet
          isOpen={showToc}
          onClose={() => setShowToc(false)}
          variant="drawer-left"
          zIndexClass="z-[75]"
          ariaLabel="Mục lục và đánh dấu trang"
          panelClassName="ios-frosted-surface w-full sm:w-80 h-auto max-h-[82dvh] sm:max-h-[calc(100dvh-72px)] text-stone-900 dark:text-stone-100 rounded-t-[28px] sm:rounded-[24px] flex flex-col overflow-hidden"
        >
                <div className="sm:hidden flex justify-center pt-2 pb-1 shrink-0">
                  <span className="w-10 h-1 rounded-full bg-stone-400/50 dark:bg-stone-600/70" />
                </div>
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-300/40 dark:border-white/10 shrink-0">
                  <h2 className="text-base font-sans font-semibold">{strings.toc}</h2>
                  <button
                    type="button"
                    onClick={() => setShowToc(false)}
                    aria-label="Đóng mục lục"
                    className="p-2 rounded-full bg-black/5 dark:bg-white/10 text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="overflow-y-auto overscroll-contain min-h-0 p-4 space-y-4 text-xs">
                  <div className="space-y-1">
                    <h3 className="px-2 pb-1 text-[11px] uppercase tracking-wider text-stone-500 font-semibold">
                      Danh sách chương ({book.chapters.length})
                    </h3>
                    {book.chapters.map((ch, idx) => (
                      <button
                        key={ch.id}
                        type="button"
                        onClick={() => goToChapter(idx)}
                        className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors ${
                          idx === chapterIndex
                            ? 'bg-amber-800 text-white font-medium'
                            : 'hover:bg-black/5 dark:hover:bg-white/10'
                        }`}
                      >
                        {ch.title}
                      </button>
                    ))}
                  </div>

                  {book.bookmarks.length > 0 && (
                    <div className="space-y-1.5 pt-3 border-t border-stone-300/40 dark:border-white/10">
                      <h3 className="px-2 text-[11px] uppercase tracking-wider text-stone-500 font-semibold">
                        Trang đã đánh dấu ({book.bookmarks.length})
                      </h3>
                      {book.bookmarks.map((bm) => (
                        <button
                          key={bm.id}
                          type="button"
                          onClick={() => {
                            const idx = book.chapters.findIndex((c) => c.id === bm.chapterId);
                            if (idx >= 0) {
                              goToChapter(idx, {
                                targetPageIndex: bm.pageIndex,
                                targetParagraphIndex: bm.paragraphIndex,
                              });
                            }
                          }}
                          className="w-full text-left p-2.5 rounded-xl border border-stone-200/80 dark:border-white/10 bg-white/60 dark:bg-stone-900/50 hover:bg-stone-100/80 dark:hover:bg-stone-800/70 transition-colors"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium truncate">{bm.chapterTitle}</span>
                            {typeof bm.pageIndex === 'number' && (
                              <span className="px-1.5 py-0.5 rounded-md bg-amber-800/12 dark:bg-amber-500/20 text-amber-900 dark:text-amber-200 text-[10px] font-semibold tabular-nums shrink-0">
                                Trang {bm.pageIndex + 1}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-stone-500 dark:text-stone-400 line-clamp-2 mt-0.5">
                            {bm.excerpt}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
        </IosSheet>

        {/* Typography & Background Drawer */}
        <ReaderSettingsDrawer
          isOpen={showSettings}
          onClose={() => setShowSettings(false)}
          onBackToToolsMenu={() => setShowToolsMenu(true)}
          settings={settings}
          onUpdateSettings={applySmoothReaderSetting}
          customFonts={customFonts}
          onAddCustomFont={onAddCustomFont}
        />

        {/* AI Audiobook & Character Voice Dubbing Drawer */}
        {currentChapter && (
          <AudiobookStudioDrawer
            isOpen={showAudio}
            onClose={() => setShowAudio(false)}
            onBackToToolsMenu={() => setShowToolsMenu(true)}
            onOpenPanel={() => {
              setShowSettings(false);
              setShowAmbient(false);
              setShowAudio(true);
            }}
            isReaderActive={isReaderActive}
            hasPaginatedFooter={isPaginatedMode}
            highlightSpokenText={settings.highlightSpokenText !== false}
            onToggleHighlightSpoken={(next) => onUpdateSettings({ highlightSpokenText: next })}
            onSessionActiveChange={(active) => {
              setIsAudioSessionActive(active);
              if (!active) {
                setListeningChapterIndex(null);
                setListeningPageIndex(null);
              }
              onAudioSessionActiveChange?.(active);
            }}
            book={book}
            chapter={currentChapter}
            hasNextChapter={chapterIndex < book.chapters.length - 1}
            displayedParagraphs={
              settings.translationMode === 'override'
                ? renderedParagraphs.map((p) => p.original)
                : undefined
            }
            ttsLanguageCode={
              settings.translationMode === 'override' ? settings.targetLang : book.language
            }
            autoPlaySignal={autoPlaySignal}
            togglePlaySignal={togglePlaySignal}
            audioCommandSignal={audioCommandSignal}
            onSaveChapterAnalysis={handleSaveAnalysis}
            onUpdateVoiceAssignment={handleUpdateVoiceAssignment}
            onBatchUpdateVoiceAssignments={(nextMap) =>
              patchActiveBook((prev) => ({
                ...prev,
                voiceAssignments: {
                  ...(prev.voiceAssignments || {}),
                  ...nextMap,
                },
              }))
            }
            onUpdateReadingStyle={(style) =>
              patchActiveBook((prev) => ({
                ...prev,
                readingStyle: style,
              }))
            }
            onToggleCharacterVoices={(enabled) =>
              patchActiveBook((prev) => ({
                ...prev,
                characterVoicesEnabled: enabled,
                characterVoicesConfigured: enabled ? true : prev.characterVoicesConfigured,
              }))
            }
            externalVoices={externalVoices}
            onAddExternalVoice={onAddExternalVoice}
            customAmbientTracks={customAmbientTracks}
            onAddCustomAmbientTrack={onAddCustomAmbientTrack}
            onDeleteCustomAmbientTrack={onDeleteCustomAmbientTrack}
            onHighlightParagraph={(paraIdx, _ratio = 0, charOffset = 0) => {
              setSpokenParaIndex(paraIdx);
              setSpokenCharOffset(charOffset);
              if (paraIdx !== null) {
                setListeningChapterIndex((prev) => (prev === null ? chapterIndex : prev));
              }
            }}
            onSyncReadingParagraph={(paraIdx, charOffset = 0) => {
              syncParagraphPosition(paraIdx, charOffset, false);
            }}
            onPlaybackStateChange={(playing) => {
              setIsAudioPlayingLocal(playing);
              if (playing) {
                setListeningChapterIndex((prev) => (prev === null ? chapterIndex : prev));
                setListeningPageIndex((prev) =>
                  prev === null ? currentPageIndexRef.current : prev
                );
              }
              onAudioPlayingChange?.(playing);
            }}
            defaultVoice={basicSettings.defaultVoice}
            standaloneDeviceMode={basicSettings.standaloneDeviceMode !== false}
            onNextChapter={() => {
              isFollowingAudioRef.current = true;
              lastSpokenPageIdxRef.current = null;
              if (chapterIndex < book.chapters.length - 1) goToChapter(chapterIndex + 1);
            }}
          />
        )}

        {/* Compact Spinning Disc Trigger on Side Edge while Reading with Audio Active */}
        {isReaderActive &&
          (isAudioPlayingLocal || isAudioSessionActive) &&
          !showAudio &&
          typeof document !== 'undefined' &&
          createPortal(
            <button
              type="button"
              data-testid="reader-spinning-disc"
              onClick={() => {
                setShowToolsMenu(false);
                setShowQuickActions(false);
                setShowSettings(false);
                setShowAmbient(false);
                setShowAudio(true);
              }}
              aria-label="Mở cài đặt giọng đọc và nhạc nền"
              className={`fixed right-3 z-[55] w-11 h-11 rounded-full bg-stone-900 dark:bg-stone-800 border-2 border-amber-500/80 shadow-xl flex items-center justify-center text-amber-400 hover:scale-105 active:scale-95 transition-transform ${
                isPaginatedMode ? 'bottom-[68px]' : 'bottom-5'
              }`}
            >
              <Disc3
                className={`w-6 h-6 ${
                  isAudioPlayingLocal ? 'animate-spin [animation-duration:4s]' : ''
                }`}
              />
            </button>,
            document.body
          )}

        {/* Ambient Sound & Chill Music Drawer */}
        <AmbientSoundDrawer
          isOpen={showAmbient}
          onClose={() => setShowAmbient(false)}
          onBackToToolsMenu={() => setShowToolsMenu(true)}
          customTracks={customAmbientTracks}
          onAddCustomTrack={onAddCustomAmbientTrack}
          onDeleteCustomTrack={onDeleteCustomAmbientTrack}
        />

        {/* On-Demand Selective Per-Item AI Book Cleanup Confirmation Modal */}
        {cleanupReviewReport && (
          <BookCleanupReviewModal
            isOpen
            bookTitle={book.title}
            report={cleanupReviewReport}
            confirmLabel="Xóa"
            keepOriginalLabel="Hủy"
            onKeepOriginal={() => setCleanupReviewReport(null)}
            onConfirmItemIds={(selectedIds) => {
              const { cleanedBook, removedCount, fixedCount } = applyBookCleanupByItemIds(
                book,
                cleanupReviewReport,
                selectedIds
              );
              setCleanupReviewReport(null);
              if (removedCount > 0 || fixedCount > 0) {
                onUpdateBook(cleanedBook);
                setCleanScanVerified(true);
              }
            }}
          />
        )}
      </div>
    </div>
  );
};
