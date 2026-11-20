import React, { memo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  ShieldCheck,
  FileText,
  LifeBuoy,
  Globe,
  ChevronDown,
  Copy,
  Check,
  Sparkles,
} from 'lucide-react';

interface AppInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const APP_VERSION = '2.5.0';
const SUPPORT_EMAIL = 'support@bookhad.app';
const WEBSITE_URL = 'https://bookhad.app';

export const AppInfoModal: React.FC<AppInfoModalProps> = memo(({ isOpen, onClose }) => {
  const [expandedSection, setExpandedSection] = useState<'privacy' | 'terms' | null>(null);
  const [copiedEmail, setCopiedEmail] = useState(false);

  if (!isOpen || typeof document === 'undefined') return null;

  const handleCopySupport = async () => {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      setCopiedEmail(true);
      window.setTimeout(() => setCopiedEmail(false), 1800);
    } catch {
      setCopiedEmail(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[95] ios-frosted-backdrop ios-backdrop-fade flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Thông tin ứng dụng BOOKHAD"
        className="ios-sheet-enter ios-frosted-surface w-full sm:max-w-md rounded-t-[26px] sm:rounded-[24px] text-stone-900 dark:text-stone-100 overflow-hidden max-h-[86dvh] flex flex-col"
      >
        <div className="sm:hidden flex justify-center pt-2 shrink-0">
          <span className="w-10 h-1 rounded-full bg-stone-400/50 dark:bg-stone-600/70" />
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-stone-300/40 dark:border-white/10 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src="/bookhad-icon.jpg"
              alt="Biểu tượng ứng dụng BOOKHAD"
              className="w-9 h-9 rounded-xl object-cover shadow-sm border border-white/70 dark:border-white/15 shrink-0"
            />
            <div className="min-w-0">
              <h2 className="font-display text-[15px] font-bold tracking-tight leading-tight truncate">
                BOOKHAD
              </h2>
              <p className="text-[10.5px] text-stone-500 dark:text-stone-400 truncate">
                Phiên bản v{APP_VERSION} · Tối ưu 120Hz
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng thông tin ứng dụng"
            className="w-7 h-7 rounded-full bg-black/5 dark:bg-white/10 flex items-center justify-center text-stone-600 dark:text-stone-300 active:scale-90 transition-transform"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="p-4 space-y-2.5 overflow-y-auto overscroll-contain text-xs">
          {/* Privacy Highlights */}
          <div className="p-3 rounded-2xl bg-white/55 dark:bg-white/5 border border-stone-300/45 dark:border-white/10 space-y-1.5">
            <div className="flex items-center gap-1.5 font-semibold text-stone-900 dark:text-stone-100">
              <ShieldCheck className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400 shrink-0" />
              <span>Quyền riêng tư của bạn</span>
            </div>
            <ul className="space-y-1 text-[11px] text-stone-600 dark:text-stone-300 leading-snug">
              <li>• Toàn bộ tủ sách, tiến độ đọc và ghi chú được lưu cục bộ trên máy.</li>
              <li>• Chỉ đồng bộ Google Drive hoặc gọi AI khi bạn chủ động thao tác.</li>
              <li>• Không theo dõi quảng cáo, không chia sẻ dữ liệu cá nhân ra bên ngoài.</li>
            </ul>
          </div>

          {/* Version & Optimization */}
          <div className="flex items-center justify-between px-3 py-2.5 rounded-2xl bg-white/55 dark:bg-white/5 border border-stone-300/45 dark:border-white/10">
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400 shrink-0" />
              <span className="font-medium">Phiên bản ứng dụng</span>
            </div>
            <span className="font-mono text-[11px] font-semibold text-amber-800 dark:text-amber-300">
              v{APP_VERSION}
            </span>
          </div>

          {/* Terms & Privacy Policy Accordion */}
          <div className="rounded-2xl bg-white/55 dark:bg-white/5 border border-stone-300/45 dark:border-white/10 overflow-hidden">
            <button
              type="button"
              onClick={() =>
                setExpandedSection((prev) => (prev === 'terms' ? null : 'terms'))
              }
              aria-expanded={expandedSection === 'terms'}
              className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left font-medium hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            >
              <span className="flex items-center gap-2">
                <FileText className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400 shrink-0" />
                <span>Điều khoản &amp; Chính sách riêng tư</span>
              </span>
              <ChevronDown
                className={`w-3.5 h-3.5 text-stone-500 transition-transform duration-200 ${
                  expandedSection === 'terms' ? 'rotate-180' : ''
                }`}
              />
            </button>
            {expandedSection === 'terms' && (
              <div className="px-3 pb-3 pt-1 border-t border-stone-300/35 dark:border-white/10 text-[11px] text-stone-600 dark:text-stone-300 space-y-1.5 leading-relaxed">
                <p>
                  <strong>1. Quyền sở hữu nội dung:</strong> BOOKHAD là trình đọc sách và
                  studio sách nói cá nhân. Bạn chịu trách nhiệm về bản quyền đối với các tệp
                  EPUB, PDF, ảnh/video sách và đường dẫn web mà bạn tự nhập vào tủ sách.
                </p>
                <p>
                  <strong>2. Dữ liệu &amp; Quyền truy cập:</strong> Ứng dụng chỉ yêu cầu quyền
                  truy cập bộ nhớ/camera khi bạn chọn nhập sách hoặc quét trang sách, và quyền
                  Google Drive khi bạn chủ động đăng nhập sao lưu.
                </p>
                <p>
                  <strong>3. Lưu trữ ngoại tuyến:</strong> Bạn có thể sao lưu hoặc xóa hoàn
                  toàn dữ liệu bất cứ lúc nào ngay trong phần Thư viện và Cài đặt.
                </p>
              </div>
            )}
          </div>

          {/* Support */}
          <div className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-2xl bg-white/55 dark:bg-white/5 border border-stone-300/45 dark:border-white/10">
            <div className="flex items-center gap-2 min-w-0">
              <LifeBuoy className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400 shrink-0" />
              <div className="min-w-0">
                <div className="font-medium leading-tight">Hỗ trợ</div>
                <div className="text-[10.5px] text-stone-500 dark:text-stone-400 truncate">
                  {SUPPORT_EMAIL}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleCopySupport}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl border border-stone-300/70 dark:border-white/15 bg-white/70 dark:bg-white/10 text-[10.5px] font-medium active:scale-95 transition-transform shrink-0"
            >
              {copiedEmail ? (
                <>
                  <Check className="w-3 h-3 text-emerald-600" />
                  <span>Đã chép</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>Sao chép</span>
                </>
              )}
            </button>
          </div>

          {/* Website */}
          <div className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-2xl bg-white/55 dark:bg-white/5 border border-stone-300/45 dark:border-white/10">
            <div className="flex items-center gap-2 min-w-0">
              <Globe className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400 shrink-0" />
              <div className="min-w-0">
                <div className="font-medium leading-tight">Website</div>
                <div className="text-[10.5px] text-stone-500 dark:text-stone-400 truncate">
                  {WEBSITE_URL}
                </div>
              </div>
            </div>
            <a
              href={WEBSITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-2.5 py-1 rounded-xl bg-amber-800 text-white text-[10.5px] font-semibold hover:bg-amber-900 active:scale-95 transition-transform shrink-0"
            >
              Mở web
            </a>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
});

AppInfoModal.displayName = 'AppInfoModal';
