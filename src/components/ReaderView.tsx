import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  ArrowLeft,
  Bookmark,
  BookMarked,
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
  findScreenPageForParagraph,
  findScreenPageForPosition,
  paginateChapterForViewport,
  type ScreenPageChunk,
} from '../utils/screenPaginator';
import {
  PAGE_TURN_STYLES,
  computeInteractiveCurlTransform,
  getPageTurnAnimationClass,
  getVintagePaperTextureStyles,
} from '../utils/readerEffects';
import { buildEpubBlob } from '../utils/epubBuilder';
import { ambientSoundManager } from '../utils/ambientSoundEngine';
import { getLanguagePackDefinition } from '../utils/languagePacks';
import {
  hasOriginalBookBackup,
  restoreOriginalBookFromBackup,
  translateEntireBookAndBuildEpub,
  translateParagraphsFast,
} from '../utils/bookTranslator';
import { triggerDeviceHaptic } from '../utils/deviceHardware';
import { unlockAudioPlaybackSync } from '../utils/deviceTtsEngine';
import { ReaderSettingsDrawer } from './ReaderSettingsDrawer';
import { AudiobookStudioDrawer } from './AudiobookStudioDrawer';
import { AmbientSoundDrawer } from './AmbientSoundDrawer';
import { GlassSelect, type GlassSelectOption } from './GlassSelect';

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
  audioDrawerToggleSignal = 0,
  isReaderActive = true,
}) => {
  const [showToc, setShowToc] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAudio, setShowAudio] = useState(initialOpenAudio);
  const [showAmbient, setShowAmbient] = useState(false);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [isAudioPlayingLocal, setIsAudioPlayingLocal] = useState(false);
  const [isAudioSessionActive, setIsAudioSessionActive] = useState(false);
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
  const [dragCurlDeltaX, setDragCurlDeltaX] = useState<number | null>(null);
  const [spokenParaIndex, setSpokenParaIndex] = useState<number | null>(null);
  const [spokenProgressRatio, setSpokenProgressRatio] = useState(0);
  const [activeParaAction, setActiveParaAction] = useState<{
    paragraphIndex: number;
    copied?: boolean;
  } | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [stageSize, setStageSize] = useState<{ width: number; height: number }>(() => {
    if (typeof window === 'undefined') return { width: 360, height: 600 };
    const widthLimitMap: Record<ReaderSettings['pageWidth'], number> = {
      narrow: 576,
      medium: 672,
      wide: 896,
      full: 1152,
    };
    const rawW = window.innerWidth;
    const rawH = Math.max(320, window.innerHeight - 108);
    const horizPad = rawW >= 640 ? 64 : 32;
    const maxArticleW = widthLimitMap[settings.pageWidth] || 672;
    return {
      width: Math.max(220, Math.min(rawW - horizPad, maxArticleW)),
      height: Math.max(240, rawH - 18),
    };
  });

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pageMeasureBoxRef = useRef<HTMLDivElement>(null);
  const paraRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const dragStartXRef = useRef<number | null>(null);
  const dragStartYRef = useRef<number | null>(null);
  const isHorizontalDragRef = useRef(false);
  const suppressNextClickRef = useRef(false);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null);
  const pendingLastPageOnPrevChapterRef = useRef(false);
  const pendingTargetPageRef = useRef<number | null>(null);
  const hasUserTurnedRef = useRef(false);
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
      const rawH = box ? box.clientHeight : Math.max(320, window.innerHeight - 108);
      const horizPad = window.innerWidth >= 640 ? 64 : 32;
      const maxArticleW = widthLimitMap[settings.pageWidth] || 672;
      const contentW = Math.max(220, Math.min(rawW - horizPad, maxArticleW));
      const contentH = Math.max(240, rawH - 18);
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
  }, [settings.pageWidth, settings.readingMode, showAudio, showSettings, showAmbient, isReaderActive]);

  // True screen-fitted pagination: recalculates total pages automatically when fontSize/lineHeight/viewport changes
  const screenPages = useMemo(() => {
    return paginateChapterForViewport({
      paragraphs: renderedParagraphs,
      chapterTitle: currentChapter?.title || book.title,
      viewportWidth: stageSize.width,
      viewportHeight: stageSize.height,
      settings,
    });
  }, [
    renderedParagraphs,
    currentChapter?.title,
    book.title,
    stageSize.width,
    stageSize.height,
    settings.fontFamily,
    settings.fontSize,
    settings.lineHeight,
    settings.paragraphSpacing,
    settings.letterSpacing,
    settings.fontWeight,
    settings.firstLineIndent,
    settings.dropCap,
    settings.columnsInPaginated,
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

  // Keep spoken paragraph visible (auto-flip page in paginated mode + smooth scroll in scroll mode)
  useEffect(() => {
    if (spokenParaIndex === null) return;
    anchorParagraphRef.current = spokenParaIndex;
    anchorCharOffsetRef.current = 0;
    if (settings.readingMode === 'paginated') {
      const targetPageIdx = findScreenPageForParagraph(screenPages, spokenParaIndex);
      if (targetPageIdx >= 0) {
        anchorPageIndexRef.current = targetPageIdx;
        if (targetPageIdx !== currentPageIndex) {
          setCurrentPageIndex(targetPageIdx);
        }
      }
    } else {
      const timer = window.setTimeout(() => {
        const el = paraRefs.current.get(spokenParaIndex);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 60);
      return () => window.clearTimeout(timer);
    }
  }, [spokenParaIndex, settings.readingMode, screenPages]);

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

  const commitPageChange = (nextPageIdx: number, direction: 'next' | 'prev') => {
    setActiveParaAction(null);
    hasUserTurnedRef.current = true;
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

  const goNextPage = () => {
    if (currentPageIndex < screenPages.length - 1) {
      commitPageChange(currentPageIndex + 1, 'next');
    } else if (chapterIndex < book.chapters.length - 1) {
      pendingLastPageOnPrevChapterRef.current = false;
      hasUserTurnedRef.current = true;
      setTurnDirection('next');
      setTurnTick((t) => t + 1);
      goToChapter(chapterIndex + 1);
      triggerDeviceHaptic('page', basicSettings.hapticFeedback !== false);
    }
  };

  const goPrevPage = () => {
    if (currentPageIndex > 0) {
      commitPageChange(currentPageIndex - 1, 'prev');
    } else if (chapterIndex > 0) {
      pendingLastPageOnPrevChapterRef.current = true;
      hasUserTurnedRef.current = true;
      setTurnDirection('prev');
      setTurnTick((t) => t + 1);
      goToChapter(chapterIndex - 1);
      triggerDeviceHaptic('page', basicSettings.hapticFeedback !== false);
    }
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

  const syncParagraphPosition = (paraIdx: number) => {
    const targetPage =
      settings.readingMode === 'paginated'
        ? findScreenPageForParagraph(screenPages, paraIdx)
        : currentPageIndexRef.current;
    anchorParagraphRef.current = paraIdx;
    anchorCharOffsetRef.current = 0;
    anchorPageIndexRef.current = targetPage;
    syncReadingPosition({
      paragraphIndex: paraIdx,
      pageIndex: targetPage,
      charOffset: 0,
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
      syncParagraphPosition(paraIndex);
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
    if (settings.readingMode !== 'paginated' || !basicSettings.tapToTurnPage) return;
    if ((e.target as HTMLElement).closest('button, select, input')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const xRatio = (e.clientX - rect.left) / rect.width;
    if (xRatio < 0.3) {
      goPrevPage();
    } else if (xRatio > 0.7) {
      goNextPage();
    }
  };

  const handleStagePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (settings.readingMode !== 'paginated') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, select, input')) return;
    dragStartXRef.current = e.clientX;
    dragStartYRef.current = e.clientY;
    isHorizontalDragRef.current = false;
  };

  const handleStagePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (settings.readingMode !== 'paginated' || dragStartXRef.current === null) return;
    if (e.pointerType === 'mouse' && e.buttons !== 1) return;
    const dx = e.clientX - dragStartXRef.current;
    const dy = e.clientY - (dragStartYRef.current ?? e.clientY);
    if (!isHorizontalDragRef.current) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.15) {
        isHorizontalDragRef.current = true;
        clearLongPressTimer();
      } else {
        return;
      }
    }
    if (settings.pageTurnStyle === 'curl') {
      setDragCurlDeltaX(dx);
    }
  };

  const finishStageDrag = (clientX?: number) => {
    clearLongPressTimer();
    const startX = dragStartXRef.current;
    const wasHorizontal = isHorizontalDragRef.current;
    dragStartXRef.current = null;
    dragStartYRef.current = null;
    isHorizontalDragRef.current = false;

    if (!wasHorizontal || startX === null || typeof clientX !== 'number') {
      setDragCurlDeltaX(null);
      return;
    }

    suppressNextClickRef.current = true;
    const dx = clientX - startX;
    const curlEval = computeInteractiveCurlTransform(dx, stageSize.width);
    const shouldFlip =
      settings.pageTurnStyle === 'curl'
        ? curlEval.shouldCommitFlip
        : Math.abs(dx) > 40;

    setDragCurlDeltaX(null);
    if (shouldFlip) {
      if (dx < 0) {
        goNextPage();
      } else {
        goPrevPage();
      }
    }
  };

  const renderIlluminatedText = (text: string, isSpoken: boolean) => {
    if (!isSpoken || settings.highlightSpokenText === false) return text;
    const words = text.split(/(\s+)/);
    const nonSpaceTotal = words.filter((w) => w.trim().length > 0).length;
    const currentWordIdx = Math.min(
      nonSpaceTotal,
      Math.max(1, Math.ceil(nonSpaceTotal * Math.max(0.02, spokenProgressRatio)))
    );
    let wordCounter = 0;

    return words.map((token, idx) => {
      if (token.trim().length === 0) return token;
      wordCounter += 1;
      const isCurrent = wordCounter === currentWordIdx;
      const isPast = wordCounter < currentWordIdx;
      return (
        <span
          key={idx}
          className={
            isCurrent
              ? 'bg-amber-400/90 dark:bg-amber-500/85 text-stone-950 font-semibold rounded px-0.5 transition-colors duration-75'
              : isPast
              ? 'bg-amber-200/55 dark:bg-amber-700/35 rounded-xs transition-colors duration-100'
              : 'opacity-80'
          }
        >
          {token}
        </span>
      );
    });
  };

  const safePageIndex = Math.min(currentPageIndex, Math.max(0, screenPages.length - 1));
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
  const liveCurlTransform =
    isPaginatedMode && settings.pageTurnStyle === 'curl' && dragCurlDeltaX !== null
      ? computeInteractiveCurlTransform(dragCurlDeltaX, stageSize.width)
      : null;
  const pageTurnClass =
    isPaginatedMode && !liveCurlTransform && hasUserTurnedRef.current && turnTick > 0
      ? getPageTurnAnimationClass(settings.pageTurnStyle, turnDirection)
      : '';
  const activeTurnLabel =
    PAGE_TURN_STYLES.find((s) => s.id === (settings.pageTurnStyle || 'curl'))?.label ||
    'Cong mép sách';

  return (
    <div
      data-testid="reader-surface"
      style={{
        backgroundColor: activeTheme.bg,
        color: activeTheme.text,
        filter: `brightness(${settings.brightness}%) sepia(${settings.warmth}%)`,
        ...vintageTexture,
      }}
      className={`${
        isPaginatedMode ? 'h-[100dvh] overflow-hidden' : 'min-h-screen'
      } w-full flex flex-col transition-colors duration-200`}
    >
      {/* Slim Top Bar: Back | 3-bar Menu TOC | Per-Page Bookmark + Play/Pause + Quick Actions (!) + Settings */}
      <div
        style={{
          borderColor: activeTheme.border,
          backgroundColor: activeTheme.bg,
        }}
        className="sticky top-0 z-30 h-[52px] border-b px-3 sm:px-5 flex items-center justify-between gap-2"
      >
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={handleBackToLibraryClick}
            aria-label="Quay lại tủ sách"
            className="ios-liquid-pill inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full ios-liquid-bar border border-white/60 dark:border-white/15 text-xs font-medium text-stone-800 dark:text-stone-100 whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Tủ sách</span>
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
            aria-label="Mở công cụ nhanh cỡ chữ và dịch"
            aria-expanded={showQuickActions}
            title="Chỉnh cỡ chữ & dịch nhanh"
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

      {/* Quick Actions Floating Bar (!) — A- / A+ & Quick Translate Toggle */}
      {showQuickActions &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[70] bg-transparent flex items-start justify-end pt-[58px] pr-3 sm:pr-5"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowQuickActions(false);
            }}
          >
            <div
              role="dialog"
              aria-label="Công cụ đọc nhanh"
              className="ios-sheet-enter ios-frosted-surface rounded-[22px] p-2.5 flex items-center gap-2 text-stone-900 dark:text-stone-100"
            >
              <div className="inline-flex items-center gap-1 rounded-full bg-black/5 dark:bg-white/10 p-1">
                <button
                  type="button"
                  disabled={settings.fontSize <= 14}
                  onClick={() =>
                    onUpdateSettings({ fontSize: Math.max(14, settings.fontSize - 1) })
                  }
                  aria-label="Giảm cỡ chữ"
                  className="px-2.5 py-1 rounded-full text-xs font-semibold hover:bg-white/80 dark:hover:bg-white/15 disabled:opacity-35 transition-colors"
                >
                  A-
                </button>
                <span className="px-1 text-[11px] font-semibold tabular-nums min-w-[36px] text-center opacity-80">
                  {settings.fontSize}px
                </span>
                <button
                  type="button"
                  disabled={settings.fontSize >= 32}
                  onClick={() =>
                    onUpdateSettings({ fontSize: Math.min(32, settings.fontSize + 1) })
                  }
                  aria-label="Tăng cỡ chữ"
                  className="px-2.5 py-1 rounded-full text-xs font-semibold hover:bg-white/80 dark:hover:bg-white/15 disabled:opacity-35 transition-colors"
                >
                  A+
                </button>
              </div>

              <button
                type="button"
                disabled={isTranslating}
                onClick={() => {
                  const nextMode: TranslationMode =
                    settings.translationMode === 'override' ? 'original' : 'override';
                  void handleTranslationModeChange(nextMode);
                }}
                aria-pressed={settings.translationMode === 'override'}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11.5px] font-semibold transition-colors whitespace-nowrap ${
                  settings.translationMode === 'override'
                    ? 'bg-amber-800 text-white shadow-sm'
                    : 'bg-black/5 dark:bg-white/10 text-stone-800 dark:text-stone-100 hover:bg-black/10 dark:hover:bg-white/15'
                }`}
              >
                <Languages className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {settings.translationMode === 'override' ? 'Đang dịch' : 'Dịch nhanh'}
                </span>
              </button>
            </div>
          </div>,
          document.body
        )}

      {/* Collapsible Corner Options Popover / Sheet (3 Stacked List Items + Dịch nhanh + Xuất EPUB) */}
      {showToolsMenu &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[70] ios-frosted-backdrop flex items-end sm:items-start sm:justify-end p-0 sm:pt-[60px] sm:pr-5"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowToolsMenu(false);
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Tùy chọn trình đọc sách"
              className="ios-sheet-enter ios-frosted-surface w-full max-w-full sm:w-[348px] text-stone-900 dark:text-stone-100 rounded-t-[26px] sm:rounded-[24px] overflow-hidden max-h-[92vh] flex flex-col"
            >
              <div className="sm:hidden flex justify-center pt-2 shrink-0">
                <div className="w-10 h-1 rounded-full bg-stone-400/50 dark:bg-stone-600/70" />
              </div>

              <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-stone-300/40 dark:border-white/10 shrink-0">
                <h2 className="text-[13px] font-display font-semibold truncate">
                  Tùy chọn đọc sách
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
                      <span>Chữ, Nền &amp; Lật</span>
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
                      <span>Giọng đọc</span>
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
                        Nhạc nền{ambientActiveCount > 0 ? ` (${ambientActiveCount})` : ''}
                      </span>
                    </span>
                    <ChevronRight className="w-4 h-4 text-stone-400 shrink-0" />
                  </button>
                </div>

                {/* Compact Inline Dịch nhanh Controls with GlassSelect */}
                <div className="space-y-2 pt-2 border-t border-stone-300/40 dark:border-white/10">
                  <div className="text-[11px] font-semibold text-stone-600 dark:text-stone-400">
                    Dịch nhanh
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
                      {settings.translationMode !== 'original' ? 'Dịch & xuất EPUB' : 'Xuất EPUB'}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Main Content + Docked Side Drawers */}
      <div className={`flex-1 flex relative min-h-0 ${isPaginatedMode ? 'overflow-hidden' : 'items-start'}`}>
        <div
          ref={scrollContainerRef}
          onClick={handleCanvasTapForPagination}
          onPointerDown={handleStagePointerDown}
          onPointerMove={handleStagePointerMove}
          onPointerUp={(e) => finishStageDrag(e.clientX)}
          onPointerCancel={() => finishStageDrag()}
          style={{ touchAction: isPaginatedMode ? 'pan-y' : undefined }}
          className={`flex-1 min-w-0 page-turn-stage ${
            isPaginatedMode
              ? 'h-full flex flex-col overflow-hidden select-none'
              : 'overflow-x-hidden px-4 sm:px-8 pt-6 sm:pt-9 pb-12'
          }`}
        >
          {/* Reading viewport box (measured by ResizeObserver in paginated mode so 1 screen = 1 exact page) */}
          <div
            ref={pageMeasureBoxRef}
            className={
              isPaginatedMode
                ? 'flex-1 min-h-0 w-full px-4 sm:px-8 pt-3.5 pb-1 overflow-hidden'
                : 'w-full'
            }
          >
            <article
              key={
                isPaginatedMode
                  ? `${chapterIndex}-${safePageIndex}-${turnTick}`
                  : chapterIndex
              }
              className={`mx-auto ${WIDTH_CLASSES[settings.pageWidth]} ${pageTurnClass} ${
                liveCurlTransform ? '' : 'transition-all'
              }`}
              style={{
                fontFamily: settings.fontFamily,
                fontSize: `${settings.fontSize}px`,
                lineHeight: settings.lineHeight,
                letterSpacing: `${settings.letterSpacing}em`,
                fontWeight: settings.fontWeight,
                textAlign: settings.textAlign,
                ...(liveCurlTransform
                  ? {
                      transformOrigin:
                        liveCurlTransform.direction === 'next' ? 'left center' : 'right center',
                      transform: `perspective(1400px) translateX(${liveCurlTransform.translateXPx}px) rotateY(${liveCurlTransform.rotateYDeg}deg)`,
                      boxShadow: `0 12px 32px rgba(28, 25, 23, ${liveCurlTransform.shadowAlpha})`,
                      transition: 'none',
                    }
                  : {}),
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

              {/* Chapter Header (shown on Page 1 in paginated mode, or top of scroll mode) */}
              {(!isPaginatedMode || activeScreenPage.hasChapterHeader) && (
                <header
                  className={isPaginatedMode ? 'mb-4 pb-3 border-b' : 'mb-8 pb-6 border-b'}
                  style={{ borderColor: activeTheme.border }}
                >
                  <p className="text-[11px] uppercase tracking-wider opacity-60 font-sans mb-1.5 tabular-nums truncate">
                    {book.title} · Chương {chapterIndex + 1}/{book.chapters.length}
                  </p>
                  <h1 className="text-xl sm:text-2xl font-display font-semibold leading-snug text-left">
                    {currentChapter?.title}
                  </h1>
                </header>
              )}

              {/* Paragraphs — clean reading view; long-press (ấn giữ) reveals Nghe từ đây / Đánh dấu */}
              <div
                className={
                  isPaginatedMode && settings.columnsInPaginated === 2
                    ? 'md:columns-2 md:gap-10'
                    : ''
                }
              >
                {visibleChunks.map((chunk, idx) => {
                  const highlight = book.highlights.find(
                    (h) => h.chapterId === currentChapter?.id && h.paragraphIndex === chunk.paragraphIndex
                  );
                  const isSpoken = spokenParaIndex === chunk.paragraphIndex;
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
                        if (el && chunk.isFirstOfParagraph) {
                          paraRefs.current.set(chunk.paragraphIndex, el);
                        } else if (!el) {
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
                        syncParagraphPosition(chunk.paragraphIndex);
                        setActiveParaAction({ paragraphIndex: chunk.paragraphIndex });
                      }}
                      className={`relative rounded-lg px-1.5 py-0.5 transition-colors select-none ${
                        isSpoken && settings.highlightSpokenText !== false
                          ? 'ring-2 ring-amber-700/70 bg-amber-500/10'
                          : isLongPressed
                          ? 'ring-1 ring-amber-700/60 bg-amber-500/10'
                          : ''
                      } ${highlight ? HIGHLIGHT_CLASSES[highlight.color] : ''}`}
                    >
                      <p
                        className={`${useDropCap ? 'editorial-dropcap' : ''} ${
                          settings.firstLineIndent && chunk.isFirstOfParagraph && !useDropCap
                            ? 'indent-7'
                            : ''
                        }`}
                      >
                        {renderIlluminatedText(chunk.original, isSpoken)}
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

          {/* Slim Fixed Bottom Page Bar in Paginated Screen-Fitted Mode */}
          {isPaginatedMode && (
            <footer
              style={{ borderColor: activeTheme.border }}
              className="shrink-0 h-[44px] px-3 sm:px-6 border-t flex items-center justify-between gap-2 font-sans text-[11px] pb-safe"
            >
              <button
                type="button"
                disabled={safePageIndex === 0 && chapterIndex === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  goPrevPage();
                }}
                aria-label="Trang trước"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-35"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Trước</span>
              </button>

              <div className="min-w-0 text-center tabular-nums opacity-75 truncate">
                <span className="font-semibold">
                  Trang {safePageIndex + 1}/{Math.max(1, screenPages.length)}
                </span>
                <span className="mx-1.5 opacity-50">·</span>
                <span>
                  Ch.{chapterIndex + 1}/{book.chapters.length}
                </span>
                <span className="hidden sm:inline opacity-60"> · {activeTurnLabel}</span>
              </div>

              <button
                type="button"
                disabled={
                  safePageIndex >= screenPages.length - 1 &&
                  chapterIndex >= book.chapters.length - 1
                }
                onClick={(e) => {
                  e.stopPropagation();
                  goNextPage();
                }}
                aria-label="Trang tiếp"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-35"
              >
                <span>Tiếp</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </footer>
          )}
        </div>

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
                      syncParagraphPosition(pIdx);
                      setActiveParaAction(null);
                      handleContinueListenFromHere();
                    }}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-amber-800 hover:bg-amber-900 text-white font-semibold"
                  >
                    <Play className="w-3.5 h-3.5 shrink-0" />
                    <span>Nghe từ đây</span>
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
                    <span>{isCurrentPageBookmarked ? 'Bỏ lưu dấu' : 'Lưu dấu trang'}</span>
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

        {/* Table of Contents & Bookmarks Sidebar (Portaled frosted-glass panel) */}
        {showToc &&
          typeof document !== 'undefined' &&
          createPortal(
            <div className="fixed inset-0 z-[75] flex items-end sm:items-start sm:justify-start">
              <div
                className="fixed inset-0 ios-frosted-backdrop"
                onClick={() => setShowToc(false)}
                aria-hidden="true"
              />
              <aside
                aria-label="Mục lục và đánh dấu trang"
                className="ios-sheet-enter sm:ios-drawer-left ios-frosted-surface relative z-10 w-full sm:w-80 sm:mt-[56px] sm:ml-3 h-auto max-h-[82dvh] sm:max-h-[calc(100dvh-72px)] text-stone-900 dark:text-stone-100 rounded-t-[28px] sm:rounded-[24px] flex flex-col overflow-hidden"
              >
                <div className="sm:hidden flex justify-center pt-2 pb-1 shrink-0">
                  <span className="w-10 h-1 rounded-full bg-stone-400/50 dark:bg-stone-600/70" />
                </div>
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-300/40 dark:border-white/10 shrink-0">
                  <h2 className="text-base font-display font-semibold">Mục lục &amp; Đánh dấu</h2>
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
              </aside>
            </div>,
            document.body
          )}

        {/* Typography & Background Drawer */}
        <ReaderSettingsDrawer
          isOpen={showSettings}
          onClose={() => setShowSettings(false)}
          onBackToToolsMenu={() => setShowToolsMenu(true)}
          settings={settings}
          onUpdateSettings={onUpdateSettings}
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
            onSessionActiveChange={setIsAudioSessionActive}
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
            externalVoices={externalVoices}
            onAddExternalVoice={onAddExternalVoice}
            customAmbientTracks={customAmbientTracks}
            onAddCustomAmbientTrack={onAddCustomAmbientTrack}
            onDeleteCustomAmbientTrack={onDeleteCustomAmbientTrack}
            onHighlightParagraph={(paraIdx, ratio = 0) => {
              setSpokenParaIndex(paraIdx);
              setSpokenProgressRatio(ratio);
            }}
            onSyncReadingParagraph={(paraIdx) => {
              syncParagraphPosition(paraIdx);
            }}
            onPlaybackStateChange={(playing) => {
              setIsAudioPlayingLocal(playing);
              onAudioPlayingChange?.(playing);
            }}
            defaultVoice={basicSettings.defaultVoice}
            standaloneDeviceMode={basicSettings.standaloneDeviceMode !== false}
            onNextChapter={() => {
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
                isPaginatedMode ? 'bottom-[56px]' : 'bottom-5'
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
      </div>
    </div>
  );
};
