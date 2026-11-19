import React, { useRef } from 'react';
import { X, Upload, RotateCcw } from 'lucide-react';
import type {
  CustomFontAsset,
  PageTurnStyle,
  PageWidthOption,
  PaperThemeId,
  ReaderSettings,
  ReadingMode,
  TextAlignOption,
} from '../types/book';
import {
  BUILTIN_FONTS,
  PAPER_THEMES,
  createCustomFontFromFile,
} from '../utils/fileHelpers';
import {
  PAGE_TURN_STYLES,
  getVintagePaperTextureStyles,
} from '../utils/readerEffects';
import { DEFAULT_READER_SETTINGS } from '../utils/storage';

interface ReaderSettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  settings: ReaderSettings;
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void;
  customFonts: CustomFontAsset[];
  onAddCustomFont: (font: CustomFontAsset) => Promise<void>;
}

export const ReaderSettingsDrawer: React.FC<ReaderSettingsDrawerProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  customFonts,
  onAddCustomFont,
}) => {
  const fontInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFontUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const asset = await createCustomFontFromFile(file);
    await onAddCustomFont(asset);
    onUpdateSettings({ fontFamily: `"${asset.fontFamily}", serif` });
  };

  return (
    <aside
      aria-label="Tùy chỉnh giao diện trang đọc"
      className="ios-drawer-right fixed inset-y-0 right-0 z-40 w-full max-w-sm lg:static lg:z-20 lg:w-[370px] lg:shrink-0 lg:sticky lg:top-[105px] lg:h-[calc(100vh-105px)] bg-[#FBF9F5]/95 dark:bg-[#181A1E]/95 backdrop-blur-xl text-stone-900 dark:text-stone-100 border-l border-stone-200/80 dark:border-stone-800 rounded-l-3xl lg:rounded-none shadow-2xl lg:shadow-none flex flex-col"
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200 dark:border-stone-800">
        <h2 className="text-base font-display font-semibold">Tùy chỉnh trang đọc</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onUpdateSettings(DEFAULT_READER_SETTINGS)}
            aria-label="Khôi phục mặc định cài đặt đọc"
            className="p-1.5 rounded-md text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-200/60 dark:hover:bg-stone-800"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng bảng tùy chỉnh"
            className="p-1.5 rounded-md text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-200/60 dark:hover:bg-stone-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-6 text-xs">
        {/* Background / Paper Themes */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-stone-800 dark:text-stone-200">
              Màu nền &amp; Giấy sách cũ ngả vàng
            </h3>
            <span className="text-[10px] text-amber-800 dark:text-amber-400">
              {PAPER_THEMES.length} mẫu giấy
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {PAPER_THEMES.map((theme) => {
              const active = settings.paperTheme === theme.id;
              const vintageStyle = getVintagePaperTextureStyles(theme.id);
              return (
                <button
                  key={theme.id}
                  type="button"
                  onClick={() => onUpdateSettings({ paperTheme: theme.id as PaperThemeId })}
                  style={{
                    backgroundColor: theme.bg,
                    color: theme.text,
                    ...vintageStyle,
                  }}
                  className={`px-2.5 py-2.5 rounded-lg border text-left font-medium transition-all flex items-center justify-between gap-1.5 ${
                    active
                      ? 'border-amber-700 ring-2 ring-amber-700/35'
                      : 'border-stone-300 dark:border-stone-700'
                  }`}
                >
                  <span className="truncate text-[11px]">{theme.label}</span>
                  {theme.badge && (
                    <span
                      style={{ borderColor: theme.border }}
                      className="text-[9px] px-1.5 py-0.5 rounded border opacity-80 shrink-0"
                    >
                      {theme.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Custom Background & Text Color Pickers */}
          <div className="pt-2 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => onUpdateSettings({ paperTheme: 'custom' })}
              className={`px-2.5 py-1.5 rounded-md border text-[11px] font-medium ${
                settings.paperTheme === 'custom'
                  ? 'border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200'
                  : 'border-stone-300 dark:border-stone-700'
              }`}
            >
              Màu tự chọn
            </button>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5">
                <span className="text-stone-500">Nền</span>
                <input
                  type="color"
                  aria-label="Chọn màu nền tùy chỉnh"
                  value={settings.customBgColor}
                  onChange={(e) =>
                    onUpdateSettings({
                      paperTheme: 'custom',
                      customBgColor: e.target.value,
                    })
                  }
                  className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent"
                />
              </label>
              <label className="flex items-center gap-1.5">
                <span className="text-stone-500">Chữ</span>
                <input
                  type="color"
                  aria-label="Chọn màu chữ tùy chỉnh"
                  value={settings.customTextColor}
                  onChange={(e) =>
                    onUpdateSettings({
                      paperTheme: 'custom',
                      customTextColor: e.target.value,
                    })
                  }
                  className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent"
                />
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <label className="space-y-1">
              <span className="flex justify-between text-stone-500 tabular-nums">
                <span>Độ sáng</span>
                <span>{settings.brightness}%</span>
              </span>
              <input
                type="range"
                min={60}
                max={115}
                value={settings.brightness}
                onChange={(e) => onUpdateSettings({ brightness: Number(e.target.value) })}
                className="w-full accent-amber-800"
              />
            </label>
            <label className="space-y-1">
              <span className="flex justify-between text-stone-500 tabular-nums">
                <span>Ánh vàng dịu mắt</span>
                <span>{settings.warmth}%</span>
              </span>
              <input
                type="range"
                min={0}
                max={45}
                value={settings.warmth}
                onChange={(e) => onUpdateSettings({ warmth: Number(e.target.value) })}
                className="w-full accent-amber-800"
              />
            </label>
          </div>
        </section>

        {/* Font Family & Custom Font Import */}
        <section className="space-y-2.5 pt-3 border-t border-stone-200 dark:border-stone-800">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-stone-800 dark:text-stone-200">Phông chữ</h3>
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
              className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-800 dark:text-amber-400 hover:underline"
            >
              <Upload className="w-3 h-3" />
              <span>Import phông (.TTF/.OTF/.WOFF)</span>
            </button>
          </div>

          <select
            aria-label="Chọn phông chữ đọc sách"
            value={settings.fontFamily}
            onChange={(e) => onUpdateSettings({ fontFamily: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-xs"
          >
            <optgroup label="Phông biên tập có sẵn">
              {BUILTIN_FONTS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </optgroup>
            {customFonts.length > 0 && (
              <optgroup label="Phông chữ đã import">
                {customFonts.map((cf) => (
                  <option key={cf.id} value={`"${cf.fontFamily}", serif`}>
                    {cf.name} (.{cf.format})
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </section>

        {/* Typography Sliders */}
        <section className="space-y-3 pt-3 border-t border-stone-200 dark:border-stone-800">
          <h3 className="font-semibold text-stone-800 dark:text-stone-200">
            Cỡ chữ, Giãn dòng & Khoảng cách
          </h3>

          <label className="block space-y-1">
            <span className="flex justify-between text-stone-500 tabular-nums">
              <span>Cỡ chữ</span>
              <span>{settings.fontSize}px</span>
            </span>
            <input
              type="range"
              min={14}
              max={32}
              step={1}
              value={settings.fontSize}
              onChange={(e) => onUpdateSettings({ fontSize: Number(e.target.value) })}
              className="w-full accent-amber-800"
            />
          </label>

          <label className="block space-y-1">
            <span className="flex justify-between text-stone-500 tabular-nums">
              <span>Giãn dòng</span>
              <span>{settings.lineHeight.toFixed(2)}</span>
            </span>
            <input
              type="range"
              min={1.3}
              max={2.3}
              step={0.05}
              value={settings.lineHeight}
              onChange={(e) => onUpdateSettings({ lineHeight: Number(e.target.value) })}
              className="w-full accent-amber-800"
            />
          </label>

          <label className="block space-y-1">
            <span className="flex justify-between text-stone-500 tabular-nums">
              <span>Khoảng cách đoạn</span>
              <span>{settings.paragraphSpacing}px</span>
            </span>
            <input
              type="range"
              min={6}
              max={36}
              step={2}
              value={settings.paragraphSpacing}
              onChange={(e) => onUpdateSettings({ paragraphSpacing: Number(e.target.value) })}
              className="w-full accent-amber-800"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="flex justify-between text-stone-500 tabular-nums">
                <span>Giãn chữ</span>
                <span>{settings.letterSpacing.toFixed(2)}em</span>
              </span>
              <input
                type="range"
                min={-0.02}
                max={0.08}
                step={0.01}
                value={settings.letterSpacing}
                onChange={(e) => onUpdateSettings({ letterSpacing: Number(e.target.value) })}
                className="w-full accent-amber-800"
              />
            </label>
            <label className="block space-y-1">
              <span className="flex justify-between text-stone-500 tabular-nums">
                <span>Độ đậm nét</span>
                <span>{settings.fontWeight}</span>
              </span>
              <input
                type="range"
                min={300}
                max={700}
                step={100}
                value={settings.fontWeight}
                onChange={(e) => onUpdateSettings({ fontWeight: Number(e.target.value) })}
                className="w-full accent-amber-800"
              />
            </label>
          </div>
        </section>

        {/* Layout, Reading Mode & Auto-scroll */}
        <section className="space-y-3 pt-3 border-t border-stone-200 dark:border-stone-800">
          <h3 className="font-semibold text-stone-800 dark:text-stone-200">
            Bố cục & Chế độ lật trang
          </h3>

          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { id: 'scroll', label: 'Cuộn dọc liên tục' },
                { id: 'paginated', label: 'Chia trang lật' },
              ] as Array<{ id: ReadingMode; label: string }>
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onUpdateSettings({ readingMode: m.id })}
                className={`py-2 px-3 rounded-lg border font-medium ${
                  settings.readingMode === m.id
                    ? 'border-amber-700 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200'
                    : 'border-stone-300 dark:border-stone-700'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {settings.readingMode === 'paginated' && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onUpdateSettings({ columnsInPaginated: 1 })}
                className={`py-1.5 rounded-lg border ${
                  settings.columnsInPaginated === 1
                    ? 'border-amber-700 bg-amber-50 dark:bg-amber-950/30'
                    : 'border-stone-300 dark:border-stone-700'
                }`}
              >
                1 trang đơn
              </button>
              <button
                type="button"
                onClick={() => onUpdateSettings({ columnsInPaginated: 2 })}
                className={`py-1.5 rounded-lg border ${
                  settings.columnsInPaginated === 2
                    ? 'border-amber-700 bg-amber-50 dark:bg-amber-950/30'
                    : 'border-stone-300 dark:border-stone-700'
                }`}
              >
                2 trang sách mở
              </button>
            </div>
          )}

          {/* Page Turn Animation Style Picker */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <span className="text-stone-700 dark:text-stone-300 font-medium">
                Kiểu hiệu ứng lật trang
              </span>
              <span className="text-[10px] text-stone-500">
                {settings.readingMode === 'paginated'
                  ? 'Vuốt / chạm để lật'
                  : 'Chọn để bật chia trang'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {PAGE_TURN_STYLES.map((styleOpt) => {
                const active = (settings.pageTurnStyle || 'curl') === styleOpt.id;
                return (
                  <button
                    key={styleOpt.id}
                    type="button"
                    onClick={() =>
                      onUpdateSettings({
                        readingMode: 'paginated',
                        pageTurnStyle: styleOpt.id as PageTurnStyle,
                      })
                    }
                    className={`p-2 rounded-lg border text-left transition-all ${
                      active && settings.readingMode === 'paginated'
                        ? 'border-amber-700 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 ring-1 ring-amber-700/30'
                        : 'border-stone-300 dark:border-stone-700 hover:border-stone-400'
                    }`}
                  >
                    <div className="font-medium text-[11px] truncate">{styleOpt.label}</div>
                    <div className="text-[10px] text-stone-500 line-clamp-1 mt-0.5">
                      {styleOpt.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <span className="block text-stone-500 mb-1.5">Độ rộng khung chữ</span>
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
                  onClick={() => onUpdateSettings({ pageWidth: w.id })}
                  className={`py-1.5 rounded-md border ${
                    settings.pageWidth === w.id
                      ? 'border-amber-700 bg-amber-50 dark:bg-amber-950/30 font-semibold'
                      : 'border-stone-300 dark:border-stone-700'
                  }`}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { id: 'justify', label: 'Canh đều hai bên' },
                { id: 'left', label: 'Canh trái' },
              ] as Array<{ id: TextAlignOption; label: string }>
            ).map((al) => (
              <button
                key={al.id}
                type="button"
                onClick={() => onUpdateSettings({ textAlign: al.id })}
                className={`py-1.5 px-2.5 rounded-md border ${
                  settings.textAlign === al.id
                    ? 'border-amber-700 bg-amber-50 dark:bg-amber-950/30 font-semibold'
                    : 'border-stone-300 dark:border-stone-700'
                }`}
              >
                {al.label}
              </button>
            ))}
          </div>

          <div className="space-y-2 pt-1">
            <label className="flex items-center justify-between cursor-pointer">
              <span>Chữ cái lớn đầu chương (Drop Cap)</span>
              <input
                type="checkbox"
                checked={settings.dropCap}
                onChange={(e) => onUpdateSettings({ dropCap: e.target.checked })}
                className="accent-amber-800"
              />
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <span>Thụt đầu dòng mỗi đoạn văn</span>
              <input
                type="checkbox"
                checked={settings.firstLineIndent}
                onChange={(e) => onUpdateSettings({ firstLineIndent: e.target.checked })}
                className="accent-amber-800"
              />
            </label>
          </div>

          {settings.readingMode === 'scroll' && (
            <label className="block space-y-1 pt-2">
              <span className="flex justify-between text-stone-500 tabular-nums">
                <span>Tự động cuộn trang</span>
                <span>{settings.autoScrollSpeed === 0 ? 'Tắt' : `Mức ${settings.autoScrollSpeed}`}</span>
              </span>
              <input
                type="range"
                min={0}
                max={5}
                step={1}
                value={settings.autoScrollSpeed}
                onChange={(e) => onUpdateSettings({ autoScrollSpeed: Number(e.target.value) })}
                className="w-full accent-amber-800"
              />
            </label>
          )}
        </section>
      </div>
    </aside>
  );
};
