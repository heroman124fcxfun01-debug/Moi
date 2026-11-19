import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Download,
  Globe,
  Loader2,
  Maximize2,
  Mic2,
  Moon,
  Pause,
  Play,
  Plus,
  Settings,
  Sun,
} from 'lucide-react';
import type {
  AppBasicSettings,
  Book,
  CustomAmbientTrack,
  CustomFontAsset,
  ExternalVoiceAsset,
  ReaderSettings,
  ReadingLogEntry,
  UserCollection,
} from './types/book';
import {
  DEFAULT_APP_BASIC_SETTINGS,
  DEFAULT_READER_SETTINGS,
  loadAppBasicSettings,
  loadBooks,
  loadCustomAmbientTracks,
  loadCustomFonts,
  loadExternalVoices,
  loadReaderSettings,
  loadReadingLogs,
  loadUserCollections,
  removeBook,
  removeCustomAmbientTrack,
  removeCustomFont,
  removeExternalVoice,
  restoreSampleBooks,
  saveAllBooks,
  saveAppBasicSettings,
  saveBook,
  saveCustomAmbientTrack,
  saveCustomFont,
  saveExternalVoice,
  saveReaderSettings,
  saveReadingLogs,
  saveUserCollections,
} from './utils/storage';
import { addReadingSecondsToLogs, formatIsoDateLocal } from './utils/syncAndStats';
import { LibraryView } from './components/LibraryView';
import { ReaderView } from './components/ReaderView';
import { WebScraperView } from './components/WebScraperView';
import { VoiceStudioView } from './components/VoiceStudioView';
import { SettingsSyncView } from './components/SettingsSyncView';
import { ImportBookModal } from './components/ImportBookModal';
import { OfflineIndicator } from './components/PWAInstallUI';
import { FloatingBookDisc } from './components/FloatingBookDisc';
import { useWebCrawler } from './hooks/useWebCrawler';

