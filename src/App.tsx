import { useCallback, useEffect, useRef, useState } from 'react';
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
  Search,
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
  loadAppWallpaperDataUrl,
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
  saveAppWallpaperDataUrl,
  saveBook,
  saveCustomAmbientTrack,
  saveCustomFont,
  saveExternalVoice,
  saveReaderSettings,
  saveReadingLogs,
  saveUserCollections,
} from './utils/storage';
import {
  resolveActiveWallpaperUrl,
  resolveAppThemeVars,
  shouldRenderAppWallpaper,
} from './utils/appAppearance';
import { requestPersistentDeviceStorage } from './utils/deviceHardware';
import { addReadingSecondsToLogs, formatIsoDateLocal } from './utils/syncAndStats';
import { LibraryView } from './components/LibraryView';
import { ReaderView } from './components/ReaderView';
import { WebScraperView } from './components/WebScraperView';
import { VoiceStudioView } from './components/VoiceStudioView';
import { SettingsSyncView } from './components/SettingsSyncView';
import { ImportBookModal } from './components/ImportBookModal';
import { GlobalSearchModal } from './components/GlobalSearchModal';
import { OfflineIndicator } from './components/PWAInstallUI';
import { FloatingBookDisc } from './components/FloatingBookDisc';
import { LiquidDropThumb, useLiquidDropIndicator } from './components/LiquidGlassBar';
import { useWebCrawler } from './hooks/useWebCrawler';
import type { GlobalSearchAction } from './utils/globalSearch';
import {
  getDriveAccessToken,
  getDriveAuthSnapshot,
  initDriveAuth,
  subscribeDriveAuth,
  type DriveAuthSnapshot,
} from './utils/googleDriveAuth';
import { uploadProgressManifestToDrive } from './utils/googleDriveSync';

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
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);
  const [focusCollectionSignal, setFocusCollectionSignal] = useState<{
    name: string;
    tick: number;
  } | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isReaderAudioPlaying, setIsReaderAudioPlaying] = useState(false);
  const [discToggleSignal, setDiscToggleSignal] = useState(0);
  const [driveAuth, setDriveAuth] = useState<DriveAuthSnapshot>(() => getDriveAuthSnapshot());
  const [lastAutoSyncAt, setLastAutoSyncAt] = useState<number | null>(null);
  const [isAutoSyncing, setIsAutoSyncing] = useState(false);
  const [customWallpaperDataUrl, setCustomWallpaperDataUrl] = useState<string | null>(null);

  useEffect(() => {
    const boot = async () => {
      const [
        loadedBooks,
        loadedFonts,
        loadedVoices,
        loadedLogs,
        loadedCols,
        loadedAmbient,
        loadedWallpaper,
      ] = await Promise.all([
        loadBooks(),
        loadCustomFonts(),
        loadExternalVoices(),
        loadReadingLogs(),
        loadUserCollections(),
        loadCustomAmbientTracks(),
        loadAppWallpaperDataUrl(),
      ]);
      const savedReader = loadReaderSettings();
      const savedBasic = loadAppBasicSettings();

      setBooks(loadedBooks);
      setUserCollections(loadedCols);
      if (loadedBooks.length > 0) setActiveBookId(loadedBooks[0].id);
      setCustomFonts(loadedFonts);
      setExternalVoices(loadedVoices);
      setCustomAmbientTracks(loadedAmbient);
      setCustomWallpaperDataUrl(loadedWallpaper);
      setReadingLogs(loadedLogs);
      setReaderSettings(savedReader);
      setBasicSettings(savedBasic);

      // Protect offline phone storage from OS eviction
      requestPersistentDeviceStorage().catch(() => {});

      if (savedBasic.autoResumeLastBook && loadedBooks.length > 0) {
        setActiveTab('reader');
      }
      setIsLoaded(true);
    };
    boot();
  }, []);

  // Initialize Firebase Auth for personal Google Drive sync
  useEffect(() => {
    const unsubInit = initDriveAuth();
    const unsubSnap = subscribeDriveAuth((snap) => setDriveAuth(snap));
    return () => {
      unsubSnap();
      if (typeof unsubInit === 'function') unsubInit();
    };
  }, []);

  // Debounced background auto-sync to Google Drive (`sáchlazy`) when enabled & signed in
  useEffect(() => {
    if (!isLoaded || !basicSettings.autoSyncGoogleDrive || !driveAuth.isConnected) return;
    const token = getDriveAccessToken();
    if (!token) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        setIsAutoSyncing(true);
        await uploadProgressManifestToDrive(token, books, readingLogs);
        if (!cancelled) {
          setLastAutoSyncAt(Date.now());
        }
      } catch {
        // Silent background retry on next change
      } finally {
        if (!cancelled) setIsAutoSyncing(false);
      }
    }, 4000);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isLoaded, basicSettings.autoSyncGoogleDrive, driveAuth.isConnected, books, readingLogs]);

  // Global keyboard shortcut (Ctrl+K / Cmd+K) to open universal in-app search
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsGlobalSearchOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleGlobalSearchAction = (action: GlobalSearchAction) => {
    if (action.type === 'open_book') {
      handleOpenBook(action.bookId, Boolean(action.openAudio));
      return;
    }
    if (action.type === 'open_import') {
      setIsImportOpen(true);
      return;
    }
    if (action.type === 'open_collection') {
      setActiveTab('library');
      setFocusCollectionSignal({ name: action.collectionName, tick: Date.now() });
      return;
    }
    if (action.type === 'navigate') {
      setActiveTab(action.tab);
      if (action.sectionId) {
        const targetId = action.sectionId;
        window.setTimeout(() => {
          const el = document.getElementById(targetId);
          el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 120);
      }
    }
  };

  // Apply light / dark / AMOLED theme classes + dynamic UI accent color CSS vars
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

    const themeVars = resolveAppThemeVars(
      basicSettings.uiAccent || 'amber',
      basicSettings.uiCustomAccentHex || '#0369A1'
    );
    root.style.setProperty('--app-accent', themeVars.accentLight);
    root.style.setProperty('--app-accent-dark', themeVars.accentDark);
    root.style.setProperty('--app-accent-rgb', themeVars.accentRgb);
    root.style.setProperty('--app-bg-light', themeVars.bgLight);
    root.style.setProperty('--app-bg-dark', themeVars.bgDark);
    if (themeVars.isCustomOrAlternate) {
      root.setAttribute('data-app-accent-custom', 'true');
    } else {
      root.removeAttribute('data-app-accent-custom');
    }
  }, [basicSettings.uiTheme, basicSettings.uiAccent, basicSettings.uiCustomAccentHex]);

  // Keep screen awake via Wake Lock API during reading if enabled (re-acquires on visibilitychange)
  useEffect(() => {
    if (activeTab !== 'reader' || !basicSettings.keepScreenAwake) return;
    let wakeLock: { release: () => Promise<void> } | null = null;
    let disposed = false;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
    };
    const acquire = () => {
      if (disposed || !nav.wakeLock || document.visibilityState !== 'visible') return;
      nav.wakeLock
        .request('screen')
        .then((sentinel) => {
          if (disposed) {
            sentinel.release().catch(() => {});
          } else {
            wakeLock = sentinel;
          }
        })
        .catch(() => {});
    };
    acquire();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') acquire();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
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
    mergedLogs: ReadingLogEntry[],
    mergedCollections?: UserCollection[]
  ) => {
    setBooks(mergedBooks);
    setReadingLogs(mergedLogs);
    await saveAllBooks(mergedBooks);
    await saveReadingLogs(mergedLogs);
    if (mergedCollections) {
      setUserCollections(mergedCollections);
      await saveUserCollections(mergedCollections);
    }
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

  const handleUpdateCustomWallpaper = async (dataUrl: string | null) => {
    setCustomWallpaperDataUrl(dataUrl);
    await saveAppWallpaperDataUrl(dataUrl);
  };

  const desktopNavRef = useRef<HTMLElement>(null);
  const mobileDockRef = useRef<HTMLElement>(null);
  const navActiveKey = activeTab === 'reader' ? 'library' : activeTab;
  const { thumb: desktopNavThumb, isGliding: desktopNavGliding } = useLiquidDropIndicator(
    navActiveKey,
    desktopNavRef
  );
  const { thumb: dockThumb, isGliding: dockGliding } = useLiquidDropIndicator(
    navActiveKey,
    mobileDockRef
  );

  const isDarkOrAmoled = basicSettings.uiTheme !== 'light';
  const activeWallpaperUrl = resolveActiveWallpaperUrl(
    basicSettings.uiWallpaperPreset,
    customWallpaperDataUrl
  );
  // STRICT RULE: Wallpaper NEVER renders while reading (activeTab === 'reader')
  const showAppWallpaper = shouldRenderAppWallpaper(activeTab, activeWallpaperUrl);
  const wallpaperBlurPx = Math.max(0, Math.min(20, basicSettings.uiWallpaperBlur ?? 3));
  const wallpaperOverlayAlpha = Math.max(
    0.05,
    Math.min(0.85, (basicSettings.uiWallpaperOverlay ?? 28) / 100)
  );
  const isStandaloneDeviceMode = basicSettings.standaloneDeviceMode !== false;

  return (
    <div
      className={`relative min-h-screen transition-colors ${
        showAppWallpaper
          ? 'app-wallpaper-active text-stone-900 dark:text-stone-100'
          : basicSettings.uiTheme === 'amoled'
          ? 'bg-black text-zinc-100'
          : 'bg-[var(--app-bg-light)] dark:bg-[var(--app-bg-dark)] text-stone-900 dark:text-stone-100'
      } ${activeTab !== 'reader' ? 'pb-20' : ''}`}
    >
      {/* Non-Reader App Wallpaper Layer (strictly unmounted in Reader mode) */}
      {showAppWallpaper && activeWallpaperUrl && (
        <div
          data-testid="app-wallpaper-layer"
          aria-hidden="true"
          className="fixed inset-0 z-0 pointer-events-none overflow-hidden"
        >
          <img
            src={activeWallpaperUrl}
            alt=""
            style={{
              filter: wallpaperBlurPx > 0 ? `blur(${wallpaperBlurPx}px)` : undefined,
              transform: wallpaperBlurPx > 0 ? 'scale(1.1)' : 'scale(1.06)',
            }}
            className="w-full h-full object-cover transition-all duration-300"
          />
          <div
            style={{
              backgroundColor:
                basicSettings.uiTheme === 'amoled'
                  ? `rgba(0, 0, 0, ${wallpaperOverlayAlpha})`
                  : isDarkOrAmoled
                  ? `rgba(14, 16, 20, ${wallpaperOverlayAlpha})`
                  : `rgba(248, 246, 241, ${wallpaperOverlayAlpha})`,
            }}
            className="absolute inset-0 transition-colors duration-300"
          />
        </div>
      )}

      {/* Strict 3-Zone Top Navigation Bar (hidden in distraction-free Reader mode) */}
      {activeTab !== 'reader' && (
      <header
        className={`sticky top-0 z-40 backdrop-blur-md border-b ${
          showAppWallpaper
            ? 'bg-white/70 dark:bg-zinc-950/75 border-stone-200/70 dark:border-stone-800/70'
            : basicSettings.uiTheme === 'amoled'
            ? 'bg-black/95 border-zinc-800'
            : 'bg-[var(--app-bg-light)]/95 dark:bg-[var(--app-bg-dark)]/95 border-stone-200 dark:border-stone-800'
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

          {/* Zone 2: Liquid-Glass Sliding Water-Drop Desktop Navigation */}
          <nav
            ref={desktopNavRef}
            aria-label="Điều hướng chính"
            className="relative hidden md:flex items-center gap-1 p-1 rounded-full ios-liquid-bar border border-white/75 dark:border-zinc-700/60 text-xs font-medium min-w-0"
          >
            <LiquidDropThumb
              thumb={desktopNavThumb}
              isGliding={desktopNavGliding}
              roundedClass="rounded-full"
            />
            <button
              type="button"
              data-liquid-key="library"
              onClick={() => setActiveTab('library')}
              className={`relative z-10 ios-liquid-pill px-3.5 py-1.5 rounded-full whitespace-nowrap shrink-0 ${
                activeTab === 'library'
                  ? 'text-amber-800 dark:text-amber-300 font-semibold'
                  : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white'
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
              className="relative z-10 ios-liquid-pill px-3.5 py-1.5 rounded-full whitespace-nowrap shrink-0 disabled:opacity-40 text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white"
            >
              Trình đọc
            </button>
            <button
              type="button"
              data-liquid-key="web"
              onClick={() => setActiveTab('web')}
              className={`relative z-10 ios-liquid-pill px-3.5 py-1.5 rounded-full whitespace-nowrap shrink-0 ${
                activeTab === 'web'
                  ? 'text-amber-800 dark:text-amber-300 font-semibold'
                  : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              Cộng đồng
            </button>
            <button
              type="button"
              data-liquid-key="studio"
              onClick={() => setActiveTab('studio')}
              className={`relative z-10 ios-liquid-pill px-3.5 py-1.5 rounded-full whitespace-nowrap shrink-0 ${
                activeTab === 'studio'
                  ? 'text-amber-800 dark:text-amber-300 font-semibold'
                  : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              Studio
            </button>
            <button
              type="button"
              data-liquid-key="settings"
              onClick={() => setActiveTab('settings')}
              className={`relative z-10 ios-liquid-pill px-3.5 py-1.5 rounded-full whitespace-nowrap shrink-0 ${
                activeTab === 'settings'
                  ? 'text-amber-800 dark:text-amber-300 font-semibold'
                  : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              Cài đặt
            </button>
          </nav>

          {/* Zone 3: Universal In-App Search + Theme Switcher + Single Primary Action */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsGlobalSearchOpen(true)}
              aria-label="Tìm kiếm toàn ứng dụng"
              title="Tìm kiếm sách, cài đặt, đồng bộ, tải sách... (Ctrl+K)"
              className="ios-liquid-pill inline-flex items-center justify-center gap-1.5 h-9 px-2.5 sm:px-3.5 rounded-full ios-liquid-bar border border-white/75 dark:border-zinc-700/60 text-xs font-medium text-stone-700 dark:text-stone-200 hover:text-amber-800 dark:hover:text-amber-300 shrink-0"
            >
              <Search className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">Tìm kiếm</span>
            </button>
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
              className="ios-liquid-btn inline-flex items-center gap-1.5 px-3.5 sm:px-4 py-2 rounded-full bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-xs font-semibold hover:opacity-95 whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Thêm sách</span>
            </button>
          </div>
        </div>
      </header>
      )}

      {!isLoaded ? (
        <div className="max-w-7xl mx-auto px-6 py-16 text-xs text-stone-500">
          Đang tải tủ sách LaziRead...
        </div>
      ) : (
        <>
          {activeBook && (activeTab === 'reader' || isReaderAudioPlaying) && (
            <div className={activeTab === 'reader' ? 'ios-reader-enter' : 'hidden'}>
              <ReaderView
                book={activeBook}
                initialOpenAudio={openAudioOnRead}
                basicSettings={basicSettings}
                isReaderActive={activeTab === 'reader'}
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
            </div>
          )}

          {activeTab !== 'reader' && (
            <div key={activeTab} className="relative z-10 ios-view-enter">
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
                  focusCollectionSignal={focusCollectionSignal}
                />
              )}

              {activeTab === 'web' && <WebScraperView crawler={crawler} />}

              {activeTab === 'studio' && (
                <VoiceStudioView
                  customFonts={customFonts}
                  onAddCustomFont={handleAddCustomFont}
                  onDeleteCustomFont={handleDeleteCustomFont}
                  activeFontFamily={readerSettings.fontFamily}
                  onSelectFontFamily={(fontFamily) => handleUpdateSettings({ fontFamily })}
                  externalVoices={externalVoices}
                  onAddExternalVoice={handleAddExternalVoice}
                  onDeleteExternalVoice={handleDeleteExternalVoice}
                  defaultVoice={basicSettings.defaultVoice}
                  onSelectDefaultVoice={(defaultVoice) =>
                    handleUpdateBasicSettings({ defaultVoice })
                  }
                  customAmbientTracks={customAmbientTracks}
                  onAddCustomAmbientTrack={handleAddCustomAmbientTrack}
                  onDeleteCustomAmbientTrack={handleDeleteCustomAmbientTrack}
                  standaloneDeviceMode={isStandaloneDeviceMode}
                />
              )}

              {activeTab === 'settings' && (
                <SettingsSyncView
                  books={books}
                  collections={userCollections}
                  readingLogs={readingLogs}
                  basicSettings={basicSettings}
                  customWallpaperDataUrl={customWallpaperDataUrl}
                  onUpdateCustomWallpaper={handleUpdateCustomWallpaper}
                  lastAutoSyncAt={lastAutoSyncAt}
                  isAutoSyncing={isAutoSyncing}
                  onUpdateBasicSettings={handleUpdateBasicSettings}
                  onApplySyncedLibrary={handleApplySyncedLibrary}
                />
              )}
            </div>
          )}
        </>
      )}

      {/* iPhone-Style Floating Raised Glass Bottom Dock with Sliding Transparent Water-Drop */}
      {activeTab !== 'reader' && (
        <nav
          ref={mobileDockRef}
          aria-label="Thanh điều hướng nổi iPhone"
          className={`fixed bottom-3 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-1.5rem)] max-w-[368px] sm:w-auto sm:max-w-none ios-glass-dock rounded-[24px] p-1 border grid grid-cols-4 sm:flex sm:items-center sm:justify-center gap-1 sm:gap-1.5 ${
            basicSettings.uiTheme === 'amoled'
              ? 'border-zinc-800/90'
              : 'border-white/75 dark:border-zinc-700/60'
          }`}
        >
          <LiquidDropThumb
            thumb={dockThumb}
            isGliding={dockGliding}
            roundedClass="rounded-[20px]"
          />
          {(
            [
              { id: 'library', label: 'Thư viện', icon: BookOpen },
              { id: 'web', label: 'Cộng đồng', icon: Globe },
              { id: 'studio', label: 'Studio', icon: Mic2 },
              { id: 'settings', label: 'Cài đặt', icon: Settings },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                data-liquid-key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`relative z-10 ios-liquid-pill min-w-0 flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 px-1 sm:px-3.5 py-1.5 sm:py-2 rounded-[20px] min-h-[42px] sm:min-h-[38px] ${
                  active
                    ? 'text-amber-800 dark:text-amber-300 font-semibold'
                    : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white'
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
        standaloneDeviceMode={isStandaloneDeviceMode}
      />

      <GlobalSearchModal
        isOpen={isGlobalSearchOpen}
        onClose={() => setIsGlobalSearchOpen(false)}
        books={books}
        collections={userCollections}
        onSelectAction={handleGlobalSearchAction}
      />
    </div>
  );
}
