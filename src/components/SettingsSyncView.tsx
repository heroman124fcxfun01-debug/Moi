import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Cloud,
  CloudDownload,
  CloudUpload,
  Download,
  FileCheck2,
  FolderSync,
  HardDriveUpload,
  Languages,
  Loader2,
  LogOut,
  Moon,
  PackageCheck,
  RefreshCw,
  Search,
  Settings,
  Smartphone,
  Sun,
  Trash2,
  Upload,
  UserCheck,
  X,
} from 'lucide-react';
import type {
  AppBasicSettings,
  Book,
  BookReadingStyle,
  ReadingLogEntry,
  SyncBackupBundle,
  UserCollection,
} from '../types/book';
import {
  buildSyncBackupBundle,
  computeBookFingerprint,
  mergeReadingLogs,
  mergeSyncBundleIntoLibrary,
} from '../utils/syncAndStats';
import { downloadBlob, readFileAsArrayBuffer, readFileAsText } from '../utils/fileHelpers';
import { parseEpubBuffer } from '../utils/epubBuilder';
import { parsePdfBufferToBook } from '../utils/pdfParser';
import {
  getDriveAccessToken,
  getDriveAuthSnapshot,
  signInWithGoogleDrive,
  signOutGoogleDrive,
  subscribeDriveAuth,
  type DriveAuthSnapshot,
} from '../utils/googleDriveAuth';
import {
  DRIVE_ROOT_FOLDER,
  DRIVE_SINGLE_BOOKS_FOLDER,
  downloadDriveCollections,
  downloadDriveSingleBooks,
  executePlannedUploads,
  groupBooksForCollectionUpload,
  inspectDriveLibraryContents,
  mergeDownloadedDriveBooks,
  scanUploadCollectionsPlan,
  scanUploadSingleBooksPlan,
  uploadProgressManifestToDrive,
  type DriveCollectionFolderInfo,
  type DriveItemRef,
  type DuplicateScanResult,
} from '../utils/googleDriveSync';
import {
  LANGUAGE_PACK_CATALOG,
  downloadLanguagePackToApp,
  loadInstalledLanguagePacks,
  removeInstalledLanguagePack,
  type InstalledLanguagePack,
} from '../utils/languagePacks';
import {
  Check,
  Cpu,
  HardDrive,
  Image as ImageIcon,
  Palette,
  ShieldCheck,
  Vibrate,
} from 'lucide-react';
import {
  APP_COLOR_PALETTES,
  APP_WALLPAPER_PRESETS,
  compressWallpaperImageFile,
} from '../utils/appAppearance';
import {
  inspectDeviceHardwareCapabilities,
  requestPersistentDeviceStorage,
  triggerDeviceHaptic,
  type DeviceHardwareSnapshot,
} from '../utils/deviceHardware';
import { normalizeSearchText } from '../utils/globalSearch';
import { LiquidDropThumb, useLiquidDropIndicator } from './LiquidGlassBar';

interface SettingsSyncViewProps {
  books: Book[];
  collections: UserCollection[];
  readingLogs: ReadingLogEntry[];
  basicSettings: AppBasicSettings;
  customWallpaperDataUrl?: string | null;
  onUpdateCustomWallpaper?: (dataUrl: string | null) => Promise<void>;
  lastAutoSyncAt?: number | null;
  isAutoSyncing?: boolean;
  onUpdateBasicSettings: (patch: Partial<AppBasicSettings>) => void;
  onApplySyncedLibrary: (
    mergedBooks: Book[],
    mergedLogs: ReadingLogEntry[],
    mergedCollections?: UserCollection[]
  ) => Promise<void>;
}

function GoogleLogoSvg() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.79-.07-1.54-.19-2.27h-11.3v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
      />
      <path
        fill="#34A853"
        d="M12.255 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96h-3.98v3.09C3.515 21.3 7.565 24 12.255 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.525 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62h-3.98a11.86 11.86 0 000 10.76l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12.255 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C18.205 1.19 15.495 0 12.255 0c-4.69 0-8.74 2.7-10.71 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
      />
    </svg>
  );
}

