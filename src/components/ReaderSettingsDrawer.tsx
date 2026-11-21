import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, X, Upload, RotateCcw, Check } from 'lucide-react';
import type {
  CustomFontAsset,
  PageWidthOption,
  PaperThemeId,
  ReaderSettings,
  TextAlignOption,
} from '../types/book';
import {
  PAPER_THEMES,
  createCustomFontFromFile,
} from '../utils/fileHelpers';
import { buildUnifiedFontCatalog } from '../utils/studioCatalog';
import { getVintagePaperTextureStyles } from '../utils/readerEffects';
import { DEFAULT_READER_SETTINGS } from '../utils/storage';
import { IosSheet } from './IosSheet';

interface ReaderSettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onBackToToolsMenu?: () => void;
  settings: ReaderSettings;
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void;
  customFonts: CustomFontAsset[];
  onAddCustomFont: (font: CustomFontAsset) => Promise<void>;
}

const THREE_TURN_MODES: Array<{
  id: 'slide' | 'scroll' | 'curl';
  label: string;
  desc: string;
}> = [
  { id: 'slide', label: 'Trượt ngang mờ dần', desc: 'Kéo trang sang ngang, mờ dần khi rời tay' },
  { id: 'scroll', label: 'Lướt dọc', desc: 'Cuộn liên tục mượt mà' },
  { id: 'curl', label: 'Lật cong góc 3D', desc: 'Uốn cong góc phải dưới lên như sách thật' },
];

