import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  ChevronLeft,
  Download,
  Globe,
  Loader2,
  Maximize2,
  Mic2,
  Moon,
  Pause,
  Play,
  Search,
  Settings,
  Sun,
  X,
} from 'lucide-react';
import type {
  AppBasicSettings,
  Book,
  CustomAmbientTrack,
  CustomFontAsset,
  DefaultVoiceSelection,
  ExternalVoiceAsset,
  ReaderSettings,
  ReadingLogEntry,
  UserCollection,
} from './types/book';
import { resolveNarratorAssignmentFromDefault } from './utils/studioCatalog';
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
import {
  addReadingSecondsToLogs,
  computeBookFingerprint,
  formatIsoDateLocal,
  normalizeBookMatchKey,
} from './utils/syncAndStats';
import { LibraryView } from './components/LibraryView';
import { ReaderView } from './components/ReaderView';
import { WebScraperView } from './components/WebScraperView';
import { VoiceStudioView } from './components/VoiceStudioView';
import { SettingsSyncView } from './components/SettingsSyncView';
import { OfflineIndicator } from './components/PWAInstallUI';
import { FloatingBookDisc } from './components/FloatingBookDisc';
import { LiquidDropThumb, useLiquidDropIndicator } from './components/LiquidGlassBar';
import { useWebCrawler } from './hooks/useWebCrawler';
import type { GlobalSearchAction } from './utils/globalSearch';
import {
  evaluateRightEdgeBackSwipe,
  isInRightEdgeBackZone,
  type EdgeSwipeStart,
} from './utils/edgeSwipeBack';
import { triggerDeviceHaptic } from './utils/deviceHardware';
import { ensureRamCacheLifecycle, scheduleIdleWarmup } from './utils/ramCache';
import { getAppStrings } from './utils/i18n';
import { LanguageProvider } from './contexts/LanguageContext';
import { syncSystemBarAppearance } from './utils/edgeToEdge';
import { warmCommunityRamCache } from './utils/communityDriveStore';

// Secondary modals stay code-split for fast startup and are silently pre-warmed into RAM during idle
const loadImportBookModal = () =>
  import('./components/ImportBookModal').then((m) => ({ default: m.ImportBookModal }));
const loadGlobalSearchModal = () =>
  import('./components/GlobalSearchModal').then((m) => ({ default: m.GlobalSearchModal }));
const loadAppInfoModal = () =>
  import('./components/AppInfoModal').then((m) => ({ default: m.AppInfoModal }));
const loadCongDongSachModal = () =>
  import('./components/CongDongSachModal').then((m) => ({ default: m.CongDongSachModal }));

const ImportBookModal = lazy(loadImportBookModal);
const GlobalSearchModal = lazy(loadGlobalSearchModal);
const AppInfoModal = lazy(loadAppInfoModal);
const CongDongSachModal = lazy(loadCongDongSachModal);
import {
  getDriveAccessToken,
  getDriveAuthSnapshot,
  initDriveAuth,
  subscribeDriveAuth,
  type DriveAuthSnapshot,
} from './utils/googleDriveAuth';
import {
  syncProgressTwoWayWithDrive,
  uploadProgressManifestToDrive,
} from './utils/googleDriveSync';

type AppTab = 'library' | 'reader' | 'web' | 'studio' | 'settings';
const PRIMARY_TAB_ORDER: AppTab[] = ['library', 'web', 'studio', 'settings'];