export const SettingsSyncView: React.FC<SettingsSyncViewProps> = ({
  books,
  collections,
  readingLogs,
  basicSettings,
  customWallpaperDataUrl = null,
  onUpdateCustomWallpaper,
  lastAutoSyncAt = null,
  isAutoSyncing = false,
  onUpdateBasicSettings,
  onApplySyncedLibrary,
}) => {
  const syncFileInputRef = useRef<HTMLInputElement>(null);
  const matchBookInputRef = useRef<HTMLInputElement>(null);
  const wallpaperInputRef = useRef<HTMLInputElement>(null);
  const themeBarRef = useRef<HTMLDivElement>(null);
  const { thumb: themeThumb, isGliding: themeGliding } = useLiquidDropIndicator(
    basicSettings.uiTheme,
    themeBarRef
  );
  const [isUploadingWallpaper, setIsUploadingWallpaper] = useState(false);
  const [wallpaperFeedback, setWallpaperFeedback] = useState('');
  const [hardwareInfo, setHardwareInfo] = useState<DeviceHardwareSnapshot | null>(null);
  const [isPersistingStorage, setIsPersistingStorage] = useState(false);

  useEffect(() => {
    let active = true;
    inspectDeviceHardwareCapabilities()
      .then((snap) => {
        if (active) setHardwareInfo(snap);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const handleUploadWallpaperPhoto = async (files: FileList | null) => {
    if (!files || files.length === 0 || !onUpdateCustomWallpaper) return;
    setIsUploadingWallpaper(true);
    setWallpaperFeedback('');
    try {
      const compressed = await compressWallpaperImageFile(files[0], 1440, 0.82);
      await onUpdateCustomWallpaper(compressed);
      onUpdateBasicSettings({ uiWallpaperPreset: 'custom' });
      triggerDeviceHaptic('success', basicSettings.hapticFeedback !== false);
      setWallpaperFeedback('Đã áp dụng ảnh nền giao diện từ điện thoại (tự ẩn hoàn toàn khi đọc sách).');
    } catch (err) {
      setWallpaperFeedback(
        err instanceof Error ? err.message : 'Không thể đọc ảnh nền từ thiết bị.'
      );
    } finally {
      setIsUploadingWallpaper(false);
      if (wallpaperInputRef.current) wallpaperInputRef.current.value = '';
    }
  };

  const handleClearWallpaper = async () => {
    onUpdateBasicSettings({ uiWallpaperPreset: 'none' });
    if (onUpdateCustomWallpaper) {
      await onUpdateCustomWallpaper(null);
    }
    setWallpaperFeedback('Đã tắt ảnh nền giao diện.');
  };

  const handleProtectStorage = async () => {
    setIsPersistingStorage(true);
    try {
      await requestPersistentDeviceStorage();
      const refreshed = await inspectDeviceHardwareCapabilities();
      setHardwareInfo(refreshed);
      triggerDeviceHaptic('success', basicSettings.hapticFeedback !== false);
    } finally {
      setIsPersistingStorage(false);
    }
  };

  // Google Drive Auth state (in-memory token managed by googleDriveAuth)
  const [driveAuth, setDriveAuth] = useState<DriveAuthSnapshot>(() => getDriveAuthSnapshot());
  const [isAuthBusy, setIsAuthBusy] = useState(false);

  // Sync sections UI state
  const [uploadSubTab, setUploadSubTab] = useState<'collections' | 'single'>('collections');
  const [downloadSubTab, setDownloadSubTab] = useState<'collections' | 'single'>('collections');

  const collectionGroups = useMemo(
    () => groupBooksForCollectionUpload(books, collections),
    [books, collections]
  );

  const [selectedUploadColIds, setSelectedUploadColIds] = useState<string[]>([]);
  const [selectedUploadBookIds, setSelectedUploadBookIds] = useState<string[]>([]);
  const [uploadColQuery, setUploadColQuery] = useState('');
  const [uploadSingleQuery, setUploadSingleQuery] = useState('');
  const [downloadColQuery, setDownloadColQuery] = useState('');
  const [downloadSingleQuery, setDownloadSingleQuery] = useState('');

  useEffect(() => {
    setSelectedUploadColIds(collectionGroups.map((g) => g.collectionId));
  }, [collectionGroups]);

  const filteredUploadCollections = useMemo(() => {
    const q = normalizeSearchText(uploadColQuery);
    if (!q) return collectionGroups;
    return collectionGroups.filter(
      (g) =>
        normalizeSearchText(g.name).includes(q) ||
        g.books.some((b) => normalizeSearchText(b.title).includes(q))
    );
  }, [collectionGroups, uploadColQuery]);

  const filteredUploadBooks = useMemo(() => {
    const q = normalizeSearchText(uploadSingleQuery);
    if (!q) return books;
    return books.filter(
      (b) =>
        normalizeSearchText(b.title).includes(q) ||
        normalizeSearchText(b.author).includes(q)
    );
  }, [books, uploadSingleQuery]);

  // Drive inspection state for Section 3 (Receive from Google Drive)
  const [isInspectingDrive, setIsInspectingDrive] = useState(false);
  const [driveRootFolderId, setDriveRootFolderId] = useState<string | null>(null);
  const [driveCollections, setDriveCollections] = useState<DriveCollectionFolderInfo[]>([]);
  const [driveSingleBooks, setDriveSingleBooks] = useState<DriveItemRef[]>([]);
  const [hasDriveProgressFile, setHasDriveProgressFile] = useState(false);
  const [selectedDriveColIds, setSelectedDriveColIds] = useState<string[]>([]);
  const [selectedDriveFileIds, setSelectedDriveFileIds] = useState<string[]>([]);
  const [hasInspectedOnce, setHasInspectedOnce] = useState(false);

  const filteredDriveCollections = useMemo(() => {
    const q = normalizeSearchText(downloadColQuery);
    if (!q) return driveCollections;
    return driveCollections.filter(
      (folder) =>
        normalizeSearchText(folder.name).includes(q) ||
        folder.files.some((f) => normalizeSearchText(f.name).includes(q))
    );
  }, [driveCollections, downloadColQuery]);

  const filteredDriveSingleBooks = useMemo(() => {
    const q = normalizeSearchText(downloadSingleQuery);
    if (!q) return driveSingleBooks;
    return driveSingleBooks.filter((f) => normalizeSearchText(f.name).includes(q));
  }, [driveSingleBooks, downloadSingleQuery]);

  // Upload/Download progress & duplicate confirmation dialog
  const [isDriveBusy, setIsDriveBusy] = useState(false);
  const [driveProgressText, setDriveProgressText] = useState('');
  const [pendingUploadPlan, setPendingUploadPlan] = useState<DuplicateScanResult | null>(null);

  // Local offline sync & messages
  const [syncStatus, setSyncStatus] = useState('');
  const [syncError, setSyncError] = useState('');
  const [loadedBundle, setLoadedBundle] = useState<SyncBackupBundle | null>(null);
  const [isMatchingFile, setIsMatchingFile] = useState(false);

  // Downloadable In-App Language Packs state
  const [installedPacks, setInstalledPacks] = useState<Record<string, InstalledLanguagePack>>(() =>
    loadInstalledLanguagePacks()
  );
  const [downloadingPackCode, setDownloadingPackCode] = useState<string | null>(null);
  const [packMessage, setPackMessage] = useState('');

  useEffect(() => {
    return subscribeDriveAuth((snap) => setDriveAuth(snap));
  }, []);

  const ensureDriveToken = async (): Promise<string> => {
    const existing = getDriveAccessToken();
    if (existing) return existing;
    const res = await signInWithGoogleDrive();
    return res.accessToken;
  };

  const handleGoogleDriveSignIn = async () => {
    setSyncError('');
    setSyncStatus('');
    setIsAuthBusy(true);
    try {
      const { user } = await signInWithGoogleDrive();
      setSyncStatus(
        `Đã đăng nhập Google Drive thành công (${user.email || user.displayName || 'Tài khoản Google'}).`
      );
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Không thể đăng nhập Google Drive.');
    } finally {
      setIsAuthBusy(false);
    }
  };

  const handleGoogleDriveSignOut = async () => {
    setSyncError('');
    setSyncStatus('');
    setIsAuthBusy(true);
    try {
      await signOutGoogleDrive();
      setDriveRootFolderId(null);
      setDriveCollections([]);
      setDriveSingleBooks([]);
      setHasInspectedOnce(false);
      setSyncStatus('Đã đăng xuất khỏi Google Drive.');
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Lỗi khi đăng xuất Google Drive.');
    } finally {
      setIsAuthBusy(false);
    }
  };

  const handleToggleAutoSync = async () => {
    const nextVal = !basicSettings.autoSyncGoogleDrive;
    setSyncError('');
    onUpdateBasicSettings({ autoSyncGoogleDrive: nextVal });

    if (nextVal) {
      if (!driveAuth.isConnected) {
        setSyncStatus(
          'Đã bật chế độ Tự động đồng bộ Google Drive. Hãy bấm "Đăng nhập với Google Drive" ở trên để bắt đầu tự đồng bộ.'
        );
      } else {
        // Trigger immediate sync of progress manifest
        try {
          const token = getDriveAccessToken();
          if (token) {
            setIsDriveBusy(true);
            setDriveProgressText('Đang tự động đồng bộ tiến độ lên thư mục sáchlazy...');
            await uploadProgressManifestToDrive(token, books, readingLogs);
            setSyncStatus('Đã bật Tự động đồng bộ & cập nhật tiến độ lên Google Drive (sáchlazy).');
          }
        } catch (err) {
          setSyncError(err instanceof Error ? err.message : 'Không thể đồng bộ lên Google Drive.');
        } finally {
          setIsDriveBusy(false);
          setDriveProgressText('');
        }
      }
    } else {
      setSyncStatus('Đã tắt tự động đồng bộ lên Google Drive.');
    }
  };

  // Section 2a: Upload Collections -> sáchlazy/<Tên bộ sưu tập>/
  const handleStartUploadCollections = async () => {
    if (selectedUploadColIds.length === 0) {
      setSyncError('Vui lòng chọn ít nhất 1 bộ sưu tập để tải lên Google Drive.');
      return;
    }
    setSyncError('');
    setSyncStatus('');
    setIsDriveBusy(true);
    setDriveProgressText('Đang kiểm tra thư mục sáchlazy và trùng lặp tệp trên Google Drive...');
    try {
      const token = await ensureDriveToken();
      const plan = await scanUploadCollectionsPlan(token, books, collections, selectedUploadColIds);
      if (plan.allItems.length === 0) {
        setSyncError('Không có sách nào trong các bộ sưu tập đã chọn.');
        return;
      }
      if (plan.duplicates.length > 0) {
        setPendingUploadPlan(plan);
        return;
      }
      const res = await executePlannedUploads(token, plan, 'overwrite', books, readingLogs, (m) =>
        setDriveProgressText(m)
      );
      setSyncStatus(
        `Hoàn tất tải bộ sưu tập lên Google Drive (sáchlazy): đã tải ${res.uploadedCount} sách mới & cập nhật tiến độ.`
      );
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Lỗi tải bộ sưu tập lên Google Drive.');
    } finally {
      setIsDriveBusy(false);
      setDriveProgressText('');
    }
  };

  // Section 2b: Upload Single Books -> sáchlazy/sách lẻ/
  const handleStartUploadSingleBooks = async () => {
    const picked = books.filter((b) => selectedUploadBookIds.includes(b.id));
    if (picked.length === 0) {
      setSyncError('Vui lòng chọn ít nhất 1 cuốn sách để tải vào thư mục sách lẻ.');
      return;
    }
    setSyncError('');
    setSyncStatus('');
    setIsDriveBusy(true);
    setDriveProgressText(
      `Đang kiểm tra thư mục ${DRIVE_ROOT_FOLDER}/${DRIVE_SINGLE_BOOKS_FOLDER} trên Google Drive...`
    );
    try {
      const token = await ensureDriveToken();
      const plan = await scanUploadSingleBooksPlan(token, picked);
      if (plan.duplicates.length > 0) {
        setPendingUploadPlan(plan);
        return;
      }
      const res = await executePlannedUploads(token, plan, 'overwrite', books, readingLogs, (m) =>
        setDriveProgressText(m)
      );
      setSyncStatus(
        `Đã tải ${res.uploadedCount} sách lẻ lên ${DRIVE_ROOT_FOLDER}/${DRIVE_SINGLE_BOOKS_FOLDER} & cập nhật tiến độ đọc.`
      );
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Lỗi tải sách lẻ lên Google Drive.');
    } finally {
      setIsDriveBusy(false);
      setDriveProgressText('');
    }
  };

  const handleConfirmPendingUpload = async (action: 'overwrite' | 'skip') => {
    if (!pendingUploadPlan) return;
    const planToRun = pendingUploadPlan;
    setPendingUploadPlan(null);
    setSyncError('');
    setSyncStatus('');
    setIsDriveBusy(true);
    setDriveProgressText('Đang tải sách lên Google Drive...');
    try {
      const token = await ensureDriveToken();
      const res = await executePlannedUploads(
        token,
        planToRun,
        action,
        books,
        readingLogs,
        (m) => setDriveProgressText(m)
      );
      setSyncStatus(
        `Tải lên Google Drive hoàn tất: ${res.uploadedCount} tệp mới, ${res.overwrittenCount} tệp đã ghi đè, ${res.skippedCount} tệp bỏ qua.`
      );
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Lỗi khi tải sách lên Google Drive.');
    } finally {
      setIsDriveBusy(false);
      setDriveProgressText('');
    }
  };

  // Section 3: Inspect Drive folder `sáchlazy`
  const handleInspectDrive = async () => {
    setSyncError('');
    setSyncStatus('');
    setIsInspectingDrive(true);
    try {
      const token = await ensureDriveToken();
      const info = await inspectDriveLibraryContents(token);
      setDriveRootFolderId(info.rootFolderId);
      setDriveCollections(info.collections);
      setDriveSingleBooks(info.singleBooks);
      setHasDriveProgressFile(info.hasProgressFile);
      setSelectedDriveColIds(info.collections.map((c) => c.folderId));
      setSelectedDriveFileIds(info.singleBooks.map((f) => f.id));
      setHasInspectedOnce(true);

      if (!info.rootFolderId) {
        setSyncStatus(
          `Chưa thấy thư mục "${DRIVE_ROOT_FOLDER}" trên Google Drive của tài khoản này. Bạn có thể up sách lên ở Mục 2 trước.`
        );
      } else {
        setSyncStatus(
          `Đã quét "${DRIVE_ROOT_FOLDER}": tìm thấy ${info.collections.length} bộ sưu tập và ${info.singleBooks.length} sách lẻ.`
        );
      }
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Không thể quét thư mục Google Drive.');
    } finally {
      setIsInspectingDrive(false);
    }
  };

  // Section 3a: Download selected Collections + auto-create matching collections
  const handleDownloadDriveCollections = async () => {
    if (!driveRootFolderId) {
      await handleInspectDrive();
      return;
    }
    const chosenFolders = driveCollections.filter((c) =>
      selectedDriveColIds.includes(c.folderId)
    );
    if (chosenFolders.length === 0) {
      setSyncError('Vui lòng chọn ít nhất 1 bộ sưu tập trên Google Drive để tải xuống.');
      return;
    }
    setSyncError('');
    setSyncStatus('');
    setIsDriveBusy(true);
    setDriveProgressText('Đang tải bộ sưu tập sách & tiến độ từ Google Drive...');
    try {
      const token = await ensureDriveToken();
      const { entries, progressBundle } = await downloadDriveCollections(
        token,
        driveRootFolderId,
        chosenFolders,
        (m) => setDriveProgressText(m)
      );
      const merged = mergeDownloadedDriveBooks(
        books,
        collections,
        entries,
        progressBundle,
        readingLogs
      );
      await onApplySyncedLibrary(
        merged.mergedBooks,
        merged.mergedLogs,
        merged.mergedCollections
      );
      setSyncStatus(
        `Đồng bộ Bộ sưu tập thành công: tải thêm ${merged.addedBooksCount} sách, tự tạo ${merged.createdCollectionsCount} bộ sưu tập cùng tên trên Drive và cập nhật tiến độ cho ${merged.updatedProgressCount} sách!`
      );
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Lỗi tải bộ sưu tập từ Google Drive.');
    } finally {
      setIsDriveBusy(false);
      setDriveProgressText('');
    }
  };

  // Section 3b: Download selected Single Books from sáchlazy/sách lẻ
  const handleDownloadDriveSingleBooks = async () => {
    if (!driveRootFolderId) {
      await handleInspectDrive();
      return;
    }
    const chosenFiles = driveSingleBooks.filter((f) => selectedDriveFileIds.includes(f.id));
    if (chosenFiles.length === 0) {
      setSyncError('Vui lòng chọn ít nhất 1 sách lẻ trên Google Drive để tải về.');
      return;
    }
    setSyncError('');
    setSyncStatus('');
    setIsDriveBusy(true);
    setDriveProgressText('Đang tải sách lẻ & tiến độ đọc từ Google Drive...');
    try {
      const token = await ensureDriveToken();
      const { entries, progressBundle } = await downloadDriveSingleBooks(
        token,
        driveRootFolderId,
        chosenFiles,
        (m) => setDriveProgressText(m)
      );
      const merged = mergeDownloadedDriveBooks(
        books,
        collections,
        entries,
        progressBundle,
        readingLogs
      );
      await onApplySyncedLibrary(
        merged.mergedBooks,
        merged.mergedLogs,
        merged.mergedCollections
      );
      setSyncStatus(
        `Đã tải về ${merged.addedBooksCount} sách lẻ từ Google Drive và đồng bộ tiến độ cho ${merged.updatedProgressCount} sách!`
      );
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Lỗi tải sách lẻ từ Google Drive.');
    } finally {
      setIsDriveBusy(false);
      setDriveProgressText('');
    }
  };

  // Local offline export / import helpers
  const handleExportProgressOnly = () => {
    const bundle = buildSyncBackupBundle(books, readingLogs, {
      includeFullBooks: false,
      deviceLabel: 'LaziRead',
    });
    const blob = new Blob([JSON.stringify(bundle, null, 2)], {
      type: 'application/json',
    });
    const dateTag = new Date().toISOString().slice(0, 10);
    downloadBlob(blob, `laziread-tien-do-${dateTag}.lazisync.json`);
    setSyncError('');
    setSyncStatus(
      `Đã xuất gói tiến độ đọc của ${books.length} cuốn sách (${readingLogs.length} ngày đọc).`
    );
  };

  const handleExportFullBackup = () => {
    const bundle = buildSyncBackupBundle(books, readingLogs, {
      includeFullBooks: true,
      deviceLabel: 'LaziRead Full',
    });
    const blob = new Blob([JSON.stringify(bundle, null, 2)], {
      type: 'application/json',
    });
    const dateTag = new Date().toISOString().slice(0, 10);
    downloadBlob(blob, `laziread-full-backup-${dateTag}.lazisync.json`);
    setSyncError('');
    setSyncStatus(
      `Đã xuất bản sao lưu đầy đủ gồm ${books.length} cuốn sách và toàn bộ tiến độ đọc.`
    );
  };

  const handleImportSyncBundle = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setSyncError('');
    setSyncStatus('');
    try {
      const txt = await readFileAsText(files[0]);
      const parsed = JSON.parse(txt) as SyncBackupBundle;
      if (!parsed || !Array.isArray(parsed.progressRecords)) {
        throw new Error('Tệp đồng bộ không đúng định dạng .lazisync.json.');
      }
      setLoadedBundle(parsed);
      const mergeRes = mergeSyncBundleIntoLibrary(books, parsed);
      const combinedLogs = mergeReadingLogs(readingLogs, parsed.readingLogs || []);
      await onApplySyncedLibrary(mergeRes.mergedBooks, combinedLogs);
      setSyncStatus(
        `Đồng bộ tệp thành công: cập nhật tiến độ cho ${mergeRes.matchedProgressCount} sách khớp nội dung và thêm ${mergeRes.importedNewBooksCount} sách mới.`
      );
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Không thể đọc tệp đồng bộ.');
    }
  };

  const handleMatchBookFileAndSync = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setSyncError('');
    setSyncStatus('');
    setIsMatchingFile(true);
    try {
      const file = files[0];
      const lower = file.name.toLowerCase();
      let draftBook: Book | null = null;
      if (lower.endsWith('.epub')) {
        const buf = await readFileAsArrayBuffer(file);
        const parsed = await parseEpubBuffer(buf, file.name);
        draftBook = {
          ...parsed,
          id: `book-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          addedAt: Date.now(),
          lastReadAt: Date.now(),
        };
      } else if (lower.endsWith('.pdf')) {
        const buf = await readFileAsArrayBuffer(file);
        const { bookDraft } = await parsePdfBufferToBook(buf, file.name);
        draftBook = {
          ...bookDraft,
          id: `book-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          addedAt: Date.now(),
          lastReadAt: Date.now(),
        };
      } else {
        throw new Error('Vui lòng chọn tệp .epub hoặc .pdf y hệt bản đã đọc ở máy cũ.');
      }

      const fp = computeBookFingerprint(draftBook);
      draftBook.fingerprint = fp;

      const snapFromBundle = loadedBundle?.progressRecords.find((r) => r.fingerprint === fp);
      const existingMatch = books.find((b) => (b.fingerprint || computeBookFingerprint(b)) === fp);

      if (snapFromBundle) {
        const syncedBook: Book = {
          ...draftBook,
          currentChapterIndex: snapFromBundle.currentChapterIndex,
          currentParagraphIndex: snapFromBundle.currentParagraphIndex,
          currentSentenceIndex: snapFromBundle.currentSentenceIndex,
          progressPercent: snapFromBundle.progressPercent,
          bookmarks: snapFromBundle.bookmarks || [],
          highlights: snapFromBundle.highlights || [],
          collection: snapFromBundle.collection || draftBook.collection,
          readingStyle: snapFromBundle.readingStyle || draftBook.readingStyle,
          lastReadAt: snapFromBundle.lastReadAt,
        };
        const updatedList = existingMatch
          ? books.map((b) => (b.id === existingMatch.id ? { ...syncedBook, id: existingMatch.id } : b))
          : [syncedBook, ...books];
        await onApplySyncedLibrary(updatedList, readingLogs);
        setSyncStatus(
          `Đã nhận diện sách "${syncedBook.title}" (Mã ${fp}) và khôi phục tiến độ ${syncedBook.progressPercent}%!`
        );
      } else if (existingMatch) {
        setSyncStatus(
          `Tệp "${file.name}" khớp với sách "${existingMatch.title}" đang có trong tủ (${existingMatch.progressPercent}%).`
        );
      } else {
        await onApplySyncedLibrary([draftBook, ...books], readingLogs);
        setSyncStatus(
          `Đã nhập "${draftBook.title}" (Mã ${fp}). Nhập thêm gói .lazisync.json để tự khớp tiến độ.`
        );
      }
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Lỗi kiểm tra khớp tệp sách.');
    } finally {
      setIsMatchingFile(false);
    }
  };

  // Language pack manager handlers
  const handleDownloadPack = async (code: string) => {
    setDownloadingPackCode(code);
    setPackMessage('');
    try {
      const pack = await downloadLanguagePackToApp(code, (_pct, msg) => setPackMessage(msg));
      setInstalledPacks((prev) => ({ ...prev, [pack.code]: pack }));
      setPackMessage(`Đã cài gói ngôn ngữ ${pack.label} vào ứng dụng.`);
    } catch (err) {
      setPackMessage(err instanceof Error ? err.message : 'Lỗi tải gói ngôn ngữ.');
    } finally {
      setDownloadingPackCode(null);
    }
  };

  const handleRemovePack = (code: string) => {
    const next = removeInstalledLanguagePack(code);
    setInstalledPacks(next);
    setPackMessage(`Đã gỡ gói ngôn ngữ ${code.toUpperCase()} khỏi bộ nhớ đệm.`);
  };

  const formattedLastAutoSync = lastAutoSyncAt
    ? new Date(lastAutoSyncAt).toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-4 sm:pt-8 sm:pb-5 space-y-6 overflow-x-hidden">
      <header className="pb-4 border-b border-stone-200 dark:border-stone-800 text-center">
        <h1 className="text-2xl sm:text-3xl font-display font-semibold tracking-tight text-stone-900 dark:text-stone-100">
          Cài đặt
        </h1>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: Basic E-Reader Settings + In-App Language Packs */}
        <div className="lg:col-span-5 space-y-6 min-w-0">
          <section
            id="settings-basic"
            className="scroll-mt-20 border border-stone-200 dark:border-stone-800 rounded-2xl bg-white dark:bg-[#16181C] p-5 sm:p-6 space-y-5"
          >
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-amber-800 dark:text-amber-400 shrink-0" />
              <h2 className="text-base font-semibold">Đọc sách cơ bản</h2>
            </div>

            <div className="space-y-2">
              <span className="block text-xs font-medium text-stone-600 dark:text-stone-400">
                Giao diện ứng dụng
              </span>
              <div
                ref={themeBarRef}
                className="relative grid grid-cols-3 gap-1.5 p-1 rounded-[22px] ios-liquid-bar border border-white/75 dark:border-zinc-700/60"
              >
                <LiquidDropThumb
                  thumb={themeThumb}
                  isGliding={themeGliding}
                  roundedClass="rounded-[18px]"
                />
                {(
                  [
                    { id: 'light', label: 'Sáng giấy', icon: Sun },
                    { id: 'dark', label: 'Tối dịu', icon: Moon },
                    { id: 'amoled', label: 'AMOLED Đen', icon: Smartphone },
                  ] as const
                ).map((item) => {
                  const Icon = item.icon;
                  const active = basicSettings.uiTheme === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-liquid-key={item.id}
                      onClick={() => onUpdateBasicSettings({ uiTheme: item.id })}
                      className={`relative z-10 ios-liquid-pill min-w-0 flex flex-col items-center justify-center gap-1 py-2.5 px-1.5 rounded-[18px] text-[11px] font-medium min-h-[54px] text-center leading-tight ${
                        active
                          ? 'text-amber-800 dark:text-amber-300 font-semibold'
                          : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-medium text-stone-600 dark:text-stone-400">
                Văn phong đọc AI mặc định khi mở sách mới
              </label>
              <select
                value={basicSettings.defaultReadingStyle}
                onChange={(e) =>
                  onUpdateBasicSettings({
                    defaultReadingStyle: e.target.value as BookReadingStyle,
                  })
                }
                className="w-full px-3 py-2.5 text-xs rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900"
              >
                <option value="novel">Tiểu thuyết (Nhân vật đa cảm xúc)</option>
                <option value="selfhelp">Văn phong học tập (Nhấn nhá điểm quan trọng)</option>
                <option value="essay">Tản văn (Nhẹ nhàng, truyền cảm hứng)</option>
                <option value="research">Nghiên cứu (Mạch lạc, chuẩn xác)</option>
              </select>
            </div>

            <div className="space-y-3 pt-2 border-t border-stone-100 dark:border-stone-800 text-xs">
              <label className="flex items-center justify-between gap-3 cursor-pointer py-1">
                <span>Chạm cạnh trái / phải để lật trang</span>
                <input
                  type="checkbox"
                  checked={basicSettings.tapToTurnPage}
                  onChange={(e) =>
                    onUpdateBasicSettings({ tapToTurnPage: e.target.checked })
                  }
                  className="w-4 h-4 accent-amber-800 shrink-0"
                />
              </label>

              <label className="flex items-center justify-between gap-3 cursor-pointer py-1">
                <span>Giữ màn hình luôn sáng khi đọc</span>
                <input
                  type="checkbox"
                  checked={basicSettings.keepScreenAwake}
                  onChange={(e) =>
                    onUpdateBasicSettings({ keepScreenAwake: e.target.checked })
                  }
                  className="w-4 h-4 accent-amber-800 shrink-0"
                />
              </label>

              <label className="flex items-center justify-between gap-3 cursor-pointer py-1">
                <span>Tự mở sách đang đọc dở khi vào app</span>
                <input
                  type="checkbox"
                  checked={basicSettings.autoResumeLastBook}
                  onChange={(e) =>
                    onUpdateBasicSettings({ autoResumeLastBook: e.target.checked })
                  }
                  className="w-4 h-4 accent-amber-800 shrink-0"
                />
              </label>
            </div>
          </section>

          {/* App Theme Color & Non-Reader Background Wallpaper */}
          <section
            id="settings-appearance"
            className="scroll-mt-20 border border-stone-200 dark:border-stone-800 rounded-2xl bg-white dark:bg-[#16181C] p-5 sm:p-6 space-y-5"
          >
            <div className="flex items-center gap-2">
              <Palette className="w-4 h-4 text-amber-800 dark:text-amber-400 shrink-0" />
              <h2 className="text-base font-semibold">Màu giao diện &amp; Ảnh nền</h2>
            </div>

            {/* Accent Color Swatches + Custom Color Picker */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-stone-600 dark:text-stone-400">
                  Màu chủ đạo giao diện
                </span>
                <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-stone-600 dark:text-stone-300 cursor-pointer">
                  <span>Tự chọn màu</span>
                  <input
                    type="color"
                    aria-label="Chọn màu giao diện tùy chỉnh"
                    value={basicSettings.uiCustomAccentHex || '#0369A1'}
                    onChange={(e) =>
                      onUpdateBasicSettings({
                        uiAccent: 'custom',
                        uiCustomAccentHex: e.target.value,
                      })
                    }
                    className="w-6 h-6 rounded-md border border-stone-300 dark:border-stone-700 bg-transparent cursor-pointer"
                  />
                </label>
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                {APP_COLOR_PALETTES.map((palette) => {
                  const active = (basicSettings.uiAccent || 'amber') === palette.id;
                  return (
                    <button
                      key={palette.id}
                      type="button"
                      onClick={() => {
                        onUpdateBasicSettings({ uiAccent: palette.id });
                        triggerDeviceHaptic('tap', basicSettings.hapticFeedback !== false);
                      }}
                      title={palette.name}
                      aria-label={`Đổi màu giao diện ${palette.name}`}
                      className={`flex flex-col items-center gap-1 p-1.5 rounded-xl border transition-all ${
                        active
                          ? 'border-amber-800 dark:border-amber-400 bg-stone-100/80 dark:bg-stone-800/80'
                          : 'border-stone-200 dark:border-stone-800 hover:border-stone-400'
                      }`}
                    >
                      <span
                        style={{ backgroundColor: palette.swatch }}
                        className="w-6 h-6 rounded-full flex items-center justify-center text-white shadow-xs"
                      >
                        {active && <Check className="w-3.5 h-3.5" />}
                      </span>
                      <span className="text-[10px] leading-tight text-center truncate w-full text-stone-700 dark:text-stone-300">
                        {palette.name.split(' ')[0]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Wallpaper Selector (Strictly disabled in Reader mode) */}
            <div className="space-y-3 pt-3 border-t border-stone-100 dark:border-stone-800">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-stone-900 dark:text-stone-100">
                    <ImageIcon className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400 shrink-0" />
                    <span>Ảnh nền giao diện ứng dụng</span>
                  </div>
                  <p className="text-[11px] text-stone-500 mt-0.5 leading-snug">
                    Chỉ hiển thị ở Thư viện, Cộng đồng, Studio &amp; Cài đặt.{' '}
                    <strong className="text-stone-700 dark:text-stone-300">
                      Lúc đọc sách sẽ tự ẩn hoàn toàn
                    </strong>{' '}
                    để bảo vệ mắt.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2.5">
                {APP_WALLPAPER_PRESETS.map((preset) => {
                  const active = (basicSettings.uiWallpaperPreset || 'none') === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => {
                        onUpdateBasicSettings({ uiWallpaperPreset: preset.id });
                        triggerDeviceHaptic('tap', basicSettings.hapticFeedback !== false);
                      }}
                      className={`group flex flex-col items-center gap-1.5 text-center min-w-0 ${
                        active ? 'font-semibold' : ''
                      }`}
                    >
                      <span
                        style={{ background: preset.previewCss }}
                        className={`relative w-full aspect-[3/4] rounded-xl border-2 overflow-hidden flex items-center justify-center transition-all ${
                          active
                            ? 'border-amber-800 dark:border-amber-400 ring-2 ring-amber-800/20'
                            : 'border-stone-200 dark:border-stone-700 group-hover:border-stone-400'
                        }`}
                      >
                        {preset.dataUrl && (
                          <img
                            src={preset.dataUrl}
                            alt={preset.name}
                            loading="lazy"
                            className="absolute inset-0 w-full h-full object-cover scale-110 transition-transform duration-300 group-hover:scale-115"
                          />
                        )}
                        {active && (
                          <span className="relative z-10 w-5 h-5 rounded-full bg-stone-900/80 text-white flex items-center justify-center shadow-sm">
                            <Check className="w-3 h-3" />
                          </span>
                        )}
                      </span>
                      <span className="text-[10px] text-stone-700 dark:text-stone-300 leading-tight line-clamp-2 w-full">
                        {preset.name}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={wallpaperInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleUploadWallpaperPhoto(e.target.files)}
                />
                <button
                  type="button"
                  disabled={isUploadingWallpaper}
                  onClick={() => wallpaperInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-xs font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {isUploadingWallpaper ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5" />
                  )}
                  <span>Chọn ảnh nền từ điện thoại</span>
                </button>

                {((basicSettings.uiWallpaperPreset && basicSettings.uiWallpaperPreset !== 'none') ||
                  customWallpaperDataUrl) && (
                  <button
                    type="button"
                    onClick={handleClearWallpaper}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-stone-300 dark:border-stone-700 text-xs font-medium text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Gỡ ảnh nền</span>
                  </button>
                )}
              </div>

              {basicSettings.uiWallpaperPreset && basicSettings.uiWallpaperPreset !== 'none' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 text-[11px]">
                  <label className="space-y-1">
                    <div className="flex justify-between text-stone-600 dark:text-stone-400">
                      <span>Độ mờ ảnh nền</span>
                      <span className="tabular-nums font-medium">
                        {basicSettings.uiWallpaperBlur ?? 3}px
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={20}
                      step={1}
                      value={basicSettings.uiWallpaperBlur ?? 3}
                      onChange={(e) =>
                        onUpdateBasicSettings({ uiWallpaperBlur: Number(e.target.value) })
                      }
                      className="w-full accent-amber-800"
                    />
                  </label>
                  <label className="space-y-1">
                    <div className="flex justify-between text-stone-600 dark:text-stone-400">
                      <span>Độ phủ dịu nền (nhìn xuyên thẻ)</span>
                      <span className="tabular-nums font-medium">
                        {basicSettings.uiWallpaperOverlay ?? 28}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={5}
                      max={80}
                      step={5}
                      value={basicSettings.uiWallpaperOverlay ?? 28}
                      onChange={(e) =>
                        onUpdateBasicSettings({ uiWallpaperOverlay: Number(e.target.value) })
                      }
                      className="w-full accent-amber-800"
                    />
                  </label>
                </div>
              )}

              {wallpaperFeedback && (
                <p className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
                  {wallpaperFeedback}
                </p>
              )}
            </div>
          </section>

          {/* Standalone On-Device Phone Hardware Controls */}
          <section
            id="settings-hardware"
            className="scroll-mt-20 border border-stone-200 dark:border-stone-800 rounded-2xl bg-white dark:bg-[#16181C] p-5 sm:p-6 space-y-4"
          >
            <div className="flex items-center justify-between gap-2 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <Cpu className="w-4 h-4 text-amber-800 dark:text-amber-400 shrink-0" />
                <h2 className="text-base font-semibold truncate">Chạy độc lập &amp; Phần cứng</h2>
              </div>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 whitespace-nowrap shrink-0">
                Offline-first
              </span>
            </div>

            <p className="text-xs text-stone-600 dark:text-stone-400 leading-relaxed">
              Ưu tiên dùng trực tiếp CPU, Web Audio DSP, bộ nhớ máy, rung xúc giác, phím cứng &amp; giọng đọc hệ thống trên điện thoại để chạy độc lập không cần máy chủ.
            </p>

            <div className="space-y-2.5 text-xs">
              <label className="flex items-center justify-between gap-3 cursor-pointer py-1">
                <span>Chế độ chạy độc lập trên thiết bị (ưu tiên offline)</span>
                <input
                  type="checkbox"
                  checked={basicSettings.standaloneDeviceMode !== false}
                  onChange={(e) =>
                    onUpdateBasicSettings({ standaloneDeviceMode: e.target.checked })
                  }
                  className="w-4 h-4 accent-amber-800 shrink-0"
                />
              </label>

              <label className="flex items-center justify-between gap-3 cursor-pointer py-1">
                <span className="inline-flex items-center gap-1.5">
                  <Vibrate className="w-3.5 h-3.5 text-stone-500 shrink-0" />
                  <span>Rung xúc giác phần cứng khi lật trang &amp; thao tác</span>
                </span>
                <input
                  type="checkbox"
                  checked={basicSettings.hapticFeedback !== false}
                  onChange={(e) => {
                    onUpdateBasicSettings({ hapticFeedback: e.target.checked });
                    if (e.target.checked) triggerDeviceHaptic('tap', true);
                  }}
                  className="w-4 h-4 accent-amber-800 shrink-0"
                />
              </label>

              <label className="flex items-center justify-between gap-3 cursor-pointer py-1">
                <span>Dùng phím Âm lượng / PageUp-Down để lật trang</span>
                <input
                  type="checkbox"
                  checked={basicSettings.volumeKeyPageTurn !== false}
                  onChange={(e) =>
                    onUpdateBasicSettings({ volumeKeyPageTurn: e.target.checked })
                  }
                  className="w-4 h-4 accent-amber-800 shrink-0"
                />
              </label>
            </div>

            {hardwareInfo && (
              <div className="p-3.5 rounded-xl bg-stone-50 dark:bg-stone-900/60 border border-stone-200 dark:border-stone-800 space-y-2.5 text-[11px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-stone-800 dark:text-stone-200 flex items-center gap-1.5">
                    <HardDrive className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400" />
                    <span>Phần cứng thiết bị hiện tại</span>
                  </span>
                  <button
                    type="button"
                    disabled={isPersistingStorage}
                    onClick={handleProtectStorage}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-stone-300 dark:border-stone-700 text-[10px] font-medium hover:bg-white dark:hover:bg-stone-800"
                  >
                    <ShieldCheck className="w-3 h-3 text-emerald-600" />
                    <span>
                      {hardwareInfo.storagePersisted ? 'Bộ nhớ đã bảo vệ' : 'Bảo vệ bộ nhớ máy'}
                    </span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 text-stone-600 dark:text-stone-400">
                  <div>
                    CPU: <strong className="text-stone-900 dark:text-stone-100">{hardwareInfo.cpuCores} nhân</strong>
                  </div>
                  <div>
                    Web Audio DSP:{' '}
                    <strong className="text-stone-900 dark:text-stone-100">
                      {hardwareInfo.hasWebAudio ? 'Sẵn sàng' : 'Không hỗ trợ'}
                    </strong>
                  </div>
                  <div>
                    Giọng TTS máy:{' '}
                    <strong className="text-stone-900 dark:text-stone-100">
                      {hardwareInfo.installedSpeechVoices} giọng
                    </strong>
                  </div>
                  <div>
                    Giữ sáng (WakeLock):{' '}
                    <strong className="text-stone-900 dark:text-stone-100">
                      {hardwareInfo.hasWakeLock ? 'Có' : 'Trình duyệt cũ'}
                    </strong>
                  </div>
                  <div className="col-span-2">
                    Bộ nhớ offline:{' '}
                    <strong className="text-stone-900 dark:text-stone-100 tabular-nums">
                      {hardwareInfo.storageUsedMb !== null
                        ? `${hardwareInfo.storageUsedMb} MB đã dùng`
                        : 'IndexedDB sẵn sàng'}
                      {hardwareInfo.storageQuotaMb ? ` / ${hardwareInfo.storageQuotaMb} MB` : ''}
                    </strong>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Downloadable In-App Language Packs Manager */}
          <section
            id="settings-language-packs"
            className="scroll-mt-20 border border-stone-200 dark:border-stone-800 rounded-2xl bg-white dark:bg-[#16181C] p-5 sm:p-6 space-y-4"
          >
            <div className="flex items-center justify-between gap-2 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <Languages className="w-4 h-4 text-amber-800 dark:text-amber-400 shrink-0" />
                <h2 className="text-base font-semibold truncate">Gói ngôn ngữ dịch</h2>
              </div>
              <span className="text-[11px] font-medium text-stone-500 shrink-0 tabular-nums whitespace-nowrap">
                {Object.keys(installedPacks).length}/{LANGUAGE_PACK_CATALOG.length} gói
              </span>
            </div>
            <p className="text-xs text-stone-600 dark:text-stone-400 leading-relaxed">
              Tải sẵn gói ngôn ngữ vào LaziRead để tăng tốc dịch chương &amp; AI dịch toàn bộ sách ghi đè thành tệp <strong>.EPUB</strong> chuẩn văn học.
            </p>

            <div className="space-y-2">
              {LANGUAGE_PACK_CATALOG.map((pack) => {
                const installed = Boolean(installedPacks[pack.code]);
                const isBusy = downloadingPackCode === pack.code;
                return (
                  <div
                    key={pack.code}
                    className="flex items-center justify-between gap-3 p-3 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-900/50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-semibold text-stone-900 dark:text-stone-100">
                          {pack.label}
                        </span>
                        <span className="text-[10px] text-stone-500">· {pack.sizeLabel}</span>
                      </div>
                      <p className="text-[11px] text-stone-500 line-clamp-2 mt-0.5 leading-snug">
                        {pack.description}
                      </p>
                    </div>

                    {installed ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 text-[10px] font-semibold">
                          <PackageCheck className="w-3 h-3" />
                          <span>Đã tải</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemovePack(pack.code)}
                          aria-label={`Gỡ gói ngôn ngữ ${pack.label}`}
                          className="p-1.5 rounded-lg text-stone-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={Boolean(downloadingPackCode)}
                        onClick={() => handleDownloadPack(pack.code)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-[11px] font-medium hover:opacity-90 disabled:opacity-50 shrink-0"
                      >
                        {isBusy ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Download className="w-3.5 h-3.5" />
                        )}
                        <span>{isBusy ? 'Đang tải...' : 'Tải vào app'}</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {packMessage && (
              <p className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
                {packMessage}
              </p>
            )}
          </section>
        </div>

        {/* RIGHT COLUMN: Google Drive Account + 3 Requested Sync Sections */}
        <section className="lg:col-span-7 border border-stone-200 dark:border-stone-800 rounded-2xl bg-white dark:bg-[#16181C] p-5 sm:p-6 space-y-5 min-w-0">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-amber-800 dark:text-amber-400 shrink-0" />
            <h2 className="text-base font-semibold">Đồng bộ Google Drive</h2>
          </div>

          {/* 0. GOOGLE DRIVE SIGN-IN CARD (Customer logs into their own Drive independently) */}
          <div
            id="sync-google-drive"
            className="scroll-mt-20 p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/80 dark:bg-stone-900/60 space-y-3"
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Cloud className="w-4 h-4 text-amber-800 dark:text-amber-400 shrink-0" />
                <span className="text-xs font-semibold text-stone-900 dark:text-stone-100">
                  Tài khoản Google Drive cá nhân
                </span>
              </div>
              {driveAuth.isConnected && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                  <UserCheck className="w-3.5 h-3.5" />
                  <span>Đã kết nối</span>
                </span>
              )}
            </div>

            {driveAuth.isConnected && driveAuth.user ? (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-3 min-w-0">
                  {driveAuth.user.photoURL ? (
                    <img
                      src={driveAuth.user.photoURL}
                      alt={driveAuth.user.displayName || 'Google Avatar'}
                      referrerPolicy="no-referrer"
                      className="w-9 h-9 rounded-full border border-stone-200 dark:border-stone-700 shrink-0 object-cover"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-amber-800 text-white flex items-center justify-center text-xs font-bold shrink-0">
                      {(driveAuth.user.displayName || driveAuth.user.email || 'G')[0].toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-semibold truncate">
                      {driveAuth.user.displayName || 'Người dùng Google'}
                    </div>
                    <div className="text-[11px] text-stone-500 truncate">
                      {driveAuth.user.email}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  <button
                    type="button"
                    disabled={isAuthBusy}
                    onClick={handleGoogleDriveSignIn}
                    className="px-3 py-1.5 rounded-lg border border-stone-300 dark:border-stone-700 text-[11px] font-medium hover:bg-stone-100 dark:hover:bg-stone-800"
                  >
                    Đổi tài khoản
                  </button>
                  <button
                    type="button"
                    disabled={isAuthBusy}
                    onClick={handleGoogleDriveSignOut}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-900/60 text-red-700 dark:text-red-400 text-[11px] font-medium hover:bg-red-50 dark:hover:bg-red-950/30"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Đăng xuất</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                <p className="text-[11px] text-stone-600 dark:text-stone-400 leading-relaxed">
                  Mỗi người dùng tự đăng nhập tài khoản Google Drive riêng của mình để lưu &amp; nhận sách trong thư mục <strong>{DRIVE_ROOT_FOLDER}</strong>. LaziRead chỉ truy cập các tệp do ứng dụng tạo ra.
                </p>
                <button
                  type="button"
                  disabled={isAuthBusy}
                  onClick={handleGoogleDriveSignIn}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-xl bg-white hover:bg-stone-50 text-stone-800 border border-stone-300 shadow-xs text-xs font-semibold transition-colors min-h-[42px]"
                >
                  {isAuthBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin text-stone-600" />
                  ) : (
                    <GoogleLogoSvg />
                  )}
                  <span>
                    {isAuthBusy ? 'Đang mở đăng nhập Google...' : 'Đăng nhập với Google Drive'}
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* MỤC 1: GẠT BẬT / TẮT TỰ ĐỘNG ĐỒNG BỘ LÊN GOOGLE DRIVE */}
          <div
            id="sync-auto"
            className="scroll-mt-20 p-4 rounded-xl border border-stone-200 dark:border-stone-800 space-y-2"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-stone-900 dark:text-stone-100">
                  1. Tự động đồng bộ tiến độ lên Google Drive
                </div>
                <p className="text-[11px] text-stone-500 mt-0.5 leading-snug">
                  Tự động lưu vị trí chương, trang đang đọc, đánh dấu &amp; ghi chú vào{' '}
                  <strong>{DRIVE_ROOT_FOLDER}</strong> khi bạn đọc sách.
                </p>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={Boolean(basicSettings.autoSyncGoogleDrive)}
                aria-label="Bật tắt tự động đồng bộ lên Google Drive"
                onClick={handleToggleAutoSync}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                  basicSettings.autoSyncGoogleDrive
                    ? 'bg-amber-800 dark:bg-amber-600'
                    : 'bg-stone-300 dark:bg-stone-700'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                    basicSettings.autoSyncGoogleDrive ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {basicSettings.autoSyncGoogleDrive && (
              <div className="text-[11px] text-amber-800 dark:text-amber-300 flex items-center gap-1.5 pt-0.5">
                {isAutoSyncing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                    <span>Đang tự động đồng bộ tiến độ lên Google Drive...</span>
                  </>
                ) : driveAuth.isConnected ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>
                      Đang bật tự động đồng bộ
                      {formattedLastAutoSync ? ` · Lần cuối lúc ${formattedLastAutoSync}` : ''}
                    </span>
                  </>
                ) : (
                  <span>Hãy đăng nhập Google Drive ở trên để tự động đồng bộ hoạt động.</span>
                )}
              </div>
            )}
          </div>

          {/* MỤC 2: TẢI SÁCH LÊN GOOGLE DRIVE THEO NHU CẦU & XUẤT TỆP */}
          <div
            id="sync-upload"
            className="scroll-mt-20 p-4 rounded-xl border border-stone-200 dark:border-stone-800 space-y-3.5"
          >
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-stone-900 dark:text-stone-100">
                <CloudUpload className="w-4 h-4 text-amber-800 dark:text-amber-400 shrink-0" />
                <span>2. Tải sách lên Google Drive &amp; Xuất tệp sao lưu</span>
              </div>
              <p className="text-[11px] text-stone-500 leading-snug">
                Chọn up theo Bộ sưu tập đã tạo trong Thư viện (<strong>{DRIVE_ROOT_FOLDER}/&lt;Tên bộ sưu tập&gt;</strong>) hoặc up từng sách lẻ (<strong>{DRIVE_ROOT_FOLDER}/{DRIVE_SINGLE_BOOKS_FOLDER}</strong>). Tự cảnh báo trước khi ghi đè tệp trùng.
              </p>
            </div>

            {/* Sub-tabs: Up Bộ sưu tập vs Up Sách lẻ */}
            <div className="grid grid-cols-2 p-1 rounded-xl bg-stone-100 dark:bg-stone-900 gap-1">
              <button
                type="button"
                onClick={() => setUploadSubTab('collections')}
                className={`py-2 px-2.5 rounded-lg text-xs font-medium transition-colors text-center leading-tight ${
                  uploadSubTab === 'collections'
                    ? 'bg-white dark:bg-stone-800 text-amber-800 dark:text-amber-300 shadow-xs font-semibold'
                    : 'text-stone-600 dark:text-stone-400'
                }`}
              >
                Up Bộ sưu tập ({collectionGroups.length})
              </button>
              <button
                type="button"
                onClick={() => setUploadSubTab('single')}
                className={`py-2 px-2.5 rounded-lg text-xs font-medium transition-colors text-center leading-tight ${
                  uploadSubTab === 'single'
                    ? 'bg-white dark:bg-stone-800 text-amber-800 dark:text-amber-300 shadow-xs font-semibold'
                    : 'text-stone-600 dark:text-stone-400'
                }`}
              >
                Up Sách lẻ ({books.length})
              </button>
            </div>

            {uploadSubTab === 'collections' ? (
              <div className="space-y-2.5">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    value={uploadColQuery}
                    onChange={(e) => setUploadColQuery(e.target.value)}
                    placeholder="Tìm kiếm bộ sưu tập để tải lên..."
                    aria-label="Tìm kiếm bộ sưu tập tải lên Drive"
                    className="w-full pl-8 pr-3 py-2 text-xs rounded-lg border border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-900/60 focus:outline-none focus:border-amber-700"
                  />
                </div>

                {collectionGroups.length === 0 ? (
                  <p className="text-xs text-stone-500 p-3 rounded-lg bg-stone-50 dark:bg-stone-900/50 leading-relaxed">
                    Bộ sưu tập trong Thư viện hiện đang trống. Hãy vào{' '}
                    <strong>Thư viện → Bộ sưu tập</strong> để tự tạo bộ sưu tập và thêm sách vào, hoặc chuyển sang tab <strong>Up Sách lẻ</strong>.
                  </p>
                ) : filteredUploadCollections.length === 0 ? (
                  <p className="text-xs text-stone-500 p-3 rounded-lg bg-stone-50 dark:bg-stone-900/50">
                    Không tìm thấy bộ sưu tập nào khớp với &ldquo;{uploadColQuery}&rdquo;.
                  </p>
                ) : (
                  <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1">
                    {filteredUploadCollections.map((group) => {
                      const checked = selectedUploadColIds.includes(group.collectionId);
                      return (
                        <label
                          key={group.collectionId}
                          className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-stone-200 dark:border-stone-800 cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-900/50 text-xs"
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedUploadColIds((prev) => [
                                    ...prev,
                                    group.collectionId,
                                  ]);
                                } else {
                                  setSelectedUploadColIds((prev) =>
                                    prev.filter((id) => id !== group.collectionId)
                                  );
                                }
                              }}
                              className="w-4 h-4 accent-amber-800 shrink-0"
                            />
                            <span className="font-medium truncate">
                              {DRIVE_ROOT_FOLDER}/{group.name}
                            </span>
                          </span>
                          <span className="text-[11px] text-stone-500 shrink-0">
                            {group.books.length} sách
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}

                <button
                  type="button"
                  disabled={isDriveBusy || collectionGroups.length === 0}
                  onClick={handleStartUploadCollections}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-800 hover:bg-amber-700 text-white text-xs font-semibold disabled:opacity-50 min-h-[42px]"
                >
                  {isDriveBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CloudUpload className="w-4 h-4" />
                  )}
                  <span>Up Bộ sưu tập đã chọn lên Google Drive</span>
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    value={uploadSingleQuery}
                    onChange={(e) => setUploadSingleQuery(e.target.value)}
                    placeholder="Tìm kiếm sách lẻ theo tên sách hoặc tác giả..."
                    aria-label="Tìm kiếm sách lẻ tải lên Drive"
                    className="w-full pl-8 pr-3 py-2 text-xs rounded-lg border border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-900/60 focus:outline-none focus:border-amber-700"
                  />
                </div>

                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-stone-500">
                    Đích: <strong>{DRIVE_ROOT_FOLDER}/{DRIVE_SINGLE_BOOKS_FOLDER}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const visibleIds = filteredUploadBooks.map((b) => b.id);
                      const allVisibleSelected =
                        visibleIds.length > 0 &&
                        visibleIds.every((id) => selectedUploadBookIds.includes(id));
                      if (allVisibleSelected) {
                        setSelectedUploadBookIds((prev) =>
                          prev.filter((id) => !visibleIds.includes(id))
                        );
                      } else {
                        setSelectedUploadBookIds((prev) =>
                          Array.from(new Set([...prev, ...visibleIds]))
                        );
                      }
                    }}
                    className="text-amber-800 dark:text-amber-400 font-medium hover:underline"
                  >
                    {filteredUploadBooks.length > 0 &&
                    filteredUploadBooks.every((b) => selectedUploadBookIds.includes(b.id))
                      ? 'Bỏ chọn tất cả'
                      : 'Chọn tất cả'}
                  </button>
                </div>

                {filteredUploadBooks.length === 0 ? (
                  <p className="text-xs text-stone-500 p-3 rounded-lg bg-stone-50 dark:bg-stone-900/50">
                    Không tìm thấy sách lẻ nào khớp với &ldquo;{uploadSingleQuery}&rdquo;.
                  </p>
                ) : (
                  <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1">
                    {filteredUploadBooks.map((book) => {
                      const checked = selectedUploadBookIds.includes(book.id);
                      return (
                        <label
                          key={book.id}
                          className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-stone-200 dark:border-stone-800 cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-900/50 text-xs"
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedUploadBookIds((prev) => [...prev, book.id]);
                                } else {
                                  setSelectedUploadBookIds((prev) =>
                                    prev.filter((id) => id !== book.id)
                                  );
                                }
                              }}
                              className="w-4 h-4 accent-amber-800 shrink-0"
                            />
                            <span className="truncate font-medium">{book.title}</span>
                          </span>
                          <span className="text-[10px] text-stone-500 shrink-0">
                            {book.progressPercent}%
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}

                <button
                  type="button"
                  disabled={isDriveBusy || selectedUploadBookIds.length === 0}
                  onClick={handleStartUploadSingleBooks}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-800 hover:bg-amber-700 text-white text-xs font-semibold disabled:opacity-50 min-h-[42px]"
                >
                  {isDriveBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}
                  <span>
                    Up {selectedUploadBookIds.length} sách vào &ldquo;{DRIVE_SINGLE_BOOKS_FOLDER}&rdquo;
                  </span>
                </button>
              </div>
            )}

            {/* Compact Local File Export Actions */}
            <div className="pt-3 border-t border-stone-100 dark:border-stone-800 space-y-2">
              <div className="text-[11px] font-medium text-stone-500">
                Xuất tệp sao lưu trực tiếp ra máy (Offline):
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleExportProgressOnly}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-300 dark:border-stone-700 text-[11px] font-medium hover:border-amber-700"
                >
                  <Download className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400" />
                  <span>Xuất tiến độ (.lazisync.json)</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportFullBackup}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-300 dark:border-stone-700 text-[11px] font-medium hover:border-amber-700"
                >
                  <HardDriveUpload className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400" />
                  <span>Xuất toàn bộ sách + tiến độ</span>
                </button>
                <input
                  ref={matchBookInputRef}
                  type="file"
                  accept=".epub,.pdf"
                  className="hidden"
                  onChange={(e) => handleMatchBookFileAndSync(e.target.files)}
                />
                <button
                  type="button"
                  disabled={isMatchingFile}
                  onClick={() => matchBookInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-300 dark:border-stone-700 text-[11px] font-medium hover:border-amber-700"
                >
                  <FileCheck2 className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400" />
                  <span>{isMatchingFile ? 'Đang khớp...' : 'Khớp file .EPUB/.PDF'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* MỤC 3: NHẬN TỆP SÁCH VÀ TIẾN ĐỘ TỪ GOOGLE DRIVE */}
          <div
            id="sync-download"
            className="scroll-mt-20 p-4 rounded-xl border border-stone-200 dark:border-stone-800 space-y-3.5"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-stone-900 dark:text-stone-100">
                  <CloudDownload className="w-4 h-4 text-amber-800 dark:text-amber-400 shrink-0" />
                  <span>3. Nhận tệp sách và tiến độ từ Google Drive</span>
                </div>
                <p className="text-[11px] text-stone-500 leading-snug">
                  Tự động tải sách từ <strong>{DRIVE_ROOT_FOLDER}</strong>, khôi phục tiến độ đọc và tự tạo Bộ sưu tập cùng tên trên máy mới.
                </p>
              </div>

              <button
                type="button"
                disabled={isInspectingDrive || isDriveBusy}
                onClick={handleInspectDrive}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-amber-800 text-amber-900 dark:text-amber-300 text-[11px] font-semibold hover:bg-amber-50 dark:hover:bg-amber-950/30 shrink-0"
              >
                {isInspectingDrive ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <FolderSync className="w-3.5 h-3.5" />
                )}
                <span>{isInspectingDrive ? 'Đang quét...' : 'Quét Google Drive'}</span>
              </button>
            </div>

            {/* Sub-tabs: Đồng bộ tải xuống Bộ sưu tập vs Tải xuống Sách lẻ */}
            <div className="grid grid-cols-2 p-1 rounded-xl bg-stone-100 dark:bg-stone-900 gap-1">
              <button
                type="button"
                onClick={() => setDownloadSubTab('collections')}
                className={`py-2 px-2.5 rounded-lg text-xs font-medium transition-colors text-center leading-tight ${
                  downloadSubTab === 'collections'
                    ? 'bg-white dark:bg-stone-800 text-amber-800 dark:text-amber-300 shadow-xs font-semibold'
                    : 'text-stone-600 dark:text-stone-400'
                }`}
              >
                Tải Bộ sưu tập ({driveCollections.length})
              </button>
              <button
                type="button"
                onClick={() => setDownloadSubTab('single')}
                className={`py-2 px-2.5 rounded-lg text-xs font-medium transition-colors text-center leading-tight ${
                  downloadSubTab === 'single'
                    ? 'bg-white dark:bg-stone-800 text-amber-800 dark:text-amber-300 shadow-xs font-semibold'
                    : 'text-stone-600 dark:text-stone-400'
                }`}
              >
                Tải Sách lẻ ({driveSingleBooks.length})
              </button>
            </div>

            {downloadSubTab === 'collections' ? (
              <div className="space-y-2.5">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    value={downloadColQuery}
                    onChange={(e) => setDownloadColQuery(e.target.value)}
                    placeholder="Tìm kiếm bộ sưu tập trên Google Drive..."
                    aria-label="Tìm kiếm bộ sưu tập tải từ Drive"
                    className="w-full pl-8 pr-3 py-2 text-xs rounded-lg border border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-900/60 focus:outline-none focus:border-amber-700"
                  />
                </div>

                {!hasInspectedOnce ? (
                  <p className="text-xs text-stone-500 p-3 rounded-lg bg-stone-50 dark:bg-stone-900/50 leading-relaxed">
                    Bấm <strong>Quét Google Drive</strong> để xem danh sách thư mục bộ sưu tập trong{' '}
                    <strong>{DRIVE_ROOT_FOLDER}</strong>, sau đó tải xuống và tự tạo Bộ sưu tập tương ứng trong Thư viện.
                  </p>
                ) : driveCollections.length === 0 ? (
                  <p className="text-xs text-stone-500 p-3 rounded-lg bg-stone-50 dark:bg-stone-900/50">
                    Chưa có thư mục bộ sưu tập nào trong <strong>{DRIVE_ROOT_FOLDER}</strong> trên Google Drive.
                  </p>
                ) : filteredDriveCollections.length === 0 ? (
                  <p className="text-xs text-stone-500 p-3 rounded-lg bg-stone-50 dark:bg-stone-900/50">
                    Không tìm thấy bộ sưu tập nào khớp với &ldquo;{downloadColQuery}&rdquo;.
                  </p>
                ) : (
                  <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1">
                    {filteredDriveCollections.map((folder) => {
                      const checked = selectedDriveColIds.includes(folder.folderId);
                      return (
                        <label
                          key={folder.folderId}
                          className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-stone-200 dark:border-stone-800 cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-900/50 text-xs"
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedDriveColIds((prev) => [...prev, folder.folderId]);
                                } else {
                                  setSelectedDriveColIds((prev) =>
                                    prev.filter((id) => id !== folder.folderId)
                                  );
                                }
                              }}
                              className="w-4 h-4 accent-amber-800 shrink-0"
                            />
                            <span className="font-medium truncate">{folder.name}</span>
                          </span>
                          <span className="text-[11px] text-stone-500 shrink-0">
                            {folder.files.length} sách .epub
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}

                <button
                  type="button"
                  disabled={isDriveBusy || isInspectingDrive}
                  onClick={handleDownloadDriveCollections}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-xs font-semibold hover:opacity-90 disabled:opacity-50 min-h-[42px]"
                >
                  {isDriveBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CloudDownload className="w-4 h-4" />
                  )}
                  <span>
                    {hasInspectedOnce
                      ? 'Tải xuống Bộ sưu tập & tự tạo thư mục'
                      : 'Quét & Đồng bộ tải xuống Bộ sưu tập'}
                  </span>
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    value={downloadSingleQuery}
                    onChange={(e) => setDownloadSingleQuery(e.target.value)}
                    placeholder="Tìm kiếm sách lẻ trên Google Drive..."
                    aria-label="Tìm kiếm sách lẻ tải từ Drive"
                    className="w-full pl-8 pr-3 py-2 text-xs rounded-lg border border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-900/60 focus:outline-none focus:border-amber-700"
                  />
                </div>

                {!hasInspectedOnce ? (
                  <p className="text-xs text-stone-500 p-3 rounded-lg bg-stone-50 dark:bg-stone-900/50 leading-relaxed">
                    Bấm <strong>Quét Google Drive</strong> để xem danh sách sách trong{' '}
                    <strong>{DRIVE_ROOT_FOLDER}/{DRIVE_SINGLE_BOOKS_FOLDER}</strong> và tải về máy.
                  </p>
                ) : driveSingleBooks.length === 0 ? (
                  <p className="text-xs text-stone-500 p-3 rounded-lg bg-stone-50 dark:bg-stone-900/50">
                    Chưa có file sách .epub nào trong{' '}
                    <strong>{DRIVE_ROOT_FOLDER}/{DRIVE_SINGLE_BOOKS_FOLDER}</strong>.
                  </p>
                ) : filteredDriveSingleBooks.length === 0 ? (
                  <p className="text-xs text-stone-500 p-3 rounded-lg bg-stone-50 dark:bg-stone-900/50">
                    Không tìm thấy sách lẻ nào khớp với &ldquo;{downloadSingleQuery}&rdquo;.
                  </p>
                ) : (
                  <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1">
                    {filteredDriveSingleBooks.map((file) => {
                      const checked = selectedDriveFileIds.includes(file.id);
                      return (
                        <label
                          key={file.id}
                          className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-stone-200 dark:border-stone-800 cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-900/50 text-xs"
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedDriveFileIds((prev) => [...prev, file.id]);
                                } else {
                                  setSelectedDriveFileIds((prev) =>
                                    prev.filter((id) => id !== file.id)
                                  );
                                }
                              }}
                              className="w-4 h-4 accent-amber-800 shrink-0"
                            />
                            <BookOpen className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400 shrink-0" />
                            <span className="truncate font-medium">{file.name}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}

                <button
                  type="button"
                  disabled={isDriveBusy || isInspectingDrive}
                  onClick={handleDownloadDriveSingleBooks}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-xs font-semibold hover:opacity-90 disabled:opacity-50 min-h-[42px]"
                >
                  {isDriveBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  <span>
                    {hasInspectedOnce
                      ? `Tải xuống ${selectedDriveFileIds.length} sách lẻ & Tiến độ`
                      : 'Quét & Tải xuống Sách lẻ từ Drive'}
                  </span>
                </button>
              </div>
            )}

            {hasDriveProgressFile && (
              <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                ✓ Đã phát hiện tệp tiến độ đọc trên Google Drive — sẽ tự động khớp trang đang đọc dở khi tải về.
              </p>
            )}

            {/* Offline .lazisync.json import */}
            <div className="pt-3 border-t border-stone-100 dark:border-stone-800 flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[11px] text-stone-500">Hoặc nhập tệp đồng bộ offline:</span>
              <div>
                <input
                  ref={syncFileInputRef}
                  type="file"
                  accept=".json,.lazisync.json"
                  className="hidden"
                  onChange={(e) => handleImportSyncBundle(e.target.files)}
                />
                <button
                  type="button"
                  onClick={() => syncFileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-300 dark:border-stone-700 text-[11px] font-medium hover:border-amber-700"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Nhập .lazisync.json</span>
                </button>
              </div>
            </div>
          </div>

          {/* Live Drive Operation Progress */}
          {driveProgressText && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-xs text-amber-900 dark:text-amber-200">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              <span>{driveProgressText}</span>
            </div>
          )}

          {syncStatus && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{syncStatus}</span>
            </div>
          )}

          {syncError && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{syncError}</span>
            </div>
          )}
        </section>
      </div>

      {/* Custom React Confirmation Dialog for Duplicate Files on Google Drive */}
      {pendingUploadPlan && (
        <div
          className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPendingUploadPlan(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Cảnh báo trùng lặp tệp trên Google Drive"
            className="w-full max-w-md rounded-2xl bg-white dark:bg-[#191B1F] border border-stone-200 dark:border-stone-800 shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between gap-2 px-5 py-4 border-b border-stone-200 dark:border-stone-800">
              <div className="flex items-center gap-2 text-amber-800 dark:text-amber-400">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <h3 className="text-sm font-semibold">Cảnh báo trùng lặp trên Google Drive</h3>
              </div>
              <button
                type="button"
                onClick={() => setPendingUploadPlan(null)}
                aria-label="Đóng cảnh báo trùng lặp"
                className="p-1 rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3 text-xs">
              <p className="text-stone-700 dark:text-stone-300 leading-relaxed">
                Phát hiện <strong>{pendingUploadPlan.duplicates.length}</strong> tệp sách đã tồn tại trên Google Drive (và{' '}
                <strong>{pendingUploadPlan.freshItems.length}</strong> tệp mới). Bạn muốn xử lý các tệp trùng như thế nào?
              </p>

              <ul className="max-h-40 overflow-y-auto space-y-1.5 rounded-xl bg-stone-50 dark:bg-stone-900/70 p-3 border border-stone-200 dark:border-stone-800">
                {pendingUploadPlan.duplicates.map((dup) => (
                  <li
                    key={`${dup.targetFolderId}-${dup.fileName}`}
                    className="flex flex-col text-[11px] leading-snug"
                  >
                    <span className="font-semibold text-stone-900 dark:text-stone-100 break-words">
                      {dup.fileName}
                    </span>
                    <span className="text-stone-500">Thư mục: {dup.targetFolderName}</span>
                  </li>
                ))}
              </ul>

              <div className="flex flex-col gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => handleConfirmPendingUpload('overwrite')}
                  className="w-full py-2.5 px-4 rounded-xl bg-amber-800 hover:bg-amber-700 text-white font-semibold"
                >
                  Ghi đè tệp trùng ({pendingUploadPlan.allItems.length} tệp)
                </button>
                <button
                  type="button"
                  onClick={() => handleConfirmPendingUpload('skip')}
                  className="w-full py-2.5 px-4 rounded-xl border border-stone-300 dark:border-stone-700 font-medium hover:bg-stone-100 dark:hover:bg-stone-800"
                >
                  Bỏ qua tệp trùng — Chỉ tải tệp mới ({pendingUploadPlan.freshItems.length})
                </button>
                <button
                  type="button"
                  onClick={() => setPendingUploadPlan(null)}
                  className="w-full py-2 px-4 rounded-xl text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 font-medium"
                >
                  Hủy tải lên
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};