export const ReaderSettingsDrawer: React.FC<ReaderSettingsDrawerProps> = ({
  isOpen,
  onClose,
  onBackToToolsMenu,
  settings,
  onUpdateSettings,
  customFonts,
  onAddCustomFont,
}) => {
  const fontInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<ReaderSettings>(settings);
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );

  useEffect(() => {
    if (isOpen) {
      setDraft(settings);
    }
    // Intentionally sync snapshot only when opening drawer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setIsDesktop(window.innerWidth >= 1024);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const unifiedFonts = useMemo(() => buildUnifiedFontCatalog(customFonts), [customFonts]);
  const selectedFontItem =
    unifiedFonts.find((f) => f.cssValue === draft.fontFamily) || unifiedFonts[0];

  const updateDraft = (patch: Partial<ReaderSettings>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    // Apply immediately to the active reading page so users see live margin & typography changes in real time
    onUpdateSettings(patch);
  };

  const commitAndClose = () => {
    onClose();
  };

  const handleFontUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const asset = await createCustomFontFromFile(file);
    await onAddCustomFont(asset);
    updateDraft({ fontFamily: `"${asset.fontFamily}", serif` });
  };

  const activeThreeMode: 'slide' | 'scroll' | 'curl' =
    draft.readingMode === 'scroll'
      ? 'scroll'
      : draft.pageTurnStyle === 'curl'
      ? 'curl'
      : 'slide';

  const innerContent = (
    <>
      <div className="flex items-center justify-between gap-2 px-3.5 sm:px-4 py-2 border-b border-stone-300/40 dark:border-white/10 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          {onBackToToolsMenu && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onBackToToolsMenu();
              }}
              aria-label="Quay lại tùy chọn đọc sách"
              className="inline-flex items-center gap-0.5 px-2 py-1 -ml-1 rounded-full bg-black/5 dark:bg-white/10 text-[11px] font-semibold text-stone-700 dark:text-stone-200 hover:bg-black/10 shrink-0"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Quay lại</span>
            </button>
          )}
          <h2 className="text-[13px] font-display font-semibold truncate">Chữ, Nền &amp; Lề trang</h2>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => {
              const reset = { ...DEFAULT_READER_SETTINGS };
              setDraft(reset);
              onUpdateSettings(reset);
            }}
            aria-label="Khôi phục mặc định cài đặt đọc"
            className="p-1.5 rounded-md text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-200/60 dark:hover:bg-stone-800"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={commitAndClose}
            aria-label="Đóng bảng tùy chỉnh"
            className="p-1.5 rounded-md text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-200/60 dark:hover:bg-stone-800"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="overflow-y-auto overscroll-contain min-h-0 px-3.5 sm:px-4 py-2.5 space-y-3 text-xs">
        {/* Compact 2-Column Parallel Typography & Margin Sliders (First for Instant Live Adjustment) */}
        <section
          data-testid="reader-sliders-grid-section"
          className="space-y-2 min-w-0"
        >
          <h3 className="text-[11px] font-semibold text-stone-800 dark:text-stone-200">
            Cỡ chữ, Giãn dòng &amp; Lề trang (px)
          </h3>

          <div
            data-testid="reader-sliders-2col-grid"
            className="grid grid-cols-2 gap-x-3 gap-y-2"
          >
            <label className="block space-y-0.5 min-w-0">
              <span className="flex justify-between text-[10.5px] text-stone-500 tabular-nums">
                <span>Cỡ chữ</span>
                <span>{draft.fontSize}px</span>
              </span>
              <input
                type="range"
                data-testid="slider-font-size"
                min={14}
                max={32}
                step={1}
                value={draft.fontSize}
                onChange={(e) => updateDraft({ fontSize: Number(e.target.value) })}
                className="w-full h-1.5 accent-amber-800"
              />
            </label>

            <label className="block space-y-0.5 min-w-0">
              <span className="flex justify-between text-[10.5px] text-stone-500 tabular-nums">
                <span>Giãn dòng</span>
                <span>{draft.lineHeight.toFixed(2)}</span>
              </span>
              <input
                type="range"
                data-testid="slider-line-height"
                min={1.3}
                max={2.3}
                step={0.05}
                value={draft.lineHeight}
                onChange={(e) => updateDraft({ lineHeight: Number(e.target.value) })}
                className="w-full h-1.5 accent-amber-800"
              />
            </label>

            <label className="block space-y-0.5 min-w-0">
              <span className="flex justify-between text-[10.5px] text-stone-500 tabular-nums">
                <span>Khoảng cách đoạn</span>
                <span>{draft.paragraphSpacing}px</span>
              </span>
              <input
                type="range"
                data-testid="slider-paragraph-spacing"
                min={4}
                max={36}
                step={2}
                value={draft.paragraphSpacing}
                onChange={(e) => updateDraft({ paragraphSpacing: Number(e.target.value) })}
                className="w-full h-1.5 accent-amber-800"
              />
            </label>

            <label className="block space-y-0.5 min-w-0">
              <span className="flex justify-between text-[10.5px] text-stone-500 tabular-nums">
                <span>Giãn chữ</span>
                <span>{draft.letterSpacing.toFixed(2)}em</span>
              </span>
              <input
                type="range"
                data-testid="slider-letter-spacing"
                min={-0.02}
                max={0.08}
                step={0.01}
                value={draft.letterSpacing}
                onChange={(e) => updateDraft({ letterSpacing: Number(e.target.value) })}
                className="w-full h-1.5 accent-amber-800"
              />
            </label>

            <label className="block space-y-0.5 min-w-0">
              <span className="flex justify-between text-[10.5px] text-stone-500 tabular-nums">
                <span>Độ đậm</span>
                <span>{draft.fontWeight}</span>
              </span>
              <input
                type="range"
                data-testid="slider-font-weight"
                min={300}
                max={700}
                step={100}
                value={draft.fontWeight}
                onChange={(e) => updateDraft({ fontWeight: Number(e.target.value) })}
                className="w-full h-1.5 accent-amber-800"
              />
            </label>

            <label className="block space-y-0.5 min-w-0">
              <span className="flex justify-between text-[10.5px] text-stone-500 tabular-nums">
                <span>Lề trên</span>
                <span>{draft.marginTopPx ?? 12}px</span>
              </span>
              <input
                type="range"
                data-testid="slider-margin-top"
                min={0}
                max={64}
                step={2}
                value={draft.marginTopPx ?? 12}
                onChange={(e) => updateDraft({ marginTopPx: Number(e.target.value) })}
                className="w-full h-1.5 accent-amber-800"
              />
            </label>

            <label className="block space-y-0.5 min-w-0">
              <span className="flex justify-between text-[10.5px] text-stone-500 tabular-nums">
                <span>Lề dưới</span>
                <span>{draft.marginBottomPx ?? 20}px</span>
              </span>
              <input
                type="range"
                data-testid="slider-margin-bottom"
                min={0}
                max={64}
                step={2}
                value={draft.marginBottomPx ?? 20}
                onChange={(e) => updateDraft({ marginBottomPx: Number(e.target.value) })}
                className="w-full h-1.5 accent-amber-800"
              />
            </label>

            <label className="block space-y-0.5 min-w-0">
              <span className="flex justify-between text-[10.5px] text-stone-500 tabular-nums">
                <span>Lề ngang</span>
                <span>{draft.marginHorizontalPx ?? 16}px</span>
              </span>
              <input
                type="range"
                data-testid="slider-margin-horizontal"
                min={4}
                max={56}
                step={2}
                value={draft.marginHorizontalPx ?? 16}
                onChange={(e) => updateDraft({ marginHorizontalPx: Number(e.target.value) })}
                className="w-full h-1.5 accent-amber-800"
              />
            </label>
          </div>
        </section>

        {/* Background / Paper Themes */}
        <section className="space-y-1.5 pt-2.5 border-t border-stone-200 dark:border-stone-800 min-w-0">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <h3 className="text-[11.5px] font-semibold text-stone-800 dark:text-stone-200">
              Màu nền &amp; Giấy sách
            </h3>
            <span className="text-[10px] text-amber-800 dark:text-amber-400 shrink-0">
              {PAPER_THEMES.length} mẫu
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {PAPER_THEMES.map((theme) => {
              const active = draft.paperTheme === theme.id;
              const vintageStyle = getVintagePaperTextureStyles(theme.id);
              return (
                <button
                  key={theme.id}
                  type="button"
                  onClick={() => updateDraft({ paperTheme: theme.id as PaperThemeId })}
                  style={{
                    backgroundColor: theme.bg,
                    color: theme.text,
                    ...vintageStyle,
                  }}
                  className={`px-2.5 py-2 rounded-lg border text-left font-medium transition-all flex items-center justify-between gap-1 ${
                    active
                      ? 'border-amber-700 ring-2 ring-amber-700/35'
                      : 'border-stone-300 dark:border-stone-700'
                  }`}
                >
                  <span className="truncate text-[11px]">{theme.label}</span>
                  {theme.badge && (
                    <span
                      style={{ borderColor: theme.border }}
                      className="text-[9px] px-1 py-0.5 rounded border opacity-80 shrink-0"
                    >
                      {theme.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="pt-1 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => updateDraft({ paperTheme: 'custom' })}
              className={`px-2.5 py-1 rounded-md border text-[11px] font-medium shrink-0 ${
                draft.paperTheme === 'custom'
                  ? 'border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200'
                  : 'border-stone-300 dark:border-stone-700'
              }`}
            >
              Màu tự chọn
            </button>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1 text-[11px]">
                <span className="text-stone-500">Nền</span>
                <input
                  type="color"
                  aria-label="Chọn màu nền tùy chỉnh"
                  value={draft.customBgColor}
                  onChange={(e) =>
                    updateDraft({
                      paperTheme: 'custom',
                      customBgColor: e.target.value,
                    })
                  }
                  className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
                />
              </label>
              <label className="flex items-center gap-1 text-[11px]">
                <span className="text-stone-500">Chữ</span>
                <input
                  type="color"
                  aria-label="Chọn màu chữ tùy chỉnh"
                  value={draft.customTextColor}
                  onChange={(e) =>
                    updateDraft({
                      paperTheme: 'custom',
                      customTextColor: e.target.value,
                    })
                  }
                  className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
                />
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <label className="space-y-1">
              <span className="flex justify-between text-[11px] text-stone-500 tabular-nums">
                <span>Độ sáng</span>
                <span>{draft.brightness}%</span>
              </span>
              <input
                type="range"
                min={60}
                max={115}
                value={draft.brightness}
                onChange={(e) => updateDraft({ brightness: Number(e.target.value) })}
                className="w-full accent-amber-800"
              />
            </label>
            <label className="space-y-1">
              <span className="flex justify-between text-[11px] text-stone-500 tabular-nums">
                <span>Ánh vàng dịu</span>
                <span>{draft.warmth}%</span>
              </span>
              <input
                type="range"
                min={0}
                max={45}
                value={draft.warmth}
                onChange={(e) => updateDraft({ warmth: Number(e.target.value) })}
                className="w-full accent-amber-800"
              />
            </label>
          </div>
        </section>

        {/* Compact Half-Width Scrollable Font Family Picker */}
        <section className="space-y-2 pt-3 border-t border-stone-200 dark:border-stone-800 min-w-0">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <h3 className="text-[11.5px] font-semibold text-stone-800 dark:text-stone-200 shrink-0">
              Phông chữ ({unifiedFonts.length})
            </h3>
            <input
              ref={fontInputRef}
              type="file"
              accept=".ttf,.otf,.woff,.woff2"
              className="hidden"
              onChange={(e) => handleFontUpload(e.target.files)}
            />
            <button
              type="button"
              onClick={() => fontInputRef.current?.click()}
              className="ios-pressable inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-50/90 dark:bg-amber-950/40 border border-amber-700/25 text-[10.5px] font-medium text-amber-800 dark:text-amber-300"
            >
              <Upload className="w-3 h-3 shrink-0" />
              <span>Thêm phông</span>
            </button>
          </div>

          <div className="flex items-stretch gap-2.5 min-w-0">
            <div
              role="listbox"
              data-testid="reader-font-picker-box"
              aria-label="Danh sách phông chữ đọc sách"
              className="w-1/2 shrink-0 max-h-[164px] overflow-y-auto overscroll-contain rounded-xl border border-stone-200 dark:border-stone-800 divide-y divide-stone-100 dark:divide-stone-800/80 bg-white dark:bg-stone-900/70"
            >
              {unifiedFonts.map((f) => {
                const active = draft.fontFamily === f.cssValue;
                return (
                  <button
                    key={f.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => updateDraft({ fontFamily: f.cssValue })}
                    className={`ios-pressable w-full px-2.5 py-2 text-left flex items-center justify-between gap-1.5 transition-colors ${
                      active
                        ? 'bg-amber-50/90 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 font-semibold'
                        : 'hover:bg-stone-50 dark:hover:bg-stone-800/60 text-stone-800 dark:text-stone-200'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div style={{ fontFamily: f.cssValue }} className="text-[11.5px] truncate">
                        {f.name}
                      </div>
                      <div className="text-[9.5px] text-stone-500 truncate">{f.origin}</div>
                    </div>
                    {active && <Check className="w-3 h-3 text-amber-700 shrink-0" />}
                  </button>
                );
              })}
            </div>

            <div className="flex-1 min-w-0 rounded-xl border border-stone-200/80 dark:border-stone-800 bg-stone-50/90 dark:bg-stone-900/50 p-2.5 flex flex-col justify-between gap-1.5">
              <div className="min-w-0">
                <div className="text-[9.5px] text-stone-500 truncate">Đang chọn</div>
                <div
                  style={{ fontFamily: draft.fontFamily }}
                  className="text-[13px] font-semibold text-stone-900 dark:text-stone-100 truncate mt-0.5"
                >
                  {selectedFontItem?.name || 'Mặc định'}
                </div>
              </div>
              <div
                style={{ fontFamily: draft.fontFamily }}
                className="text-[15px] leading-snug text-stone-700 dark:text-stone-300 line-clamp-3"
              >
                Aa Bb Cc · Tiếng Việt rõ nét, dịu mắt.
              </div>
              <div className="text-[9.5px] text-stone-500 truncate">
                {selectedFontItem?.origin || 'Phông hệ thống'}
              </div>
            </div>
          </div>
        </section>

        {/* Strict 3-Option Page Turn & Layout Selector */}
        <section className="space-y-2 pt-2.5 border-t border-stone-200 dark:border-stone-800">
          <h3 className="text-[11.5px] font-semibold text-stone-800 dark:text-stone-200">
            Chế độ lật trang
          </h3>

          <div className="space-y-1.5">
            {THREE_TURN_MODES.map((opt) => {
              const active = activeThreeMode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    if (opt.id === 'scroll') {
                      updateDraft({ readingMode: 'scroll' });
                    } else if (opt.id === 'slide') {
                      updateDraft({ readingMode: 'paginated', pageTurnStyle: 'slide' });
                    } else {
                      updateDraft({ readingMode: 'paginated', pageTurnStyle: 'curl' });
                    }
                  }}
                  className={`w-full px-3 py-2 rounded-xl border text-left flex items-center justify-between gap-2 transition-colors ${
                    active
                      ? 'border-amber-700 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 font-semibold'
                      : 'border-stone-200 dark:border-stone-800 text-stone-800 dark:text-stone-200'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-[11.5px]">{opt.label}</div>
                    <div className="text-[10px] text-stone-500">{opt.desc}</div>
                  </div>
                  {active && <Check className="w-3.5 h-3.5 text-amber-700 shrink-0" />}
                </button>
              );
            })}
          </div>

          {draft.readingMode === 'paginated' && (
            <div className="grid grid-cols-2 gap-1.5 pt-0.5">
              <button
                type="button"
                onClick={() => updateDraft({ columnsInPaginated: 1 })}
                className={`py-1.5 rounded-lg border text-[11px] ${
                  draft.columnsInPaginated === 1
                    ? 'border-amber-700 bg-amber-50 dark:bg-amber-950/30 font-semibold'
                    : 'border-stone-300 dark:border-stone-700'
                }`}
              >
                1 trang đơn
              </button>
              <button
                type="button"
                onClick={() => updateDraft({ columnsInPaginated: 2 })}
                className={`py-1.5 rounded-lg border text-[11px] ${
                  draft.columnsInPaginated === 2
                    ? 'border-amber-700 bg-amber-50 dark:bg-amber-950/30 font-semibold'
                    : 'border-stone-300 dark:border-stone-700'
                }`}
              >
                2 trang sách mở
              </button>
            </div>
          )}

          <div>
            <span className="block text-[11px] text-stone-500 mb-1">Độ rộng khung chữ</span>
            <div className="grid grid-cols-4 gap-1.5">
              {(
                [
                  { id: 'narrow', label: 'Hẹp' },
                  { id: 'medium', label: 'Chuẩn' },
                  { id: 'wide', label: 'Rộng' },
                  { id: 'full', label: 'Tràn lề' },
                ] as Array<{ id: PageWidthOption; label: string }>
              ).map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => updateDraft({ pageWidth: w.id })}
                  className={`py-1.5 rounded-md border text-[11px] ${
                    draft.pageWidth === w.id
                      ? 'border-amber-700 bg-amber-50 dark:bg-amber-950/30 font-semibold'
                      : 'border-stone-300 dark:border-stone-700'
                  }`}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {(
              [
                { id: 'justify', label: 'Canh đều hai bên' },
                { id: 'left', label: 'Canh trái' },
              ] as Array<{ id: TextAlignOption; label: string }>
            ).map((al) => (
              <button
                key={al.id}
                type="button"
                onClick={() => updateDraft({ textAlign: al.id })}
                className={`py-1.5 px-2 rounded-md border text-[11px] ${
                  draft.textAlign === al.id
                    ? 'border-amber-700 bg-amber-50 dark:bg-amber-950/30 font-semibold'
                    : 'border-stone-300 dark:border-stone-700'
                }`}
              >
                {al.label}
              </button>
            ))}
          </div>

          <div className="space-y-2 pt-1 text-[11.5px]">
            <label className="flex items-center justify-between cursor-pointer">
              <span>Chữ cái lớn đầu chương (Drop Cap)</span>
              <input
                type="checkbox"
                checked={draft.dropCap}
                onChange={(e) => updateDraft({ dropCap: e.target.checked })}
                className="accent-amber-800"
              />
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <span>Thụt đầu dòng mỗi đoạn văn</span>
              <input
                type="checkbox"
                checked={draft.firstLineIndent}
                onChange={(e) => updateDraft({ firstLineIndent: e.target.checked })}
                className="accent-amber-800"
              />
            </label>
          </div>

          {draft.readingMode === 'scroll' && (
            <label className="block space-y-1 pt-1">
              <span className="flex justify-between text-[11px] text-stone-500 tabular-nums">
                <span>Tự động cuộn trang</span>
                <span>{draft.autoScrollSpeed === 0 ? 'Tắt' : `Mức ${draft.autoScrollSpeed}`}</span>
              </span>
              <input
                type="range"
                min={0}
                max={5}
                step={1}
                value={draft.autoScrollSpeed}
                onChange={(e) => updateDraft({ autoScrollSpeed: Number(e.target.value) })}
                className="w-full accent-amber-800"
              />
            </label>
          )}
        </section>
      </div>

      {/* Compact Close Footer */}
      <div className="px-3.5 sm:px-4 py-2 border-t border-stone-200 dark:border-stone-800 bg-[#FBF9F5]/95 dark:bg-[#181A1E]/95 shrink-0">
        <button
          type="button"
          onClick={commitAndClose}
          className="w-full py-2 rounded-xl bg-amber-800 text-white text-xs font-semibold hover:bg-amber-900 transition-colors"
        >
          Xong
        </button>
      </div>
    </>
  );

  return (
    <IosSheet
      isOpen={isOpen}
      onClose={commitAndClose}
      ariaLabel="Tùy chỉnh giao diện trang đọc"
      testId="reader-settings-drawer"
      variant={isDesktop ? 'drawer-right' : 'bottom-sheet'}
      inlineDesktop={isDesktop}
      showGrabHandle={!isDesktop}
      backdropClassName={!isDesktop ? '!bg-black/15 !backdrop-blur-none' : ''}
      zIndexClass="z-[75]"
      panelClassName={
        isDesktop
          ? 'w-[370px] shrink-0 sticky top-[52px] self-start h-auto max-h-[calc(100vh-52px)] text-stone-900 dark:text-stone-100 rounded-bl-[24px] flex flex-col overflow-hidden'
          : 'w-full max-w-lg h-auto max-h-[48dvh] rounded-t-[24px] text-stone-900 dark:text-stone-100 flex flex-col overflow-hidden'
      }
    >
      {innerContent}
    </IosSheet>
  );
};
