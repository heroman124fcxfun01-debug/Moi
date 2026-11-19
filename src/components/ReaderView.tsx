import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  Bookmark,
  BookMarked,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileOutput,
  Headphones,
  Languages,
  List,
  Loader2,
  MoreVertical,
  Music,
  PackageCheck,
  Play,
  RotateCcw,
  Settings,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type {
  AppBasicSettings,
  Book,
  BookReadingStyle,
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
  paginateParagraphs,
} from '../utils/textProcessing';
import {
  PAGE_TURN_STYLES,
  getPageTurnAnimationClass,
  getVintagePaperTextureStyles,
} from '../utils/readerEffects';
import { buildEpubBlob } from '../utils/epubBuilder';
import { ambientSoundManager } from '../utils/ambientSoundEngine';
import {
  downloadLanguagePackToApp,
  getLanguagePackDefinition,
  loadInstalledLanguagePacks,
  type InstalledLanguagePack,
} from '../utils/languagePacks';
import {
  hasOriginalBookBackup,
  restoreOriginalBookFromBackup,
  translateEntireBookAndBuildEpub,
  translateParagraphsFast,
} from '../utils/bookTranslator';
import { triggerDeviceHaptic } from '../utils/deviceHardware';
import { ReaderSettingsDrawer } from './ReaderSettingsDrawer';
import { AudiobookStudioDrawer } from './AudiobookStudioDrawer';
import { AmbientSoundDrawer } from './AmbientSoundDrawer';