type AppTab = 'library' | 'reader' | 'web' | 'studio' | 'settings';

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('library');
  const [books, setBooks] = useState<Book[]>([]);
  const [userCollections, setUserCollections] = useState<UserCollection[]>([]);
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [openAudioOnRead, setOpenAudioOnRead] = useState(false);

  const [customFonts, setCustomFonts] = useState<CustomFontAsset[]>([]);
  const [externalVoices, setExternalVoices] = useState<ExternalVoiceAsset[]>([]);
  const [customAmbientTracks, setCustomAmbientTracks] = useState<CustomAmbientTrack[]>([]);
  const [readingLogs, setReadingLogs] = useState<ReadingLogEntry[]>([]);
  const [readerSettings, setReaderSettings] = useState<ReaderSettings>(
    DEFAULT_READER_SETTINGS
  );
  const [basicSettings, setBasicSettings] = useState<AppBasicSettings>(
    DEFAULT_APP_BASIC_SETTINGS
  );
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isReaderAudioPlaying, setIsReaderAudioPlaying] = useState(false);
  const [discToggleSignal, setDiscToggleSignal] = useState(0);

  useEffect(() => {
    const boot = async () => {
      const [
        loadedBooks,
        loadedFonts,
        loadedVoices,
        loadedLogs,
        loadedCols,
        loadedAmbient,
      ] = await Promise.all([
        loadBooks(),
        loadCustomFonts(),
        loadExternalVoices(),
        loadReadingLogs(),
        loadUserCollections(),
        loadCustomAmbientTracks(),
      ]);
      const savedReader = loadReaderSettings();
      const savedBasic = loadAppBasicSettings();

      setBooks(loadedBooks);
      setUserCollections(loadedCols);
      if (loadedBooks.length > 0) setActiveBookId(loadedBooks[0].id);
      setCustomFonts(loadedFonts);
      setExternalVoices(loadedVoices);
      setCustomAmbientTracks(loadedAmbient);
      setReadingLogs(loadedLogs);
      setReaderSettings(savedReader);
      setBasicSettings(savedBasic);

      if (savedBasic.autoResumeLastBook && loadedBooks.length > 0) {
        setActiveTab('reader');
      }
      setIsLoaded(true);
    };
    boot();
  }, []);

  // Apply light / dark / AMOLED theme classes
  useEffect(() => {
    const root = document.documentElement;
    if (basicSettings.uiTheme === 'amoled') {
      root.classList.add('dark', 'amoled');
    } else if (basicSettings.uiTheme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('amoled');
    } else {
      root.classList.remove('dark', 'amoled');
    }
  }, [basicSettings.uiTheme]);

  // Keep screen awake via Wake Lock API during reading if enabled
  useEffect(() => {
    if (activeTab !== 'reader' || !basicSettings.keepScreenAwake) return;
    let wakeLock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
    };
    if (nav.wakeLock) {
      nav.wakeLock
        .request('screen')
        .then((sentinel) => {
          wakeLock = sentinel;
        })
        .catch(() => {});
    }
    return () => {
      wakeLock?.release().catch(() => {});
    };
  }, [activeTab, basicSettings.keepScreenAwake]);

  const activeBook = books.find((b) => b.id === activeBookId) || books[0] || null;

  const handleOpenBook = (bookId: string, openAudioStudio = false) => {
    setActiveBookId(bookId);
    setOpenAudioOnRead(openAudioStudio);
    setDiscToggleSignal(0);
    setActiveTab('reader');
  };

  useEffect(() => {
    if (activeTab !== 'reader') {
      setIsReaderAudioPlaying(false);
    }
  }, [activeTab]);

  const handleUpdateBook = async (updated: Book) => {
    setBooks((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
    await saveBook(updated);
  };

  const handleAddBook = async (newBook: Book, openImmediately = true) => {
    setBooks((prev) => [newBook, ...prev]);
    await saveBook(newBook);
    if (openImmediately) {
      setActiveBookId(newBook.id);
      setOpenAudioOnRead(false);
      setActiveTab('reader');
    }
  };

  const handleUpdateCollections = (nextCollections: UserCollection[]) => {
    setUserCollections(nextCollections);
    saveUserCollections(nextCollections);
  };

  const handleDeleteBook = async (bookId: string) => {
    setBooks((prev) => prev.filter((b) => b.id !== bookId));
    await removeBook(bookId);
    setUserCollections((prev) => {
      const pruned = prev.map((c) => ({
        ...c,
        bookIds: c.bookIds.filter((id) => id !== bookId),
      }));
      saveUserCollections(pruned);
      return pruned;
    });
    if (activeBookId === bookId) {
      setActiveBookId(null);
    }
  };

  const handleRestoreSamples = async () => {
    const restored = await restoreSampleBooks();
    setBooks(restored);
    if (restored.length > 0) setActiveBookId(restored[0].id);
  };

  const crawler = useWebCrawler(handleAddBook);

  const handleUpdateSettings = (patch: Partial<ReaderSettings>) => {
    setReaderSettings((prev) => {
      const next = { ...prev, ...patch };
      saveReaderSettings(next);
      return next;
    });
  };

  const handleUpdateBasicSettings = (patch: Partial<AppBasicSettings>) => {
    setBasicSettings((prev) => {
      const next = { ...prev, ...patch };
      saveAppBasicSettings(next);
      return next;
    });
  };

  const handleCycleUiTheme = () => {
    const nextTheme =
      basicSettings.uiTheme === 'light'
        ? 'dark'
        : basicSettings.uiTheme === 'dark'
        ? 'amoled'
        : 'light';
    handleUpdateBasicSettings({ uiTheme: nextTheme });
  };

  const handleLogReadingTime = useCallback((seconds: number, bookId: string) => {
    const today = formatIsoDateLocal(new Date());
    setReadingLogs((prev) => {
      const next = addReadingSecondsToLogs(prev, today, seconds, bookId);
      saveReadingLogs(next);
      return next;
    });
  }, []);

  const handleApplySyncedLibrary = async (
    mergedBooks: Book[],
    mergedLogs: ReadingLogEntry[]
  ) => {
    setBooks(mergedBooks);
    setReadingLogs(mergedLogs);
    await saveAllBooks(mergedBooks);
    await saveReadingLogs(mergedLogs);
    if (mergedBooks.length > 0 && !activeBookId) {
      setActiveBookId(mergedBooks[0].id);
    }
  };

  const handleAddCustomFont = async (font: CustomFontAsset) => {
    await saveCustomFont(font);
    setCustomFonts((prev) => [font, ...prev]);
  };

  const handleDeleteCustomFont = async (fontId: string) => {
    await removeCustomFont(fontId);
    setCustomFonts((prev) => prev.filter((f) => f.id !== fontId));
  };

  const handleAddExternalVoice = async (voice: ExternalVoiceAsset) => {
    await saveExternalVoice(voice);
    setExternalVoices((prev) => {
      const exists = prev.some((v) => v.id === voice.id);
      return exists ? prev.map((v) => (v.id === voice.id ? voice : v)) : [voice, ...prev];
    });
  };

  const handleDeleteExternalVoice = async (voiceId: string) => {
    await removeExternalVoice(voiceId);
    setExternalVoices((prev) => prev.filter((v) => v.id !== voiceId));
  };

  const handleAddCustomAmbientTrack = async (track: CustomAmbientTrack) => {
    await saveCustomAmbientTrack(track);
    setCustomAmbientTracks((prev) => [track, ...prev]);
  };

  const handleDeleteCustomAmbientTrack = async (trackId: string) => {
    await removeCustomAmbientTrack(trackId);
    setCustomAmbientTracks((prev) => prev.filter((t) => t.id !== trackId));
  };

  const isDarkOrAmoled = basicSettings.uiTheme !== 'light';

  return (
    <div
      className={`min-h-screen transition-colors ${
        basicSettings.uiTheme === 'amoled'
          ? 'bg-black text-zinc-100'
          : 'bg-[#F7F4EE] dark:bg-[#121316] text-stone-900 dark:text-stone-100'
      } ${activeTab !== 'reader' ? 'pb-28' : ''}`}
    >
      {/* Strict 3-Zone Top Navigation Bar */}
      <header
        className={`sticky top-0 z-40 backdrop-blur-xs border-b ${
          basicSettings.uiTheme === 'amoled'
            ? 'bg-black/95 border-zinc-800'
            : 'bg-[#F7F4EE]/95 dark:bg-[#121316]/95 border-stone-200 dark:border-stone-800'
        }`}
      >
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-[56px] flex items-center justify-between gap-3 sm:gap-6">
          {/* Zone 1: Single-line Brand Wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('library')}
            className="text-lg sm:text-xl font-display font-bold tracking-tight text-stone-900 dark:text-stone-100 whitespace-nowrap shrink-0"
          >
            LaziRead
          </button>

          {/* Zone 2: Liquid-Glass Rounded Desktop Navigation Pills */}
          <nav
            aria-label="Điều hướng chính"
            className="hidden md:flex items-center gap-1 p-1 rounded-full ios-liquid-bar border border-white/75 dark:border-zinc-700/60 text-xs font-medium min-w-0"
          >
            <button
              type="button"
              onClick={() => setActiveTab('library')}
              className={`ios-liquid-pill px-3.5 py-1.5 rounded-full whitespace-nowrap shrink-0 ${
                activeTab === 'library'
                  ? 'ios-liquid-pill-active text-amber-800 dark:text-amber-300 font-semibold'
                  : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white hover:bg-white/45 dark:hover:bg-white/10'
              }`}
            >
              Thư viện
            </button>
            <button
              type="button"
              onClick={() => {
                if (activeBook) setActiveTab('reader');
              }}
              disabled={!activeBook}
              className={`ios-liquid-pill px-3.5 py-1.5 rounded-full whitespace-nowrap shrink-0 disabled:opacity-40 ${
                activeTab === 'reader'
                  ? 'ios-liquid-pill-active text-amber-800 dark:text-amber-300 font-semibold'
                  : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white hover:bg-white/45 dark:hover:bg-white/10'
              }`}
            >
              Trình đọc
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('web')}
              className={`ios-liquid-pill px-3.5 py-1.5 rounded-full whitespace-nowrap shrink-0 ${
                activeTab === 'web'
                  ? 'ios-liquid-pill-active text-amber-800 dark:text-amber-300 font-semibold'
                  : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white hover:bg-white/45 dark:hover:bg-white/10'
              }`}
            >
              Cộng đồng
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('studio')}
              className={`ios-liquid-pill px-3.5 py-1.5 rounded-full whitespace-nowrap shrink-0 ${
                activeTab === 'studio'
                  ? 'ios-liquid-pill-active text-amber-800 dark:text-amber-300 font-semibold'
                  : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white hover:bg-white/45 dark:hover:bg-white/10'
              }`}
            >
              Studio Giọng
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className={`ios-liquid-pill px-3.5 py-1.5 rounded-full whitespace-nowrap shrink-0 ${
                activeTab === 'settings'
                  ? 'ios-liquid-pill-active text-amber-800 dark:text-amber-300 font-semibold'
                  : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white hover:bg-white/45 dark:hover:bg-white/10'
              }`}
            >
              Cài đặt & Đồng bộ
            </button>
          </nav>

          {/* Zone 3: Theme Switcher + Single Primary Action */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCycleUiTheme}
              aria-label={
                isDarkOrAmoled ? 'Đổi giao diện Sáng / AMOLED' : 'Chuyển giao diện tối'
              }
              title={`Giao diện: ${basicSettings.uiTheme.toUpperCase()}`}
              className="ios-liquid-pill w-9 h-9 rounded-full ios-liquid-bar border border-white/75 dark:border-zinc-700/60 flex items-center justify-center text-stone-700 dark:text-stone-300 hover:text-amber-800 dark:hover:text-amber-300"
            >
              {isDarkOrAmoled ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => setIsImportOpen(true)}
              className="ios-liquid-btn inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-xs font-semibold hover:opacity-95 whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Thêm sách</span>
            </button>
          </div>
        </div>
      </header>

      {!isLoaded ? (
        <div className="max-w-7xl mx-auto px-6 py-16 text-xs text-stone-500">
          Đang tải tủ sách LaziRead...
        </div>
      ) : (
        <div
          key={activeTab}
          className={activeTab === 'reader' ? 'ios-reader-enter' : 'ios-view-enter'}
        >
          {activeTab === 'library' && (
            <LibraryView
              books={books}
              collections={userCollections}
              readingLogs={readingLogs}
              onOpenBook={handleOpenBook}
              onUpdateBook={handleUpdateBook}
              onDeleteBook={handleDeleteBook}
              onUpdateCollections={handleUpdateCollections}
              onOpenImportModal={() => setIsImportOpen(true)}
              onGoToWebScraper={() => setActiveTab('web')}
              onRestoreSamples={handleRestoreSamples}
            />
          )}

          {activeTab === 'reader' && activeBook && (
            <ReaderView
              book={activeBook}
              initialOpenAudio={openAudioOnRead}
              basicSettings={basicSettings}
              onBackToLibrary={() => setActiveTab('library')}
              onUpdateBook={handleUpdateBook}
              onLogReadingTime={handleLogReadingTime}
              settings={readerSettings}
              onUpdateSettings={handleUpdateSettings}
              customFonts={customFonts}
              onAddCustomFont={handleAddCustomFont}
              externalVoices={externalVoices}
              onAddExternalVoice={handleAddExternalVoice}
              customAmbientTracks={customAmbientTracks}
              onAddCustomAmbientTrack={handleAddCustomAmbientTrack}
              onDeleteCustomAmbientTrack={handleDeleteCustomAmbientTrack}
              onAudioPlayingChange={setIsReaderAudioPlaying}
              audioDrawerToggleSignal={discToggleSignal}
            />
          )}

          {activeTab === 'web' && <WebScraperView crawler={crawler} />}

          {activeTab === 'studio' && (
            <VoiceStudioView
              customFonts={customFonts}
              onAddCustomFont={handleAddCustomFont}
              onDeleteCustomFont={handleDeleteCustomFont}
              externalVoices={externalVoices}
              onAddExternalVoice={handleAddExternalVoice}
              onDeleteExternalVoice={handleDeleteExternalVoice}
              customAmbientTracks={customAmbientTracks}
              onAddCustomAmbientTrack={handleAddCustomAmbientTrack}
              onDeleteCustomAmbientTrack={handleDeleteCustomAmbientTrack}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsSyncView
              books={books}
              readingLogs={readingLogs}
              basicSettings={basicSettings}
              onUpdateBasicSettings={handleUpdateBasicSettings}
              onApplySyncedLibrary={handleApplySyncedLibrary}
            />
          )}
        </div>
      )}

      {/* iPhone-Style Floating Raised Glass Bottom Dock */}
      {activeTab !== 'reader' && (
        <nav
          aria-label="Thanh điều hướng nổi iPhone"
          className={`fixed bottom-3 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-1.5rem)] max-w-[368px] sm:w-auto sm:max-w-none ios-glass-dock rounded-[24px] p-1 border grid grid-cols-4 sm:flex sm:items-center sm:justify-center gap-1 sm:gap-1.5 ${
            basicSettings.uiTheme === 'amoled'
              ? 'border-zinc-800/90'
              : 'border-white/75 dark:border-zinc-700/60'
          }`}
        >
          {(
            [
              { id: 'library', label: 'Thư viện', icon: BookOpen },
              { id: 'web', label: 'Cộng đồng', icon: Globe },
              { id: 'studio', label: 'Studio Giọng', icon: Mic2 },
              { id: 'settings', label: 'Cài đặt', icon: Settings },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`ios-dock-pill min-w-0 flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 px-1 sm:px-3.5 py-1.5 sm:py-2 rounded-[20px] min-h-[42px] sm:min-h-[38px] ${
                  active
                    ? 'ios-dock-pill-active bg-white dark:bg-zinc-800 text-amber-800 dark:text-amber-400 font-semibold border border-amber-700/20 dark:border-amber-500/30'
                    : 'bg-white/55 dark:bg-white/[0.06] text-stone-600 dark:text-stone-300 border border-white/60 dark:border-white/[0.08] hover:bg-white/85 dark:hover:bg-white/10'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="text-[9.5px] sm:text-xs leading-tight tracking-tight truncate max-w-full">
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>
      )}

      {/* LaziBook-Style Spinning Vinyl Book Disc (Bottom Right) */}
      <FloatingBookDisc
        book={activeBook}
        isAudioPlaying={isReaderAudioPlaying}
        isReaderOpen={activeTab === 'reader'}
        onClickDisc={() => {
          if (!activeBook) return;
          if (activeTab !== 'reader') {
            handleOpenBook(activeBook.id, isReaderAudioPlaying);
          } else {
            setDiscToggleSignal((s) => s + 1);
          }
        }}
      />

      {/* Persistent Floating Background Web Crawler Pill when navigating away from Cộng đồng */}
      {activeTab !== 'web' &&
        (crawler.crawlStatus === 'running' ||
          crawler.crawlStatus === 'paused' ||
          crawler.crawlStatus === 'issue' ||
          crawler.crawlStatus === 'completed') && (
          <div
            role="status"
            aria-label="Trình quét web chạy ngầm"
            className="ios-sheet-enter fixed bottom-40 md:bottom-24 right-3 md:right-5 z-40 max-w-sm w-[calc(100%-1.5rem)] rounded-2xl border border-amber-800/40 bg-[#FBF9F5]/95 dark:bg-[#191B1F]/95 backdrop-blur-xl shadow-xl p-3.5 text-xs space-y-2"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0 font-semibold text-stone-900 dark:text-stone-100">
                {crawler.crawlStatus === 'running' ? (
                  <Loader2 className="w-4 h-4 text-amber-800 animate-spin shrink-0" />
                ) : crawler.crawlStatus === 'issue' ? (
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                ) : (
                  <Globe className="w-4 h-4 text-amber-800 dark:text-amber-400 shrink-0" />
                )}
                <span className="truncate">
                  {crawler.crawlStatus === 'running'
                    ? `Đang quét ngầm (${crawler.scrapedList.length} ch)`
                    : crawler.crawlStatus === 'issue'
                    ? 'Cần kiểm tra trang Web!'
                    : crawler.crawlStatus === 'completed'
                    ? `Hoàn tất (${crawler.scrapedList.length} ch)`
                    : `Tạm dừng (${crawler.scrapedList.length} ch)`}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    crawler.setIsMinimized(false);
                    setActiveTab('web');
                  }}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-stone-200/80 dark:bg-stone-800 text-[11px] font-medium hover:opacity-90 shrink-0"
                >
                  <Maximize2 className="w-3 h-3" />
                  <span>Mở</span>
                </button>
                {crawler.crawlStatus !== 'running' && (
                  <button
                    type="button"
                    onClick={crawler.stopAndResetStatus}
                    aria-label="Ẩn thông báo trình quét web"
                    className="px-2 py-1 rounded-md text-[11px] text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            <p className="text-[11px] text-stone-600 dark:text-stone-400 line-clamp-1">
              {crawler.crawlStatus === 'issue'
                ? crawler.issueMessage
                : crawler.statusMessage || crawler.currentPage?.title}
            </p>

            <div className="flex items-center gap-2">
              {(crawler.crawlStatus === 'running' || crawler.crawlStatus === 'paused') && (
                <button
                  type="button"
                  onClick={crawler.togglePause}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-800 text-white text-[11px] font-medium"
                >
                  {crawler.crawlStatus === 'running' ? (
                    <>
                      <Pause className="w-3 h-3" />
                      <span>Tạm dừng</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3 h-3" />
                      <span>Tiếp tục</span>
                    </>
                  )}
                </button>
              )}
              {crawler.scrapedList.length > 0 && (
                <button
                  type="button"
                  onClick={() => crawler.exportScrapedEpub()}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-stone-300 dark:border-stone-700 text-[11px] font-medium"
                >
                  <Download className="w-3 h-3" />
                  <span>Xuất EPUB</span>
                </button>
              )}
            </div>
          </div>
        )}

      <OfflineIndicator />

      <ImportBookModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onImportBook={handleAddBook}
        defaultReadingStyle={basicSettings.defaultReadingStyle}
      />
    </div>
  );
}
