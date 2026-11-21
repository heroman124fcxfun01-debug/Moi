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
              <h2 className="font-sans text-[15px] font-bold tracking-tight leading-tight truncate">
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
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 font-semibold text-stone-900 dark:text-stone-100">
                <ShieldCheck className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400 shrink-0" />
                <span>Quyền riêng tư của bạn</span>
              </div>
              <a
                href="/privacy.html"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] font-semibold text-amber-800 dark:text-amber-300 underline underline-offset-2 shrink-0"
              >
                Chính sách riêng tư
              </a>
            </div>
            <ul className="space-y-1 text-[11px] text-stone-600 dark:text-stone-300 leading-snug">
              <li>• Toàn bộ tủ sách, tiến độ đọc và ghi chú được lưu cục bộ trên máy.</li>
              <li>• Chỉ đồng bộ Google Drive (phạm vi drive.file) khi bạn chủ động kết nối.</li>
              <li>• Không thu thập dữ liệu cá nhân, không tài khoản bắt buộc, không theo dõi quảng cáo.</li>
            </ul>
          </div>

          {/* Tuyên bố miễn trừ trách nhiệm (Store Compliance) */}
          <div
            data-testid="app-disclaimer-section"
            className="p-3 rounded-2xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-900/50 space-y-1"
          >
            <div className="font-semibold text-[11.5px] text-amber-900 dark:text-amber-300">
              Tuyên bố miễn trừ trách nhiệm
            </div>
            <p className="text-[10.5px] text-stone-700 dark:text-stone-300 leading-relaxed">
              BOOKHAD là ứng dụng hỗ trợ đọc tài liệu, sách điện tử và ghi chú cá nhân. Ứng dụng
              không lưu trữ, cung cấp hay phân phối nội dung có bản quyền trên máy chủ riêng. Người
              dùng tự chịu trách nhiệm pháp lý đối với các tệp EPUB, PDF, TXT và đường dẫn do mình
              tự nhập hoặc chia sẻ. Tính năng quét YouTube chỉ trích xuất văn bản phụ đề công khai
              để tạo tài liệu học tập/ghi chú cá nhân, hoàn toàn không phát video nền, không ghi âm
              và không tải tệp video/âm thanh.
            </p>
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
                <span>Điều khoản sử dụng</span>
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
                  <strong>1. Quyền sở hữu nội dung:</strong> Bạn hoàn toàn chịu trách nhiệm về bản
                  quyền đối với tệp và liên kết bạn tự nhập hoặc chia sẻ ẩn danh.
                </p>
                <p>
                  <strong>2. Quyền Google Drive tối thiểu:</strong> Ứng dụng chỉ xin quyền
                  <code className="mx-1 font-mono text-[10px]">drive.file</code> cho đúng các tệp
                  do chính ứng dụng tạo ra để sao lưu thư viện của bạn.
                </p>
                <p>
                  <strong>3. Lưu trữ ngoại tuyến:</strong> Bạn có thể xuất bản sao lưu hoặc xóa
                  toàn bộ dữ liệu bất cứ lúc nào ngay trên thiết bị.
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
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-stone-300/70 dark:border-white/15 bg-white/70 dark:bg-white/10 text-[10.5px] font-medium active:scale-95 transition-transform shrink-0"
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

          {/* Website & Privacy Policy */}
          <div className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-2xl bg-white/55 dark:bg-white/5 border border-stone-300/45 dark:border-white/10">
            <div className="flex items-center gap-2 min-w-0">
              <Globe className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400 shrink-0" />
              <div className="min-w-0">
                <div className="font-medium leading-tight">Chính sách quyền riêng tư</div>
                <div className="text-[10.5px] text-stone-500 dark:text-stone-400 truncate">
                  {WEBSITE_URL}/privacy.html
                </div>
              </div>
            </div>
            <a
              href="/privacy.html"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-2.5 py-1 rounded-full bg-amber-800 text-white text-[10.5px] font-semibold hover:bg-amber-900 active:scale-95 transition-transform shrink-0"
            >
              Xem chi tiết
            </a>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
});

AppInfoModal.displayName = 'AppInfoModal';