interface ReaderViewProps {
  book: Book;
  initialOpenAudio?: boolean;
  basicSettings: AppBasicSettings;
  onBackToLibrary: () => void;
  onUpdateBook: (updated: Book) => void;
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

export const ReaderView: React.FC<ReaderViewProps> = ({
  book,
  initialOpenAudio = false,
  basicSettings,
  onBackToLibrary,
  onUpdateBook,
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
  const [ambientActiveCount, setAmbientActiveCount] = useState(
    () => Object.keys(ambientSoundManager.getSnapshot().activeVolumes).length
  );
  const [autoPlaySignal, setAutoPlaySignal] = useState(0);

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
  const [installedPacks, setInstalledPacks] = useState<Record<string, InstalledLanguagePack>>(() =>
    loadInstalledLanguagePacks()
  );
  const [isDownloadingPack, setIsDownloadingPack] = useState(false);
  const [packProgressMsg, setPackProgressMsg] = useState('');
  const [isTranslatingFullEpub, setIsTranslatingFullEpub] = useState(false);
  const [fullEpubProgress, setFullEpubProgress] = useState<{
    percent: number;
    message: string;
  } | null>(null);
  const fullTranslateAbortRef = useRef<AbortController | null>(null);

  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [turnDirection, setTurnDirection] = useState<'next' | 'prev'>('next');
  const [turnTick, setTurnTick] = useState(0);
  const [spokenParaIndex, setSpokenParaIndex] = useState<number | null>(null);
  const [spokenProgressRatio, setSpokenProgressRatio] = useState(0);
  const [activeParaAction, setActiveParaAction] = useState<number | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const paraRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const touchStartXRef = useRef<number | null>(null);

  const chapterIndex = Math.min(
    Math.max(0, book.currentChapterIndex),
    Math.max(0, book.chapters.length - 1)
  );
  const currentChapter = book.chapters[chapterIndex];
  const readingStyle: BookReadingStyle = book.readingStyle || 'novel';

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

  const handleDownloadActiveLanguagePack = async (langCode: string) => {
    setTranslateError('');
    setIsDownloadingPack(true);
    setPackProgressMsg('Đang tải gói ngôn ngữ vào app...');
    try {
      const pack = await downloadLanguagePackToApp(langCode, (_pct, msg) => {
        setPackProgressMsg(msg);
      });
      setInstalledPacks((prev) => ({ ...prev, [pack.code]: pack }));
      setTranslateStatusMsg(
        `Đã tải gói ngôn ngữ ${pack.label} vào ứng dụng (${pack.sizeLabel}). Tốc độ dịch và độ chuẩn văn học đã được kích hoạt!`
      );
    } catch (err) {
      setTranslateError(err instanceof Error ? err.message : 'Không thể tải gói ngôn ngữ.');
    } finally {
      setIsDownloadingPack(false);
      setPackProgressMsg('');
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
      // Auto-install language pack if missing so translation uses literary rules immediately
      if (!installedPacks[settings.targetLang]) {
        const pack = await downloadLanguagePackToApp(settings.targetLang, (_p, msg) => {
          setFullEpubProgress({ percent: 5, message: msg });
        });
        setInstalledPacks((prev) => ({ ...prev, [pack.code]: pack }));
      }

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

  const pages = useMemo(() => {
    const wordsPerPage = settings.columnsInPaginated === 2 ? 320 : 210;
    return paginateParagraphs(renderedParagraphs, wordsPerPage);
  }, [renderedParagraphs, settings.columnsInPaginated]);

  // Keep spoken paragraph visible (auto-flip page in paginated mode + smooth scroll in scroll mode)
  useEffect(() => {
    if (spokenParaIndex === null) return;
    if (settings.readingMode === 'paginated') {
      const targetPageIdx = pages.findIndex((pg) =>
        pg.some((pair) => pair.index === spokenParaIndex)
      );
      if (targetPageIdx >= 0 && targetPageIdx !== currentPageIndex) {
        setCurrentPageIndex(targetPageIdx);
      }
    }
    const timer = window.setTimeout(() => {
      const el = paraRefs.current.get(spokenParaIndex);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 60);
    return () => window.clearTimeout(timer);
  }, [spokenParaIndex, settings.readingMode, pages]);

  useEffect(() => {
    setCurrentPageIndex(0);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [chapterIndex]);

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

  const goNextPage = () => {
    if (currentPageIndex < pages.length - 1) {
      setTurnDirection('next');
      setTurnTick((t) => t + 1);
      setCurrentPageIndex((p) => p + 1);
      triggerDeviceHaptic('page', basicSettings.hapticFeedback !== false);
    } else if (chapterIndex < book.chapters.length - 1) {
      setTurnDirection('next');
      setTurnTick((t) => t + 1);
      goToChapter(chapterIndex + 1);
      triggerDeviceHaptic('page', basicSettings.hapticFeedback !== false);
    }
  };

  const goPrevPage = () => {
    if (currentPageIndex > 0) {
      setTurnDirection('prev');
      setTurnTick((t) => t + 1);
      setCurrentPageIndex((p) => p - 1);
      triggerDeviceHaptic('page', basicSettings.hapticFeedback !== false);
    } else if (chapterIndex > 0) {
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
    pages.length,
    currentPageIndex,
    chapterIndex,
    basicSettings.volumeKeyPageTurn,
    basicSettings.hapticFeedback,
  ]);

  const syncParagraphPosition = (paraIdx: number) => {
    const pct = computeReadingProgress(book.chapters, chapterIndex, paraIdx);
    onUpdateBook({
      ...book,
      currentParagraphIndex: paraIdx,
      progressPercent: pct,
      lastReadAt: Date.now(),
    });
  };

  const goToChapter = (idx: number) => {
    const clamped = Math.min(Math.max(0, idx), book.chapters.length - 1);
    setTurnDirection(clamped >= chapterIndex ? 'next' : 'prev');
    setTurnTick((t) => t + 1);
    const pct = computeReadingProgress(book.chapters, clamped, 0);
    onUpdateBook({
      ...book,
      currentChapterIndex: clamped,
      currentParagraphIndex: 0,
      progressPercent: pct,
      lastReadAt: Date.now(),
    });
    setShowToc(false);
  };

  const isBookmarked = book.bookmarks.some((bm) => bm.chapterId === currentChapter?.id);

  const toggleChapterBookmark = () => {
    if (!currentChapter) return;
    if (isBookmarked) {
      onUpdateBook({
        ...book,
        bookmarks: book.bookmarks.filter((bm) => bm.chapterId !== currentChapter.id),
      });
    } else {
      onUpdateBook({
        ...book,
        bookmarks: [
          ...book.bookmarks,
          {
            id: `bm-${Date.now()}`,
            chapterId: currentChapter.id,
            chapterTitle: currentChapter.title,
            paragraphIndex: book.currentParagraphIndex || 0,
            excerpt:
              currentChapter.paragraphs[book.currentParagraphIndex || 0]?.slice(0, 120) ||
              currentChapter.title,
            createdAt: Date.now(),
          },
        ],
      });
    }
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
    onUpdateBook({
      ...book,
      chapters: book.chapters.map((c) => (c.id === chapterId ? { ...c, analysis } : c)),
      ...(mergedVoiceAssignments
        ? {
            voiceAssignments: {
              ...book.voiceAssignments,
              ...mergedVoiceAssignments,
            },
          }
        : {}),
    });
  };

  const handleUpdateVoiceAssignment = (
    characterId: string,
    assignment: CharacterVoiceAssignment
  ) => {
    onUpdateBook({
      ...book,
      voiceAssignments: {
        ...book.voiceAssignments,
        [characterId]: assignment,
      },
    });
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
    setShowSettings(false);
    setShowAmbient(false);
    setShowToolsMenu(false);
    // Keep reading page unobstructed — playback runs inline with slim bottom bar & live word highlight
    setShowAudio(false);
    setAutoPlaySignal((s) => s + 1);
  };

  const handleCanvasTapForPagination = (e: React.MouseEvent<HTMLDivElement>) => {
    if (settings.readingMode !== 'paginated' || !basicSettings.tapToTurnPage) return;
    if ((e.target as HTMLElement).closest('button, select, input')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const xRatio = (e.clientX - rect.left) / rect.width;
    if (xRatio < 0.22) {
      goPrevPage();
    } else if (xRatio > 0.78) {
      goNextPage();
    }
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (settings.readingMode !== 'paginated') return;
    touchStartXRef.current = e.touches[0]?.clientX ?? null;
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (settings.readingMode !== 'paginated' || touchStartXRef.current === null) return;
    const endX = e.changedTouches[0]?.clientX;
    const startX = touchStartXRef.current;
    touchStartXRef.current = null;
    if (typeof endX !== 'number') return;
    const deltaX = endX - startX;
    if (deltaX < -45) {
      goNextPage();
    } else if (deltaX > 45) {
      goPrevPage();
    }
  };

  const renderIlluminatedText = (text: string, isSpoken: boolean) => {
    if (!isSpoken) return text;
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

  const visibleParagraphs =
    settings.readingMode === 'paginated'
      ? pages[Math.min(currentPageIndex, pages.length - 1)] || []
      : renderedParagraphs;

  const vintageTexture = getVintagePaperTextureStyles(activeTheme.id);
  const pageTurnClass =
    settings.readingMode === 'paginated'
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
      className="min-h-screen flex flex-col transition-colors duration-200"
    >
      {/* Ultra-slim Distraction-Free Top Bar — all controls collapsed into corner Gear / 3-dot Menu */}
      <div
        style={{
          borderColor: activeTheme.border,
          backgroundColor: activeTheme.surface,
        }}
        className="sticky top-0 z-30 h-[52px] border-b backdrop-blur-md px-3 sm:px-5 flex items-center justify-between gap-2"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            type="button"
            onClick={onBackToLibrary}
            aria-label="Quay lại tủ sách"
            className="ios-liquid-pill inline-flex items-center gap-1 px-3 py-1.5 rounded-full ios-liquid-bar border border-white/60 dark:border-white/15 text-xs font-medium text-stone-800 dark:text-stone-100 whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Tủ sách</span>
          </button>

          <button
            type="button"
            onClick={() => setShowToc((v) => !v)}
            aria-label="Mở mục lục và đánh dấu"
            className="min-w-0 flex-1 text-left px-2 py-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 truncate text-xs font-medium opacity-85"
          >
            <span className="truncate">{currentChapter?.title || book.title}</span>
          </button>
        </div>

        {/* Single Corner Options Trigger (Gear + 3-dots) */}
        <button
          type="button"
          onClick={() => setShowToolsMenu((v) => !v)}
          aria-label="Mở menu tùy chọn đọc sách"
          aria-expanded={showToolsMenu}
          className={`ios-liquid-pill relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium shrink-0 ${
            showToolsMenu || showSettings || showAudio || showAmbient
              ? 'ios-liquid-pill-active border-amber-700/40 text-amber-800 dark:text-amber-300 font-semibold'
              : 'ios-liquid-bar border-white/65 dark:border-white/15 text-stone-800 dark:text-stone-100'
          }`}
        >
          <Settings className="w-3.5 h-3.5" />
          <MoreVertical className="w-3.5 h-3.5 -ml-1 opacity-75" />
          {(ambientActiveCount > 0 || settings.translationMode !== 'original') && (
            <span className="w-2 h-2 rounded-full bg-amber-700 absolute -top-0.5 -right-0.5 ring-2 ring-[#FBF9F5] dark:ring-[#16181C]" />
          )}
        </button>
      </div>

      {/* Collapsible Corner Liquid-Glass Options Popover / Sheet */}
      {showToolsMenu &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[70] flex items-end sm:items-start sm:justify-end bg-black/35 backdrop-blur-xs p-0 sm:pt-[60px] sm:pr-5"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowToolsMenu(false);
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Tùy chọn trình đọc sách"
              className="ios-sheet-enter w-full max-w-full sm:w-[376px] bg-[#FBF9F5]/95 dark:bg-[#191B1F]/95 backdrop-blur-2xl text-stone-900 dark:text-stone-100 rounded-t-[28px] sm:rounded-[26px] border border-white/70 dark:border-stone-800 shadow-2xl overflow-hidden max-h-[88vh] flex flex-col"
            >
              <div className="sm:hidden flex justify-center pt-2.5 shrink-0">
                <div className="w-10 h-1 rounded-full bg-stone-300 dark:bg-stone-700" />
              </div>

              <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-stone-200/80 dark:border-stone-800 shrink-0">
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-display font-semibold truncate">
                    Tùy chọn đọc &amp; nghe sách
                  </h2>
                  <p className="text-[11px] text-stone-500 truncate">{book.title}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowToolsMenu(false)}
                  aria-label="Đóng menu tùy chọn đọc"
                  className="w-8 h-8 rounded-full bg-stone-200/70 dark:bg-stone-800 flex items-center justify-center text-stone-600 dark:text-stone-300 shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 pb-6 sm:pb-4 space-y-4 overflow-y-auto overflow-x-hidden text-xs">
                {/* Primary Tool Shortcuts Grid */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowToolsMenu(false);
                      setShowAudio(false);
                      setShowAmbient(false);
                      setShowSettings(true);
                    }}
                    className="ios-liquid-pill min-w-0 w-full flex items-center gap-2 p-3 rounded-2xl ios-liquid-bar border border-white/75 dark:border-zinc-700/60 text-left font-medium"
                  >
                    <SlidersHorizontal className="w-4 h-4 text-amber-800 dark:text-amber-400 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold leading-tight break-words">Chữ, Nền &amp; Lật</div>
                      <div className="text-[10px] text-stone-500 truncate">Aa · Giấy cũ</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowToolsMenu(false);
                      handleContinueListenFromHere();
                    }}
                    className="ios-liquid-btn min-w-0 w-full flex items-center gap-2 p-3 rounded-2xl bg-amber-800 text-white text-left font-medium"
                  >
                    <Play className="w-4 h-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold leading-tight break-words">Nghe tiếp AI</div>
                      <div className="text-[10px] text-amber-100 truncate">Từ đoạn đang đọc</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowToolsMenu(false);
                      setShowSettings(false);
                      setShowAmbient(false);
                      setShowAudio(true);
                    }}
                    className="ios-liquid-pill min-w-0 w-full flex items-center gap-2 p-3 rounded-2xl ios-liquid-bar border border-white/75 dark:border-zinc-700/60 text-left font-medium"
                  >
                    <Headphones className="w-4 h-4 text-amber-800 dark:text-amber-400 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold leading-tight break-words">Giọng AI &amp; Vai</div>
                      <div className="text-[10px] text-stone-500 truncate">Quét nhân vật</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowToolsMenu(false);
                      setShowSettings(false);
                      setShowAudio(false);
                      setShowAmbient(true);
                    }}
                    className="ios-liquid-pill min-w-0 w-full flex items-center gap-2 p-3 rounded-2xl ios-liquid-bar border border-white/75 dark:border-zinc-700/60 text-left font-medium"
                  >
                    <Music className="w-4 h-4 text-amber-800 dark:text-amber-400 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold leading-tight break-words">
                        Nhạc nền{ambientActiveCount > 0 ? ` (${ambientActiveCount})` : ''}
                      </div>
                      <div className="text-[10px] text-stone-500 truncate">20 tiếng chill</div>
                    </div>
                  </button>
                </div>

                {/* Translation Mode, In-App Language Pack & Fast AI Overwrite EPUB */}
                <div className="space-y-2.5 pt-2.5 border-t border-stone-200/80 dark:border-stone-800">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-stone-600 dark:text-stone-400">
                      Dịch nhanh AI &amp; Gói ngôn ngữ
                    </span>
                    {installedPacks[settings.targetLang] ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                        <PackageCheck className="w-3 h-3 shrink-0" />
                        <span>Đã tải gói {settings.targetLang.toUpperCase()}</span>
                      </span>
                    ) : (
                      <span className="text-[10px] text-amber-800 dark:text-amber-400">
                        Chưa tải gói {settings.targetLang.toUpperCase()}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-3 p-1 rounded-full ios-liquid-bar border border-white/75 dark:border-zinc-700/60 gap-1">
                    {(
                      [
                        { id: 'original', label: 'Gốc' },
                        { id: 'override', label: 'Dịch đè' },
                        { id: 'bilingual', label: 'Song ngữ' },
                      ] as Array<{ id: TranslationMode; label: string }>
                    ).map((mode) => (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() => handleTranslationModeChange(mode.id)}
                        className={`ios-liquid-pill min-w-0 px-1.5 py-1.5 text-[11px] font-medium rounded-full text-center leading-tight ${
                          settings.translationMode === mode.id
                            ? 'ios-liquid-pill-active text-amber-800 dark:text-amber-300 font-semibold'
                            : 'text-stone-600 dark:text-stone-300'
                        }`}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>

                  {/* Full-width Language Selector (never pushes adjacent buttons off-screen) */}
                  <select
                    aria-label="Ngôn ngữ dịch sách"
                    value={settings.targetLang}
                    onChange={async (e) => {
                      const lang = e.target.value;
                      onUpdateSettings({ targetLang: lang });
                      if (settings.translationMode !== 'original') {
                        await translateCurrentChapter(lang);
                      }
                    }}
                    className="w-full min-w-0 max-w-full px-3 py-2 text-xs rounded-xl ios-liquid-bar border border-white/75 dark:border-zinc-700/60 text-stone-800 dark:text-stone-100"
                  >
                    {TARGET_LANGUAGES.map((l) => (
                      <option key={l.code} value={l.code} className="text-stone-900">
                        Dịch sang: {l.label}
                      </option>
                    ))}
                  </select>

                  {/* Stacked / Wrapping Action Buttons — zero overflow on narrow screens */}
                  <div className="flex flex-col gap-2">
                    <div className="grid grid-cols-2 gap-2">
                      {!installedPacks[settings.targetLang] ? (
                        <button
                          type="button"
                          disabled={isDownloadingPack}
                          onClick={() => handleDownloadActiveLanguagePack(settings.targetLang)}
                          className="ios-liquid-pill min-w-0 w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl border border-amber-700/40 bg-amber-50/80 dark:bg-amber-950/30 text-amber-900 dark:text-amber-300 text-[11px] font-medium text-center leading-snug whitespace-normal break-words"
                        >
                          {isDownloadingPack ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                          ) : (
                            <Download className="w-3.5 h-3.5 shrink-0" />
                          )}
                          <span>
                            {isDownloadingPack
                              ? 'Đang tải gói...'
                              : `Tải gói ${getLanguagePackDefinition(settings.targetLang).label}`}
                          </span>
                        </button>
                      ) : (
                        <div className="min-w-0 w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl border border-emerald-500/30 bg-emerald-50/70 dark:bg-emerald-950/25 text-emerald-800 dark:text-emerald-300 text-[11px] font-medium text-center leading-snug">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">
                            Gói {settings.targetLang.toUpperCase()} sẵn sàng
                          </span>
                        </div>
                      )}

                      <button
                        type="button"
                        disabled={isTranslating || isTranslatingFullEpub}
                        onClick={() => {
                          if (settings.translationMode === 'original') {
                            onUpdateSettings({ translationMode: 'override' });
                          }
                          translateCurrentChapter(settings.targetLang);
                        }}
                        className="ios-liquid-pill min-w-0 w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl ios-liquid-bar border border-white/75 dark:border-zinc-700/60 text-[11px] font-medium text-center leading-snug whitespace-normal break-words"
                      >
                        {isTranslating ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                        ) : (
                          <Languages className="w-3.5 h-3.5 shrink-0 text-amber-800 dark:text-amber-400" />
                        )}
                        <span>{isTranslating ? 'Đang dịch...' : 'Dịch lại chương'}</span>
                      </button>
                    </div>

                    {/* Full-Book AI Translate & Permanent EPUB Overwrite */}
                    <button
                      type="button"
                      disabled={isTranslatingFullEpub || isTranslating}
                      onClick={handleTranslateEntireBookAndOverwriteEpub}
                      className="ios-liquid-btn w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-[11px] font-semibold text-center leading-snug whitespace-normal break-words disabled:opacity-60"
                    >
                      {isTranslatingFullEpub ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                      ) : (
                        <FileOutput className="w-3.5 h-3.5 shrink-0" />
                      )}
                      <span>
                        {isTranslatingFullEpub
                          ? `Đang dịch & ghi đè EPUB (${fullEpubProgress?.percent ?? 0}%)...`
                          : `AI Dịch toàn bộ (${book.chapters.length} ch) → Ghi đè EPUB`}
                      </span>
                    </button>

                    {isTranslatingFullEpub && fullEpubProgress && (
                      <div className="p-2.5 rounded-xl bg-amber-50/90 dark:bg-amber-950/30 border border-amber-700/30 space-y-1.5">
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="text-amber-900 dark:text-amber-200 leading-snug break-words">
                            {fullEpubProgress.message}
                          </span>
                          <button
                            type="button"
                            onClick={() => fullTranslateAbortRef.current?.abort()}
                            className="text-[10px] font-semibold text-red-600 dark:text-red-400 underline shrink-0"
                          >
                            Hủy
                          </button>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-amber-200/70 dark:bg-amber-900/50 overflow-hidden">
                          <div
                            className="h-full bg-amber-700 dark:bg-amber-400 transition-all duration-300"
                            style={{ width: `${fullEpubProgress.percent}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {packProgressMsg && (
                      <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-snug">
                        {packProgressMsg}
                      </p>
                    )}

                    {hasOriginalBookBackup(book) && (
                      <button
                        type="button"
                        onClick={handleRestoreOriginalBookText}
                        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl border border-stone-300 dark:border-stone-700 text-[11px] text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800"
                      >
                        <RotateCcw className="w-3 h-3 shrink-0" />
                        <span>Khôi phục bản gốc trước khi ghi đè</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Reading Style */}
                <div className="space-y-1.5 pt-2 border-t border-stone-200/80 dark:border-stone-800">
                  <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-400">
                    Văn phong đọc AI
                  </label>
                  <select
                    aria-label="Chọn văn phong đọc"
                    value={readingStyle}
                    onChange={(e) =>
                      onUpdateBook({
                        ...book,
                        readingStyle: e.target.value as BookReadingStyle,
                      })
                    }
                    className="w-full min-w-0 max-w-full px-3 py-2 text-xs font-medium rounded-xl ios-liquid-bar border border-white/75 dark:border-zinc-700/60 text-stone-800 dark:text-stone-100"
                  >
                    <option value="novel" className="text-stone-900">
                      Văn phong: Tiểu thuyết
                    </option>
                    <option value="selfhelp" className="text-stone-900">
                      Văn phong: Học tập
                    </option>
                    <option value="essay" className="text-stone-900">
                      Văn phong: Tản văn
                    </option>
                    <option value="research" className="text-stone-900">
                      Văn phong: Nghiên cứu
                    </option>
                  </select>
                </div>

                {/* Utility Row: TOC, Bookmark, Export EPUB */}
                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-stone-200/80 dark:border-stone-800">
                  <button
                    type="button"
                    onClick={() => {
                      setShowToolsMenu(false);
                      setShowToc(true);
                    }}
                    className="ios-liquid-pill min-w-0 flex flex-col items-center justify-center gap-1 py-2.5 px-1.5 rounded-2xl ios-liquid-bar border border-white/75 dark:border-zinc-700/60 text-[11px] font-medium text-center leading-tight"
                  >
                    <List className="w-4 h-4 shrink-0" />
                    <span>Mục lục</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      toggleChapterBookmark();
                    }}
                    className={`ios-liquid-pill min-w-0 flex flex-col items-center justify-center gap-1 py-2.5 px-1.5 rounded-2xl border text-[11px] font-medium text-center leading-tight ${
                      isBookmarked
                        ? 'ios-liquid-pill-active border-amber-700/40 text-amber-800 dark:text-amber-300 font-semibold'
                        : 'ios-liquid-bar border-white/75 dark:border-zinc-700/60'
                    }`}
                  >
                    {isBookmarked ? (
                      <BookMarked className="w-4 h-4 text-amber-700 shrink-0" />
                    ) : (
                      <Bookmark className="w-4 h-4 shrink-0" />
                    )}
                    <span>{isBookmarked ? 'Đã lưu dấu' : 'Đánh dấu'}</span>
                  </button>

                  <button
                    type="button"
                    disabled={isExporting}
                    onClick={() => {
                      setShowToolsMenu(false);
                      handleExportCurrentEpub();
                    }}
                    className="ios-liquid-pill min-w-0 flex flex-col items-center justify-center gap-1 py-2.5 px-1.5 rounded-2xl ios-liquid-bar border border-white/75 dark:border-zinc-700/60 text-[11px] font-medium text-center leading-tight"
                  >
                    <Download className="w-4 h-4 shrink-0" />
                    <span>Xuất EPUB</span>
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Main Content + Docked Side Drawers */}
      <div className="flex-1 flex items-start relative">
        <div
          ref={scrollContainerRef}
          onClick={handleCanvasTapForPagination}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          className="flex-1 overflow-x-hidden px-4 sm:px-8 pt-6 sm:pt-9 pb-10 min-w-0 page-turn-stage"
        >
          <article
            key={
              settings.readingMode === 'paginated'
                ? `${chapterIndex}-${currentPageIndex}-${turnTick}`
                : chapterIndex
            }
            className={`mx-auto ${WIDTH_CLASSES[settings.pageWidth]} ${pageTurnClass} transition-all`}
            style={{
              fontFamily: settings.fontFamily,
              fontSize: `${settings.fontSize}px`,
              lineHeight: settings.lineHeight,
              letterSpacing: `${settings.letterSpacing}em`,
              fontWeight: settings.fontWeight,
              textAlign: settings.textAlign,
            }}
          >
            {translateError && (
              <div className="mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs font-sans">
                {translateError}
              </div>
            )}

            {translateStatusMsg && !isTranslating && !isTranslatingFullEpub && (
              <div className="mb-6 flex items-center justify-between gap-2 p-3 rounded-lg bg-emerald-600/10 border border-emerald-600/30 text-xs font-sans">
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
              <div className="mb-6 p-3 rounded-lg bg-amber-700/10 border border-amber-700/25 text-xs font-sans space-y-2">
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

            {/* Chapter Header */}
            <header className="mb-8 pb-6 border-b" style={{ borderColor: activeTheme.border }}>
              <p className="text-xs uppercase tracking-widest opacity-60 font-sans mb-2 tabular-nums">
                {book.title} · Chương {chapterIndex + 1}/{book.chapters.length} · Đoạn{' '}
                {(book.currentParagraphIndex || 0) + 1}/{currentChapter?.paragraphs.length || 1}
              </p>
              <h1 className="text-2xl sm:text-3xl font-display font-semibold leading-snug text-left">
                {currentChapter?.title}
              </h1>
            </header>

            {/* Paragraphs */}
            <div
              className={
                settings.readingMode === 'paginated' && settings.columnsInPaginated === 2
                  ? 'md:columns-2 md:gap-12'
                  : ''
              }
            >
              {visibleParagraphs.map((pair, idx) => {
                const highlight = book.highlights.find(
                  (h) => h.chapterId === currentChapter?.id && h.paragraphIndex === pair.index
                );
                const isSpoken = spokenParaIndex === pair.index;
                const isLastRead =
                  spokenParaIndex === null && book.currentParagraphIndex === pair.index && pair.index > 0;
                const useDropCap = settings.dropCap && pair.index === 0 && idx === 0;

                return (
                  <div
                    key={pair.index}
                    ref={(el) => {
                      if (el) paraRefs.current.set(pair.index, el);
                      else paraRefs.current.delete(pair.index);
                    }}
                    style={{ marginBottom: `${settings.paragraphSpacing}px` }}
                    className={`relative group rounded-lg px-2 py-1 transition-colors ${
                      isSpoken
                        ? 'ring-2 ring-amber-700/70 bg-amber-500/10'
                        : isLastRead
                        ? 'border-l-2 border-amber-700/60 pl-3'
                        : ''
                    } ${highlight ? HIGHLIGHT_CLASSES[highlight.color] : ''}`}
                  >
                    <p
                      onClick={() => {
                        syncParagraphPosition(pair.index);
                        setActiveParaAction(activeParaAction === pair.index ? null : pair.index);
                      }}
                      className={`${useDropCap ? 'editorial-dropcap' : ''} ${
                        settings.firstLineIndent && !useDropCap ? 'indent-8' : ''
                      } cursor-text`}
                    >
                      {renderIlluminatedText(pair.original, isSpoken)}
                    </p>

                    {pair.translated && (
                      <p className="mt-2 pl-4 opacity-75 italic text-[0.92em]">
                        {pair.translated}
                      </p>
                    )}

                    {activeParaAction === pair.index && (
                      <div className="mt-2 inline-flex flex-wrap items-center gap-2 p-1.5 rounded-lg bg-stone-900 text-white text-[11px] font-sans shadow-md">
                        <button
                          type="button"
                          onClick={() => {
                            syncParagraphPosition(pair.index);
                            setActiveParaAction(null);
                            handleContinueListenFromHere();
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-700 hover:bg-amber-600 text-white font-medium"
                        >
                          <Play className="w-3 h-3" />
                          <span>Nghe từ đây</span>
                        </button>
                        <span className="opacity-60">Đánh dấu:</span>
                        {(['amber', 'emerald', 'rose', 'sky'] as const).map((clr) => (
                          <button
                            key={clr}
                            type="button"
                            onClick={() => toggleHighlight(pair.index, clr)}
                            aria-label={`Tô màu ${clr}`}
                            className={`w-4 h-4 rounded-full border border-white/40 ${
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
                    )}
                  </div>
                );
              })}
            </div>

