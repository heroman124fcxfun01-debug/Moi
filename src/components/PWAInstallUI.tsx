import React, { useState } from 'react';
import { Smartphone, Download, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="ios-liquid-btn inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-amber-800 text-white text-xs font-semibold hover:bg-amber-900 whitespace-nowrap"
      >
        <Download className="w-3.5 h-3.5" />
        <span>{compact ? 'Cài App' : 'Cài lên màn hình chính'}</span>
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowGuide(true)}
        className="ios-liquid-pill inline-flex items-center gap-1.5 px-4 py-2 rounded-full ios-liquid-bar border border-white/75 dark:border-zinc-700/60 text-xs font-medium text-stone-800 dark:text-stone-100 whitespace-nowrap"
      >
        <Smartphone className="w-3.5 h-3.5" />
        <span>{compact ? 'Cài Android / Tải về' : 'Cách cài Android (S24 Ultra) & Tải sách'}</span>
      </button>

      {showGuide && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Hướng dẫn cài đặt ứng dụng BOOKHAD"
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/55 p-0 sm:p-4"
        >
          <div className="ios-sheet-enter w-full sm:max-w-md rounded-t-[26px] sm:rounded-[26px] bg-white dark:bg-[#191B1F] text-stone-900 dark:text-stone-100 border border-stone-200 dark:border-stone-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-display font-semibold">
                Cài App &amp; Tải sách về máy
              </h3>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Đóng hướng dẫn"
                className="w-8 h-8 rounded-full bg-stone-200/70 dark:bg-stone-800 flex items-center justify-center text-stone-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isIOS ? (
              <ol className="text-xs space-y-2 text-stone-600 dark:text-stone-300 list-decimal pl-4">
                <li>Nhấn biểu tượng <strong>Chia sẻ (Share)</strong> ở thanh công cụ Safari.</li>
                <li>Chọn <strong>Thêm vào Màn hình chính (Add to Home Screen)</strong>.</li>
              </ol>
            ) : (
              <div className="space-y-3 text-xs text-stone-600 dark:text-stone-300">
                <div className="p-3 rounded-2xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/50 space-y-1.5">
                  <div className="font-semibold text-amber-900 dark:text-amber-300">
                    1. Cài trực tiếp lên Galaxy S24 Ultra (Không cần APK)
                  </div>
                  <ol className="list-decimal pl-4 space-y-1">
                    <li>Mở link ứng dụng sau khi Deploy bằng <strong>Chrome</strong> hoặc <strong>Samsung Internet</strong>.</li>
                    <li>Nhấn menu <strong>⋮ (3 chấm)</strong> góc trên phải → <strong>Cài đặt ứng dụng / Thêm vào Màn hình chính</strong>.</li>
                    <li>Mở icon <strong>BOOKHAD</strong> ngoài màn hình để chạy toàn màn hình &amp; đọc offline.</li>
                  </ol>
                </div>

                <div className="p-3 rounded-2xl bg-stone-100/80 dark:bg-stone-800/60 space-y-1">
                  <div className="font-semibold text-stone-900 dark:text-stone-100">
                    2. Tải 1 file .APK duy nhất qua GitHub
                  </div>
                  <p className="leading-relaxed">
                    Dự án đã tích hợp sẵn <code>capacitor.config.json</code> và quy trình tự đóng gói GitHub Actions. Chỉ cần bấm <strong>Lưu lên GitHub (Export to GitHub)</strong> trong AI Studio → đợi 3–5 phút → vào mục <strong>Releases</strong> của repo GitHub để tải 1 file <code>BOOKHAD-Android.apk</code> về cài trên điện thoại.
                  </p>
                </div>

                <div className="p-3 rounded-2xl bg-stone-100/80 dark:bg-stone-800/60 space-y-1">
                  <div className="font-semibold text-stone-900 dark:text-stone-100">
                    3. Tải sách .EPUB hoặc cả tủ sách về máy
                  </div>
                  <p className="leading-relaxed">
                    Bấm <strong>⋮</strong> trên từng sách → <strong>Xuất file .EPUB</strong>, hoặc kéo xuống cuối <strong>Thư viện</strong> bấm <strong>Trích xuất kho (.ZIP)</strong>.
                  </p>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="ios-liquid-btn w-full py-2.5 rounded-full bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-xs font-semibold"
            >
              Đã hiểu
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-20 md:bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-amber-800 px-3 py-1.5 text-xs font-medium text-white shadow-lg"
    >
      <WifiOff className="w-3.5 h-3.5" />
      <span>Chế độ ngoại tuyến — Đang đọc dữ liệu đã lưu trên máy</span>
    </div>
  );
};
