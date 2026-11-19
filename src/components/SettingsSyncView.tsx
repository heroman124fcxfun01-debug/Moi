import React, { useRef, useState } from 'react';
import {
  Cloud,
  Download,
  FileCheck2,
  HardDriveUpload,
  Moon,
  RefreshCw,
  Settings,
  Smartphone,
  Sun,
  Upload,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import type {
  AppBasicSettings,
  Book,
  BookReadingStyle,
  ReadingLogEntry,
  SyncBackupBundle,
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
import { getStoredApiBase, setStoredApiBase } from '../utils/apiClient';
import { PWAInstallButton } from './PWAInstallUI';

interface SettingsSyncViewProps {
  books: Book[];
  readingLogs: ReadingLogEntry[];
  basicSettings: AppBasicSettings;
  onUpdateBasicSettings: (patch: Partial<AppBasicSettings>) => void;
  onApplySyncedLibrary: (
    mergedBooks: Book[],
    mergedLogs: ReadingLogEntry[],
    addMatchedBook?: Book
  ) => Promise<void>;
}

export const SettingsSyncView: React.FC<SettingsSyncViewProps> = ({
  books,
  readingLogs,
  basicSettings,
  onUpdateBasicSettings,
  onApplySyncedLibrary,
}) => {
  const syncFileInputRef = useRef<HTMLInputElement>(null);
  const matchBookInputRef = useRef<HTMLInputElement>(null);

  const [syncStatus, setSyncStatus] = useState('');
  const [syncError, setSyncError] = useState('');
  const [loadedBundle, setLoadedBundle] = useState<SyncBackupBundle | null>(null);
  const [isMatchingFile, setIsMatchingFile] = useState(false);
  const [apkServerUrl, setApkServerUrl] = useState(() => getStoredApiBase());
  const [apkSavedNotice, setApkSavedNotice] = useState('');

  const handleExportProgressOnly = () => {
    const bundle = buildSyncBackupBundle(books, readingLogs, {
      includeFullBooks: false,
      deviceLabel: 'Galaxy / Web LaziRead',
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
      deviceLabel: 'Galaxy / Web LaziRead Full',
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
        `Đồng bộ thành công: cập nhật tiến độ cho ${mergeRes.matchedProgressCount} sách khớp nội dung và khôi phục thêm ${mergeRes.importedNewBooksCount} sách mới.`
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

      // Match against loaded sync bundle OR existing library records
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
          `Đã nhận diện sách y hệt "${syncedBook.title}" (Mã ${fp}) và khôi phục tiến độ ${syncedBook.progressPercent}% (Chương ${syncedBook.currentChapterIndex + 1})!`
        );
      } else if (existingMatch) {
        setSyncStatus(
          `Tệp "${file.name}" khớp với sách "${existingMatch.title}" đang có trong tủ (${existingMatch.progressPercent}%).`
        );
      } else {
        await onApplySyncedLibrary([draftBook, ...books], readingLogs);
        setSyncStatus(
          `Đã nhập "${draftBook.title}" (Mã nhận diện ${fp}). Nếu bạn nhập thêm gói .lazisync.json từ máy cũ, tiến độ sẽ tự động khớp theo mã này.`
        );
      }
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Lỗi kiểm tra khớp tệp sách.');
    } finally {
      setIsMatchingFile(false);
    }
  };

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-8">
      <header className="space-y-2 pb-5 border-b border-stone-200 dark:border-stone-800">
        <p className="text-xs uppercase tracking-widest text-stone-500">
          Hệ Thống & Sao Lưu Đa Thiết Bị
        </p>
        <h1 className="text-2xl sm:text-3xl font-display font-semibold text-stone-900 dark:text-stone-100">
          Cài Đặt Cơ Bản & Đồng Bộ Tiến Độ
        </h1>
        <p className="text-xs sm:text-sm text-stone-600 dark:text-stone-400">
          Tùy chỉnh trải nghiệm đọc sách trên Samsung Galaxy S24 Ultra, cài ứng dụng lên màn hình chính và đồng bộ tiến độ giữa các thiết bị.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Basic E-Reader Settings */}
        <section className="lg:col-span-5 border border-stone-200 dark:border-stone-800 rounded-2xl bg-white dark:bg-[#16181C] p-5 sm:p-6 space-y-5">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-amber-800 dark:text-amber-400" />
            <h2 className="text-base font-semibold">Cài đặt đọc sách cơ bản</h2>
          </div>

          <div className="space-y-2">
            <span className="block text-xs font-medium text-stone-600 dark:text-stone-400">
              Giao diện ứng dụng (tối ưu Galaxy S24 Ultra)
            </span>
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-[22px] ios-liquid-bar border border-white/75 dark:border-zinc-700/60">
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
                    onClick={() => onUpdateBasicSettings({ uiTheme: item.id })}
                    className={`ios-liquid-pill flex flex-col items-center justify-center gap-1 py-2.5 px-2 rounded-[18px] text-xs font-medium min-h-[54px] ${
                      active
                        ? 'ios-liquid-pill-active text-amber-800 dark:text-amber-300 font-semibold'
                        : 'text-stone-600 dark:text-stone-300 hover:bg-white/45 dark:hover:bg-white/10'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
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
                className="w-4 h-4 accent-amber-800"
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
                className="w-4 h-4 accent-amber-800"
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
                className="w-4 h-4 accent-amber-800"
              />
            </label>
          </div>

          <div className="pt-3 border-t border-stone-100 dark:border-stone-800 space-y-3">
            <div className="text-xs font-medium text-stone-700 dark:text-stone-300">
              Cài đặt trên Android / Galaxy S24 Ultra (PWA &amp; File APK)
            </div>
            <PWAInstallButton />

            <div className="p-3 rounded-2xl bg-stone-50 dark:bg-stone-900/60 border border-stone-200/80 dark:border-stone-800 space-y-2">
              <label className="block text-[11px] font-semibold text-stone-700 dark:text-stone-300">
                Link Máy chủ AI (chỉ cần nhập khi dùng bản file .APK)
              </label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={apkServerUrl}
                  onChange={(e) => {
                    setApkServerUrl(e.target.value);
                    setApkSavedNotice('');
                  }}
                  placeholder="https://ten-app-cua-ban.run.app"
                  aria-label="Địa chỉ máy chủ AI cho file APK"
                  className="flex-1 min-w-0 px-3 py-1.5 text-xs rounded-full border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900"
                />
                <button
                  type="button"
                  onClick={() => {
                    const saved = setStoredApiBase(apkServerUrl);
                    setApkServerUrl(saved);
                    setApkSavedNotice(
                      saved
                        ? 'Đã lưu link máy chủ AI cho bản APK.'
                        : 'Đã xóa link máy chủ riêng (dùng mặc định).'
                    );
                  }}
                  className="ios-liquid-btn px-3.5 py-1.5 rounded-full bg-amber-800 text-white text-xs font-semibold shrink-0"
                >
                  Lưu
                </button>
              </div>
              {apkSavedNotice && (
                <p className="text-[11px] text-emerald-700 dark:text-emerald-400">{apkSavedNotice}</p>
              )}
              <p className="text-[10.5px] text-stone-500 leading-relaxed">
                Khi đẩy dự án lên GitHub, hệ thống tự đóng gói thành 1 file <strong>LaziRead-S24Ultra.apk</strong> trong mục <strong>Releases</strong> để tải thẳng về điện thoại.
              </p>
            </div>
          </div>
        </section>

        {/* Sync & Cloud Backup Section */}
        <section className="lg:col-span-7 border border-stone-200 dark:border-stone-800 rounded-2xl bg-white dark:bg-[#16181C] p-5 sm:p-6 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-amber-800 dark:text-amber-400" />
              <h2 className="text-base font-semibold">
                Đồng bộ Tiến độ & Tải sách sang máy mới
              </h2>
            </div>
          </div>

          {/* Google Drive Permission Notice (Truthful, no fake OAuth) */}
          <div className="p-4 rounded-xl border border-amber-300/70 dark:border-amber-800/70 bg-amber-50/70 dark:bg-amber-950/30 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-900 dark:text-amber-300">
              <Cloud className="w-4 h-4 shrink-0" />
              <span>Đồng bộ trực tiếp Google Drive</span>
            </div>
            <p className="text-xs text-stone-700 dark:text-stone-300 leading-relaxed">
              Để LaziRead có thể tải sách lên và kéo tiến độ đọc trực tiếp từ Google Drive của bạn, bạn cần xác nhận cấp quyền Google Drive (drive.file) trên thẻ kết nối của AI Studio hoặc nhắn <strong>&ldquo;Đồng ý kết nối Google Drive&rdquo;</strong>. Trong lúc chờ cấp quyền Drive, bạn có thể đồng bộ đầy đủ qua tệp <strong>.lazisync.json</strong> và khớp mã sách ở dưới.
            </p>
          </div>

          {/* Cross-Device Export & Import Backup */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleExportProgressOnly}
              className="flex items-start gap-3 p-4 rounded-xl border border-stone-200 dark:border-stone-800 hover:border-amber-800 text-left transition-colors min-h-[68px]"
            >
              <Download className="w-4 h-4 text-amber-800 dark:text-amber-400 mt-0.5 shrink-0" />
              <div>
                <div className="text-xs font-semibold">Xuất Gói Tiến Độ (.lazisync.json)</div>
                <div className="text-[11px] text-stone-500 mt-0.5">
                  Lưu vị trí chương/đoạn, bookmark, lịch sử đọc (siêu nhẹ)
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={handleExportFullBackup}
              className="flex items-start gap-3 p-4 rounded-xl border border-stone-200 dark:border-stone-800 hover:border-amber-800 text-left transition-colors min-h-[68px]"
            >
              <HardDriveUpload className="w-4 h-4 text-amber-800 dark:text-amber-400 mt-0.5 shrink-0" />
              <div>
                <div className="text-xs font-semibold">Xuất Toàn Bộ Sách + Tiến Độ</div>
                <div className="text-[11px] text-stone-500 mt-0.5">
                  Đóng gói cả {books.length} cuốn sách để tải xuống trên máy khác
                </div>
              </div>
            </button>
          </div>

          {/* Import Sync Bundle OR Re-upload Identical Book */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
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
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-xs font-medium hover:opacity-90 min-h-[44px]"
              >
                <Upload className="w-4 h-4" />
                <span>Nhập tệp Đồng bộ (.lazisync.json)</span>
              </button>
            </div>

            <div>
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
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-amber-800 text-amber-900 dark:text-amber-300 text-xs font-medium hover:bg-amber-50 dark:hover:bg-amber-950/30 min-h-[44px]"
              >
                <FileCheck2 className="w-4 h-4" />
                <span>
                  {isMatchingFile ? 'Đang đối chiếu...' : 'Up file sách y hệt để Đồng bộ'}
                </span>
              </button>
            </div>
          </div>

          <p className="text-[11px] text-stone-500 leading-relaxed">
            Mẹo đổi máy: Trên máy mới, nhấn <strong>Nhập tệp Đồng bộ</strong> để kéo toàn bộ sách và tiến độ; hoặc nếu chỉ tải gói tiến độ nhẹ, hãy nhấn <strong>Up file sách y hệt để Đồng bộ</strong> và chọn lại file .EPUB/.PDF cũ — LaziRead tự khớp mã nội dung để đưa bạn về đúng trang đang đọc dở.
          </p>

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
    </main>
  );
};