            {/* Chapter / Page Footer Navigation */}
            <footer
              style={{ borderColor: activeTheme.border }}
              className="mt-8 pt-5 border-t flex items-center justify-between gap-4 font-sans text-xs"
            >
              {settings.readingMode === 'paginated' ? (
                <>
                  <button
                    type="button"
                    disabled={currentPageIndex === 0 && chapterIndex === 0}
                    onClick={goPrevPage}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-black/15 dark:border-white/15 disabled:opacity-40 min-h-[44px]"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>Trang trước</span>
                  </button>
                  <div className="text-center space-y-0.5">
                    <div className="tabular-nums opacity-80 font-medium">
                      Trang {currentPageIndex + 1} / {pages.length}
                    </div>
                    <div className="text-[10px] opacity-60">{activeTurnLabel}</div>
                  </div>
                  <button
                    type="button"
                    disabled={
                      currentPageIndex >= pages.length - 1 &&
                      chapterIndex >= book.chapters.length - 1
                    }
                    onClick={goNextPage}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-black/15 dark:border-white/15 disabled:opacity-40 min-h-[44px]"
                  >
                    <span>Trang tiếp</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <>
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
                </>
              )}
            </footer>
          </article>
        </div>

        {/* Table of Contents & Bookmarks Sidebar (Portaled out of CSS filter container, h-auto tightly hugs chapters) */}
        {showToc &&
          typeof document !== 'undefined' &&
          createPortal(
            <div className="fixed inset-0 z-[75] flex items-end sm:items-start sm:justify-start">
              <div
                className="fixed inset-0 bg-black/45 backdrop-blur-xs"
                onClick={() => setShowToc(false)}
                aria-hidden="true"
              />
              <aside
                aria-label="Mục lục và đánh dấu trang"
                className="ios-sheet-enter sm:ios-drawer-left relative z-10 w-full sm:w-80 sm:mt-[56px] sm:ml-3 h-auto max-h-[82dvh] sm:max-h-[calc(100dvh-72px)] bg-[#FBF9F5]/98 dark:bg-[#16181C]/98 backdrop-blur-xl text-stone-900 dark:text-stone-100 border border-stone-200/80 dark:border-stone-800 rounded-t-[28px] sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden"
              >
                <div className="sm:hidden flex justify-center pt-2 pb-1 shrink-0">
                  <span className="w-10 h-1 rounded-full bg-stone-300 dark:bg-stone-700" />
                </div>
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-200 dark:border-stone-800 shrink-0">
                  <h2 className="text-base font-display font-semibold">Mục lục &amp; Đánh dấu</h2>
                  <button
                    type="button"
                    onClick={() => setShowToc(false)}
                    aria-label="Đóng mục lục"
                    className="p-2 rounded-md text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
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
                        className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors ${
                          idx === chapterIndex
                            ? 'bg-amber-800 text-white font-medium'
                            : 'hover:bg-stone-200/60 dark:hover:bg-stone-800'
                        }`}
                      >
                        {ch.title}
                      </button>
                    ))}
                  </div>

                  {book.bookmarks.length > 0 && (
                    <div className="space-y-1.5 pt-3 border-t border-stone-200 dark:border-stone-800">
                      <h3 className="px-2 text-[11px] uppercase tracking-wider text-stone-500 font-semibold">
                        Trang đã đánh dấu ({book.bookmarks.length})
                      </h3>
                      {book.bookmarks.map((bm) => (
                        <button
                          key={bm.id}
                          type="button"
                          onClick={() => {
                            const idx = book.chapters.findIndex((c) => c.id === bm.chapterId);
                            if (idx >= 0) goToChapter(idx);
                          }}
                          className="w-full text-left p-2.5 rounded-lg border border-stone-200 dark:border-stone-800 hover:bg-stone-100 dark:hover:bg-stone-800"
                        >
                          <div className="font-medium">{bm.chapterTitle}</div>
                          <div className="text-[11px] text-stone-500 line-clamp-2 mt-0.5">
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
          settings={settings}
          onUpdateSettings={onUpdateSettings}
          customFonts={customFonts}
          onAddCustomFont={onAddCustomFont}
        />

        {/* AI Audiobook & Character Voice Dubbing Drawer + Inline Mini-Bar */}
        {currentChapter && (
          <AudiobookStudioDrawer
            isOpen={showAudio}
            onClose={() => setShowAudio(false)}
            onOpenPanel={() => {
              setShowSettings(false);
              setShowAmbient(false);
              setShowAudio(true);
            }}
            isReaderActive={isReaderActive}
            book={book}
            chapter={currentChapter}
            hasNextChapter={chapterIndex < book.chapters.length - 1}
            displayedParagraphs={
              settings.translationMode !== 'original'
                ? renderedParagraphs.map((p) => p.original)
                : undefined
            }
            autoPlaySignal={autoPlaySignal}
            onSaveChapterAnalysis={handleSaveAnalysis}
            onUpdateVoiceAssignment={handleUpdateVoiceAssignment}
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
            onPlaybackStateChange={onAudioPlayingChange}
            defaultVoice={basicSettings.defaultVoice}
            standaloneDeviceMode={basicSettings.standaloneDeviceMode !== false}
            onNextChapter={() => {
              if (chapterIndex < book.chapters.length - 1) goToChapter(chapterIndex + 1);
            }}
          />
        )}

        {/* Ambient Sound & Chill Music Drawer */}
        <AmbientSoundDrawer
          isOpen={showAmbient}
          onClose={() => setShowAmbient(false)}
          customTracks={customAmbientTracks}
          onAddCustomTrack={onAddCustomAmbientTrack}
          onDeleteCustomTrack={onDeleteCustomAmbientTrack}
        />
      </div>
    </div>
  );
};