export default function App() {
  const [activeTab, setActiveTabState] = useState<AppTab>('library');
  const [tabDirection, setTabDirection] = useState<'forward' | 'backward' | 'none'>('none');
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
  const [isAppInfoOpen, setIsAppInfoOpen] = useState(false);
  const [isCongDongSachOpen, setIsCongDongSachOpen] = useState(false);
  const [focusCollectionSignal, setFocusCollectionSignal] = useState<{
    name: string;
    tick: number;
  } | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  // Invisible RAM keep-alive cache for primary tabs so switching tabs has 0ms lag and zero spinner
  const [warmTabs, setWarmTabs] = useState<Record<'library' | 'web' | 'studio' | 'settings', boolean>>({
    library: true,
    web: false,
    studio: false,
    settings: false,
  });

  useEffect(() => {
    ensureRamCacheLifecycle();
    if (!isLoaded) return;
    const cancelTabs = scheduleIdleWarmup(() => {
      setWarmTabs({ library: true, web: true, studio: true, settings: true });
    }, 600);
    const cancelModals = scheduleIdleWarmup(() => {
      void loadImportBookModal();
      void loadGlobalSearchModal();
      void loadAppInfoModal();
      void loadCongDongSachModal();
    }, 1500);
    return () => {
      cancelTabs();
      cancelModals();
    };
  }, [isLoaded]);

  const setActiveTab = useCallback((nextTab: AppTab) => {
    if (nextTab !== 'reader') {
      setWarmTabs((prev) => (prev[nextTab] ? prev : { ...prev, [nextTab]: true }));
    }
    setActiveTabState((prevTab) => {
      if (prevTab === nextTab) return prevTab;
      const prevIdx = PRIMARY_TAB_ORDER.indexOf(prevTab);
      const nextIdx = PRIMARY_TAB_ORDER.indexOf(nextTab);
      if (prevIdx !== -1 && nextIdx !== -1) {
        setTabDirection(nextIdx > prevIdx ? 'forward' : 'backward');
      } else {
        setTabDirection('none');
      }
      return nextTab;
    });
  }, []);
  const [isReaderAudioPlaying, setIsReaderAudioPlaying] = useState(false);
  const [isReaderAudioSessionActive, setIsReaderAudioSessionActive] = useState(false);
  const [audioCommandSignal, setAudioCommandSignal] = useState<{
    action: 'toggle' | 'next' | 'stop';
    tick: number;
  } | null>(null);
  const [discToggleSignal, setDiscToggleSignal] = useState(0);
  const appEdgeSwipeRef = useRef<EdgeSwipeStart | null>(null);
  const [appEdgeSwipeProgress, setAppEdgeSwipeProgress] = useState(0);
  const [driveAuth, setDriveAuth] = useState<DriveAuthSnapshot>(() => getDriveAuthSnapshot());
  const [lastAutoSyncAt, setLastAutoSyncAt] = useState<number | null>(null);
  const [isAutoSyncing, setIsAutoSyncing] = useState(false);
  const [customWallpaperDataUrl, setCustomWallpaperDataUrl] = useState<string | null>(null);
  const [pendingDuplicateBook, setPendingDuplicateBook] = useState<{
    existing: Book;
    incoming: Book;
    openImmediately: boolean;
  } | null>(null);

  const booksRef = useRef<Book[]>([]);
  const readingLogsRef = useRef<ReadingLogEntry[]>([]);
  const isAutoSyncingRef = useRef(false);

  useEffect(() => {
    booksRef.current = books;
  }, [books]);

  useEffect(() => {
    readingLogsRef.current = readingLogs;
  }, [readingLogs]);

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

  const runTwoWayAutoSync = useCallback(async () => {
    if (isAutoSyncingRef.current) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    const token = getDriveAccessToken();
    if (!token) return;

    isAutoSyncingRef.current = true;
    setIsAutoSyncing(true);
    try {
      const result = await syncProgressTwoWayWithDrive(
        token,
        booksRef.current,
        readingLogsRef.current
      );
      if (result.matchedProgressCount > 0) {
        setBooks(result.mergedBooks);
        setReadingLogs(result.mergedLogs);
        await saveAllBooks(result.mergedBooks);
        await saveReadingLogs(result.mergedLogs);
      }
      setLastAutoSyncAt(Date.now());
    } catch {
      // Silent background retry on next trigger
    } finally {
      isAutoSyncingRef.current = false;
      setIsAutoSyncing(false);
    }
  }, []);

  // Immediate two-way sync when auto-sync is enabled & connected, and whenever device regains network
  useEffect(() => {
    if (!isLoaded || !basicSettings.autoSyncGoogleDrive || !driveAuth.isConnected) return;
    void runTwoWayAutoSync();

    const handleOnline = () => {
      void runTwoWayAutoSync();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [
    isLoaded,
    basicSettings.autoSyncGoogleDrive,
    driveAuth.isConnected,
    runTwoWayAutoSync,
  ]);

  // Debounced background push to Google Drive (`sáchlazy`) on reading/book updates
  useEffect(() => {
    if (!isLoaded || !basicSettings.autoSyncGoogleDrive || !driveAuth.isConnected) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    const token = getDriveAccessToken();
    if (!token) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (isAutoSyncingRef.current) return;
      isAutoSyncingRef.current = true;
      try {
        setIsAutoSyncing(true);
        await uploadProgressManifestToDrive(token, books, readingLogs);
        if (!cancelled) {
          setLastAutoSyncAt(Date.now());
        }
      } catch {
        // Silent background retry on next change
      } finally {
        isAutoSyncingRef.current = false;
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

  // Thermal & battery saver: freeze continuous CSS animations whenever app is backgrounded
  useEffect(() => {
    const syncVisibility = () => {
      document.documentElement.setAttribute(
        'data-app-hidden',
        document.hidden ? 'true' : 'false'
      );
    };
    syncVisibility();
    document.addEventListener('visibilitychange', syncVisibility);
    return () => document.removeEventListener('visibilitychange', syncVisibility);
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

    // Edge-to-Edge status bar color sync for non-reader screens (Reader syncs its own paper color)
    if (activeTab !== 'reader') {
      const barBg =
        basicSettings.uiTheme === 'amoled'
          ? '#000000'
          : basicSettings.uiTheme === 'dark'
          ? themeVars.bgDark
          : themeVars.bgLight;
      syncSystemBarAppearance({
        backgroundHex: barBg,
        isDark: basicSettings.uiTheme !== 'light',
      });
    }
  }, [activeTab, basicSettings.uiTheme, basicSettings.uiAccent, basicSettings.uiCustomAccentHex]);

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

  const handlePatchBook = useCallback((bookId: string, updater: (prev: Book) => Book) => {
    setBooks((prev) => {
      let changed: Book | null = null;
      const next = prev.map((b) => {
        if (b.id !== bookId) return b;
        changed = updater(b);
        return changed;
      });
      if (changed) {
        void saveBook(changed);
      }
      return next;
    });
  }, []);

  const handleSelectDefaultVoice = async (nextDefaultVoice: DefaultVoiceSelection) => {
    handleUpdateBasicSettings({ defaultVoice: nextDefaultVoice });
    const nextNarrator = resolveNarratorAssignmentFromDefault(
      nextDefaultVoice,
      externalVoices
    );
    // Propagate new global default voice onto books immediately so Studio selection works right away in Reader
    const updatedBooks: Book[] = [];
    setBooks((prev) =>
      prev.map((b) => {
        const nextBook: Book = {
          ...b,
          voiceAssignments: {
            ...(b.voiceAssignments || {}),
            narrator: nextNarrator,
          },
        };
        updatedBooks.push(nextBook);
        return nextBook;
      })
    );
    if (updatedBooks.length > 0) {
      await saveAllBooks(updatedBooks);
    }
  };

  const handleAddBook = async (
    newBook: Book,
    openImmediately = true,
    options?: { bypassDuplicateCheck?: boolean }
  ) => {
    const incomingFp = newBook.fingerprint || computeBookFingerprint(newBook);
    const normalizedIncoming: Book = { ...newBook, fingerprint: incomingFp };

    if (!options?.bypassDuplicateCheck) {
      const incomingTitleKey = normalizeBookMatchKey(normalizedIncoming.title);
      const duplicate = booksRef.current.find(
        (b) =>
          (b.fingerprint || computeBookFingerprint(b)) === incomingFp ||
          (Boolean(incomingTitleKey) && normalizeBookMatchKey(b.title) === incomingTitleKey)
      );
      if (duplicate) {
        setPendingDuplicateBook({
          existing: duplicate,
          incoming: normalizedIncoming,
          openImmediately,
        });
        return;
      }
    }

    setBooks((prev) => [normalizedIncoming, ...prev]);
    await saveBook(normalizedIncoming);
    if (openImmediately) {
      setActiveBookId(normalizedIncoming.id);
      setOpenAudioOnRead(false);
      setActiveTab('reader');
    }
  };

  const handleResolveDuplicateBook = async (
    action: 'keep-existing' | 'overwrite-content' | 'rename-new'
  ) => {
    if (!pendingDuplicateBook) return;
    const { existing, incoming, openImmediately } = pendingDuplicateBook;
    setPendingDuplicateBook(null);

    if (action === 'keep-existing') {
      if (openImmediately) {
        handleOpenBook(existing.id, false);
      }
      return;
    }

    if (action === 'overwrite-content') {
      const clampedCh = Math.min(
        Math.max(0, existing.currentChapterIndex),
        Math.max(0, incoming.chapters.length - 1)
      );
      const maxPara = Math.max(0, (incoming.chapters[clampedCh]?.paragraphs.length || 1) - 1);
      const clampedPara = Math.min(Math.max(0, existing.currentParagraphIndex), maxPara);
      const overwritten: Book = {
        ...incoming,
        id: existing.id,
        collection: existing.collection || incoming.collection,
        currentChapterIndex: clampedCh,
        currentParagraphIndex: clampedPara,
        currentSentenceIndex: existing.currentSentenceIndex,
        progressPercent: existing.progressPercent,
        bookmarks: existing.bookmarks,
        highlights: existing.highlights,
        lastReadAt: Math.max(existing.lastReadAt, Date.now()),
      };
      await handleUpdateBook(overwritten);
      if (openImmediately) {
        handleOpenBook(overwritten.id, false);
      }
      return;
    }

    // Rename & save as separate copy
    const existingKeys = new Set(
      booksRef.current.map((b) => normalizeBookMatchKey(b.title)).filter(Boolean)
    );
    const baseTitle = incoming.title.replace(/\s*\(\d+\)\s*$/, '').trim() || 'Sách mới';
    let suffix = 2;
    let uniqueTitle = `${baseTitle} (${suffix})`;
    while (existingKeys.has(normalizeBookMatchKey(uniqueTitle))) {
      suffix += 1;
      uniqueTitle = `${baseTitle} (${suffix})`;
    }
    const renamedBook: Book = {
      ...incoming,
      id: `book-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: uniqueTitle,
      addedAt: Date.now(),
      lastReadAt: Date.now(),
    };
    await handleAddBook(renamedBook, openImmediately, { bypassDuplicateCheck: true });
  };

  const handleUpdateCollections = (nextCollections: UserCollection[]) => {
    setUserCollections(nextCollections);
    saveUserCollections(nextCollections);
  };

  const handleEnsureYoutubeCollection = async (bookId: string) => {
    setUserCollections((prev) => {
      const existing = prev.find((c) => c.name === '/YouTube_Notes');
      let next: UserCollection[];
      if (existing) {
        if (existing.bookIds.includes(bookId)) return prev;
        next = prev.map((c) =>
          c.id === existing.id ? { ...c, bookIds: [bookId, ...c.bookIds] } : c
        );
      } else {
        const created: UserCollection = {
          id: `col-yt-notes-${Date.now().toString(36)}`,
          name: '/YouTube_Notes',
          bookIds: [bookId],
          createdAt: Date.now(),
        };
        next = [created, ...prev];
      }
      saveUserCollections(next);
      return next;
    });
  };

  useEffect(() => {
    warmCommunityRamCache();
  }, []);

  const appStrings = getAppStrings(basicSettings.appLanguage);

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
    setCustomFonts((prev) => {
      const exists = prev.some((f) => f.id === font.id);
      return exists ? prev.map((f) => (f.id === font.id ? font : f)) : [font, ...prev];
    });
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
    setCustomAmbientTracks((prev) => {
      const exists = prev.some((t) => t.id === track.id);
      return exists ? prev.map((t) => (t.id === track.id ? track : t)) : [track, ...prev];
    });
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

  const dispatchAudioCommand = useCallback((action: 'toggle' | 'next' | 'stop') => {
    setAudioCommandSignal((prev) => ({
      action,
      tick: (prev?.tick ?? 0) + 1,
    }));
  }, []);

  const handleAppEdgePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activeTab === 'reader') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (typeof window === 'undefined') return;
    const hasBackDestination =
      isImportOpen ||
      isGlobalSearchOpen ||
      isAppInfoOpen ||
      isCongDongSachOpen ||
      Boolean(pendingDuplicateBook) ||
      activeTab !== 'library';
    if (!hasBackDestination) return;
    if (isInRightEdgeBackZone(e.clientX, window.innerWidth)) {
      appEdgeSwipeRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        viewportWidth: window.innerWidth,
      };
      setAppEdgeSwipeProgress(0);
    }
  };

  const handleAppEdgePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!appEdgeSwipeRef.current) return;
    if (e.pointerType === 'mouse' && e.buttons !== 1) return;
    const res = evaluateRightEdgeBackSwipe(appEdgeSwipeRef.current, e.clientX, e.clientY);
    if (res.isHorizontalBack) {
      setAppEdgeSwipeProgress(res.progress);
    }
  };

  const finishAppEdgeSwipe = (clientX?: number, clientY?: number) => {
    const start = appEdgeSwipeRef.current;
    appEdgeSwipeRef.current = null;
    setAppEdgeSwipeProgress(0);
    if (!start || typeof clientX !== 'number' || typeof clientY !== 'number') return;
    const res = evaluateRightEdgeBackSwipe(start, clientX, clientY);
    if (!res.shouldNavigateBack) return;
    triggerDeviceHaptic('tap', basicSettings.hapticFeedback !== false);
    if (pendingDuplicateBook) {
      setPendingDuplicateBook(null);
    } else if (isGlobalSearchOpen) {
      setIsGlobalSearchOpen(false);
    } else if (isImportOpen) {
      setIsImportOpen(false);
    } else if (isCongDongSachOpen) {
      setIsCongDongSachOpen(false);
    } else if (isAppInfoOpen) {
      setIsAppInfoOpen(false);
    } else if (activeTab !== 'library') {
      setActiveTab('library');
    }
  };

  return (
    <LanguageProvider
      language={basicSettings.appLanguage || 'vi'}
      onChangeLanguage={(lang) => handleUpdateBasicSettings({ appLanguage: lang })}
    >
    <div
      onPointerDown={handleAppEdgePointerDown}
      onPointerMove={handleAppEdgePointerMove}
      onPointerUp={(e) => finishAppEdgeSwipe(e.clientX, e.clientY)}
      onPointerCancel={() => finishAppEdgeSwipe()}
      className={`relative min-h-screen transition-colors ${
        showAppWallpaper
          ? 'app-wallpaper-active text-stone-900 dark:text-stone-100'
          : basicSettings.uiTheme === 'amoled'
          ? 'bg-black text-zinc-100'
          : 'bg-[var(--app-bg-light)] dark:bg-[var(--app-bg-dark)] text-stone-900 dark:text-stone-100'
      } ${activeTab !== 'reader' ? 'pb-24' : ''}`}
    >
      {/* Right-Edge Swipe-Back Visual Pill Indicator */}
      {appEdgeSwipeProgress > 0.08 && (
        <div
          aria-hidden="true"
          style={{
            transform: `translateY(-50%) translateX(${Math.round(-appEdgeSwipeProgress * 18)}px) scale(${0.85 + appEdgeSwipeProgress * 0.2})`,
            opacity: Math.min(1, appEdgeSwipeProgress * 1.35),
          }}
          className="fixed right-1 top-1/2 z-[120] pointer-events-none w-9 h-12 rounded-l-full bg-stone-900/90 dark:bg-white/90 text-white dark:text-stone-900 shadow-lg flex items-center justify-center"
        >
          <ChevronLeft className="w-5 h-5" />
        </div>
      )}
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
        className={`sticky top-0 z-40 border-b pt-[env(safe-area-inset-top)] ${
          basicSettings.uiTheme === 'amoled'
            ? 'bg-black border-zinc-800'
            : 'bg-white dark:bg-[#16181C] border-stone-200 dark:border-stone-800'
        }`}
      >
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-[48px] sm:h-[52px] flex items-center justify-between gap-1.5 sm:gap-6">
          {/* Zone 1: BOOKHAD Brand Logo + Icon + (!) Info Button */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('library')}
              className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <img
                src="/bookhad-icon.jpg"
                alt="BOOKHAD"
                className="w-6 h-6 sm:w-7 sm:h-7 rounded-[8px] object-cover shadow-xs ring-1 ring-amber-700/25 shrink-0"
              />
              <span className="text-[16px] sm:text-[18px] font-display font-bold tracking-tight text-stone-900 dark:text-stone-100">
                BOOKHAD
              </span>
            </button>
            <button
              type="button"
              onClick={() => setIsAppInfoOpen(true)}
              aria-label="Thông tin ứng dụng BOOKHAD, quyền riêng tư và điều khoản"
              title="Thông tin ứng dụng BOOKHAD"
              className="w-6 h-6 rounded-full ios-liquid-bar border border-white/75 dark:border-zinc-700/60 flex items-center justify-center text-amber-800 dark:text-amber-300 hover:bg-amber-800/10 transition-transform active:scale-90 shrink-0"
            >
              <AlertCircle className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Zone 2: Liquid-Glass Sliding Water-Drop Desktop Navigation */}
          <nav
            ref={desktopNavRef}
            aria-label="Điều hướng chính"
            className="relative hidden md:flex items-center gap-1 p-1 rounded-full ios-liquid-bar border border-white/75 dark:border-zinc-700/60 text-[11px] font-medium min-w-0"
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
              className={`relative z-10 ios-liquid-pill px-3 py-1 rounded-full whitespace-nowrap shrink-0 ${
                activeTab === 'library'
                  ? 'text-amber-800 dark:text-amber-300 font-semibold'
                  : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              {appStrings.navLibrary}
            </button>
            <button
              type="button"
              onClick={() => {
                if (activeBook) setActiveTab('reader');
              }}
              disabled={!activeBook}
              className="relative z-10 ios-liquid-pill px-3 py-1 rounded-full whitespace-nowrap shrink-0 disabled:opacity-40 text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white"
            >
              {appStrings.navReader}
            </button>
            <button
              type="button"
              data-liquid-key="web"
              onClick={() => setActiveTab('web')}
              className={`relative z-10 ios-liquid-pill px-3 py-1 rounded-full whitespace-nowrap shrink-0 ${
                activeTab === 'web'
                  ? 'text-amber-800 dark:text-amber-300 font-semibold'
                  : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              {appStrings.navCommunity}
            </button>
            <button
              type="button"
              data-liquid-key="studio"
              onClick={() => setActiveTab('studio')}
              className={`relative z-10 ios-liquid-pill px-3 py-1 rounded-full whitespace-nowrap shrink-0 ${
                activeTab === 'studio'
                  ? 'text-amber-800 dark:text-amber-300 font-semibold'
                  : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              {appStrings.navStudio}
            </button>
            <button
              type="button"
              data-liquid-key="settings"
              onClick={() => setActiveTab('settings')}
              className={`relative z-10 ios-liquid-pill px-3 py-1 rounded-full whitespace-nowrap shrink-0 ${
                activeTab === 'settings'
                  ? 'text-amber-800 dark:text-amber-300 font-semibold'
                  : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              {appStrings.navSettings}
            </button>
          </nav>

          {/* Zone 3: Universal In-App Search + Theme Switcher + Compact Primary Action */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsGlobalSearchOpen(true)}
              aria-label="Tìm kiếm toàn ứng dụng"
              title="Tìm kiếm sách, cài đặt, đồng bộ, tải sách... (Ctrl+K)"
              className="ios-liquid-pill inline-flex items-center justify-center gap-1 w-8 h-8 sm:w-auto sm:h-8 sm:px-3 rounded-full ios-liquid-bar border border-white/75 dark:border-zinc-700/60 text-[11px] font-medium text-stone-700 dark:text-stone-200 hover:text-amber-800 dark:hover:text-amber-300 shrink-0"
            >
              <Search className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">{appStrings.searchAll}</span>
            </button>
            <button
              type="button"
              onClick={handleCycleUiTheme}
              aria-label={
                isDarkOrAmoled ? 'Đổi giao diện Sáng / AMOLED' : 'Chuyển giao diện tối'
              }
              title={`Giao diện: ${basicSettings.uiTheme.toUpperCase()}`}
              className="ios-liquid-pill w-8 h-8 rounded-full ios-liquid-bar border border-stone-200 dark:border-zinc-700 flex items-center justify-center text-stone-700 dark:text-stone-300 hover:text-amber-800 dark:hover:text-amber-300 shrink-0"
            >
              {isDarkOrAmoled ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </header>
      )}

      {!isLoaded ? (
        <div className="max-w-7xl mx-auto px-6 py-16 text-xs text-stone-500">
          {appStrings.loadingLibrary}
        </div>
      ) : (
        <>
          {activeBook && (activeTab === 'reader' || isReaderAudioPlaying || isReaderAudioSessionActive) && (
            <div className={activeTab === 'reader' ? 'ios-reader-enter' : 'hidden'}>
              <ReaderView
                book={activeBook}
                initialOpenAudio={openAudioOnRead}
                basicSettings={basicSettings}
                isReaderActive={activeTab === 'reader'}
                onBackToLibrary={() => setActiveTab('library')}
                onUpdateBook={handleUpdateBook}
                onPatchBook={handlePatchBook}
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
                onAudioSessionActiveChange={setIsReaderAudioSessionActive}
                audioCommandSignal={audioCommandSignal}
                audioDrawerToggleSignal={discToggleSignal}
              />
            </div>
          )}

          <div className={activeTab !== 'reader' ? 'relative z-10' : 'hidden'}>
            {warmTabs.library && (
              <div
                aria-hidden={activeTab !== 'library'}
                className={
                  activeTab === 'library'
                    ? tabDirection === 'forward'
                      ? 'ios-tab-forward'
                      : tabDirection === 'backward'
                      ? 'ios-tab-backward'
                      : 'ios-view-enter'
                    : 'hidden'
                }
              >
                <LibraryView
                  books={books}
                  collections={userCollections}
                  readingLogs={readingLogs}
                  onOpenBook={handleOpenBook}
                  onUpdateBook={handleUpdateBook}
                  onDeleteBook={handleDeleteBook}
                  onUpdateCollections={handleUpdateCollections}
                  onOpenImportModal={() => setIsImportOpen(true)}
                  onOpenCongDongSach={() => setIsCongDongSachOpen(true)}
                  onRestoreSamples={handleRestoreSamples}
                  onDuplicateAsNewBook={(copy) =>
                    handleAddBook(copy, false, { bypassDuplicateCheck: true })
                  }
                  focusCollectionSignal={focusCollectionSignal}
                />
              </div>
            )}

            {warmTabs.web && (
              <div
                aria-hidden={activeTab !== 'web'}
                className={
                  activeTab === 'web'
                    ? tabDirection === 'forward'
                      ? 'ios-tab-forward'
                      : tabDirection === 'backward'
                      ? 'ios-tab-backward'
                      : 'ios-view-enter'
                    : 'hidden'
                }
              >
                <WebScraperView
                  crawler={crawler}
                  onAddBook={handleAddBook}
                  onEnsureYoutubeCollection={handleEnsureYoutubeCollection}
                  onBackgroundToLibrary={() => setActiveTab('library')}
                />
              </div>
            )}

            {warmTabs.studio && (
              <div
                aria-hidden={activeTab !== 'studio'}
                className={
                  activeTab === 'studio'
                    ? tabDirection === 'forward'
                      ? 'ios-tab-forward'
                      : tabDirection === 'backward'
                      ? 'ios-tab-backward'
                      : 'ios-view-enter'
                    : 'hidden'
                }
              >
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
                  onSelectDefaultVoice={handleSelectDefaultVoice}
                  customAmbientTracks={customAmbientTracks}
                  onAddCustomAmbientTrack={handleAddCustomAmbientTrack}
                  onDeleteCustomAmbientTrack={handleDeleteCustomAmbientTrack}
                  standaloneDeviceMode={isStandaloneDeviceMode}
                />
              </div>
            )}

            {warmTabs.settings && (
              <div
                aria-hidden={activeTab !== 'settings'}
                className={
                  activeTab === 'settings'
                    ? tabDirection === 'forward'
                      ? 'ios-tab-forward'
                      : tabDirection === 'backward'
                      ? 'ios-tab-backward'
                      : 'ios-view-enter'
                    : 'hidden'
                }
              >
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
              </div>
            )}
          </div>
        </>
      )}

      {/* Compact Opaque Solid Bottom Dock (4/5 height, half-size label text, zero see-through) */}
      {activeTab !== 'reader' && (
        <nav
          ref={mobileDockRef}
          data-testid="bottom-nav-dock"
          aria-label="Thanh điều hướng nổi iPhone"
          className={`fixed bottom-2.5 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-1rem)] max-w-md sm:w-auto sm:max-w-none h-[48px] sm:h-auto ios-glass-dock rounded-[20px] p-1 border grid grid-cols-4 sm:flex sm:items-center sm:justify-center gap-0.5 sm:gap-1 ${
            basicSettings.uiTheme === 'amoled'
              ? 'bg-[#0a0a0a] border-zinc-800'
              : 'bg-white dark:bg-[#16181C] border-stone-200 dark:border-zinc-800'
          }`}
        >
          <LiquidDropThumb
            thumb={dockThumb}
            isGliding={dockGliding}
            roundedClass="rounded-[16px]"
          />
          {(
            [
              { id: 'library', label: appStrings.navLibrary, icon: BookOpen },
              { id: 'web', label: appStrings.navCommunity, icon: Globe },
              { id: 'studio', label: appStrings.navStudio, icon: Mic2 },
              { id: 'settings', label: appStrings.navSettings, icon: Settings },
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
                className={`relative z-10 ios-liquid-pill min-w-0 flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1 px-1 sm:px-3 py-1 sm:py-1.5 rounded-[16px] min-h-[38px] sm:min-h-[34px] ${
                  active
                    ? 'text-amber-800 dark:text-amber-300 font-semibold'
                    : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 sm:w-3.5 sm:h-3.5 shrink-0" />
                <span className="text-[7.5px] sm:text-[9px] leading-none tracking-tight whitespace-nowrap">
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>
      )}

      {/* BOOKHAD Unified Spinning Disc + Merged Audio Bar (Main Screen) */}
      <FloatingBookDisc
        book={activeBook}
        isAudioPlaying={isReaderAudioPlaying}
        isAudioSessionActive={isReaderAudioSessionActive}
        isReaderOpen={activeTab === 'reader'}
        onToggleAudio={() => dispatchAudioCommand('toggle')}
        onNextAudio={() => dispatchAudioCommand('next')}
        onStopAudio={() => {
          dispatchAudioCommand('stop');
          setIsReaderAudioPlaying(false);
          setIsReaderAudioSessionActive(false);
        }}
        onClick={() => {
          if (!activeBook) return;
          if (activeTab !== 'reader') {
            handleOpenBook(activeBook.id, false);
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
            className="ios-sheet-enter fixed bottom-40 md:bottom-24 right-3 md:right-5 z-40 max-w-sm w-[calc(100%-1.5rem)] rounded-2xl border border-amber-800/40 bg-white dark:bg-[#191B1F] shadow-xl p-3.5 text-xs space-y-2"
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

      <Suspense fallback={null}>
        {isImportOpen && (
          <ImportBookModal
            isOpen={isImportOpen}
            onClose={() => setIsImportOpen(false)}
            onImportBook={handleAddBook}
            defaultReadingStyle={basicSettings.defaultReadingStyle}
            standaloneDeviceMode={isStandaloneDeviceMode}
          />
        )}

        {isGlobalSearchOpen && (
          <GlobalSearchModal
            isOpen={isGlobalSearchOpen}
            onClose={() => setIsGlobalSearchOpen(false)}
            books={books}
            collections={userCollections}
            onSelectAction={handleGlobalSearchAction}
          />
        )}

        {isAppInfoOpen && (
          <AppInfoModal
            isOpen={isAppInfoOpen}
            onClose={() => setIsAppInfoOpen(false)}
          />
        )}

        {isCongDongSachOpen && (
          <CongDongSachModal
            open={isCongDongSachOpen}
            localBooks={books}
            onClose={() => setIsCongDongSachOpen(false)}
            onImportBook={handleAddBook}
          />
        )}
      </Suspense>

      {pendingDuplicateBook && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="duplicate-book-modal-title"
          className="fixed inset-0 z-[70] bg-black/45 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md rounded-2xl bg-[#FBF9F5] dark:bg-[#191B1F] border border-stone-200 dark:border-stone-800 shadow-2xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <h3
                  id="duplicate-book-modal-title"
                  className="text-[16px] font-semibold text-stone-900 dark:text-stone-100"
                >
                  Phát hiện sách trùng tên
                </h3>
                <p className="text-[13px] leading-[1.4] text-stone-600 dark:text-stone-400">
                  Sách{' '}
                  <span className="font-semibold text-stone-900 dark:text-stone-100">
                    “{pendingDuplicateBook.incoming.title}”
                  </span>{' '}
                  đã có sẵn trong thư viện ({pendingDuplicateBook.existing.progressPercent}% đã đọc).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPendingDuplicateBook(null)}
                aria-label="Đóng thông báo trùng sách"
                className="p-1.5 rounded-full text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => handleResolveDuplicateBook('keep-existing')}
                className="w-full text-left px-3.5 py-2.5 rounded-xl border border-stone-200 dark:border-stone-800 hover:bg-stone-100 dark:hover:bg-stone-800/70 transition-colors"
              >
                <p className="text-[13px] font-semibold text-stone-900 dark:text-stone-100">
                  1. Giữ nguyên sách cũ ({pendingDuplicateBook.existing.progressPercent}%)
                </p>
                <p className="text-[12px] text-stone-500 mt-0.5">
                  Không thêm bản trùng, dùng bản đang có để đồng bộ tiến độ.
                </p>
              </button>

              <button
                type="button"
                onClick={() => handleResolveDuplicateBook('overwrite-content')}
                className="w-full text-left px-3.5 py-2.5 rounded-xl border border-stone-200 dark:border-stone-800 hover:bg-stone-100 dark:hover:bg-stone-800/70 transition-colors"
              >
                <p className="text-[13px] font-semibold text-stone-900 dark:text-stone-100">
                  2. Ghi đè nội dung mới (giữ nguyên trang đang đọc)
                </p>
                <p className="text-[12px] text-stone-500 mt-0.5">
                  Cập nhật chương mới vào sách cũ mà không mất bookmark & vị trí đọc.
                </p>
              </button>

              <button
                type="button"
                onClick={() => handleResolveDuplicateBook('rename-new')}
                className="w-full text-left px-3.5 py-2.5 rounded-xl bg-amber-800 text-white hover:bg-amber-900 transition-colors"
              >
                <p className="text-[13px] font-semibold">
                  3. Đổi tên & lưu thành file mới
                </p>
                <p className="text-[12px] text-amber-100 mt-0.5">
                  Tự thêm hậu tố (2), (3)... để giữ cả 2 file riêng biệt.
                </p>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </LanguageProvider>
  );
}
