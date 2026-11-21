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
import { useI18n } from '../contexts/LanguageContext';
import { IosSheet } from './IosSheet';
import { PressHoldSlider } from './PressHoldSlider';

interface ReaderSettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onBackToToolsMenu?: () => void;
  settings: ReaderSettings;
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void;
  customFonts: CustomFontAsset[];
  onAddCustomFont: (font: CustomFontAsset) => Promise<void>;
}

const PAGE_WIDTH_STEPS: Array<{ id: PageWidthOption; valueLabel: string }> = [
  { id: 'narrow', valueLabel: '560px' },
  { id: 'medium', valueLabel: '680px' },
  { id: 'wide', valueLabel: '820px' },
  { id: 'full', valueLabel: '100%' },
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
  const { strings } = useI18n();
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

  const turnModes: Array<{ id: 'slide' | 'scroll' | 'curl'; label: string }> = [
    { id: 'slide', label: strings.turnSlide },
    { id: 'scroll', label: strings.turnScroll },
    { id: 'curl', label: strings.turnCurl },
  ];

  const currentWidthIdx = Math.max(
    0,
    PAGE_WIDTH_STEPS.findIndex((w) => w.id === draft.pageWidth)
  );
  const currentWidthMeta = PAGE_WIDTH_STEPS[currentWidthIdx] || PAGE_WIDTH_STEPS[1];

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
              aria-label={strings.back}
              className="inline-flex items-center gap-0.5 px-2 py-1 -ml-1 rounded-full bg-black/5 dark:bg-white/10 text-[11px] font-semibold text-stone-700 dark:text-stone-200 hover:bg-black/10 shrink-0"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>{strings.back}</span>
            </button>
          )}
          <h2 className="text-[13px] font-display font-semibold truncate">
            {strings.pageAndBgTitle}
          </h2>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => {
              const reset = { ...DEFAULT_READER_SETTINGS };
              setDraft(reset);
              onUpdateSettings(reset);
            }}
            aria-label="Reset"
            className="p-1.5 rounded-md text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-200/60 dark:hover:bg-stone-800"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={commitAndClose}
            aria-label={strings.close}
            className="p-1.5 rounded-md text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-200/60 dark:hover:bg-stone-800"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="overflow-y-auto overscroll-contain min-h-0 px-3.5 sm:px-4 py-2.5 space-y-3 text-xs">
        {/* Compact 2-Column Parallel Typography & Margin Sliders (Press-and-Hold + Drag ONLY, anti-accidental tap) */}
        <section
          data-testid="reader-sliders-grid-section"
          className="space-y-2 min-w-0"
        >
          <h3 className="text-[11px] font-semibold text-stone-800 dark:text-stone-200">
            {strings.slidersHeading}
          </h3>

          <div
            data-testid="reader-sliders-2col-grid"
            className="grid grid-cols-2 gap-x-3 gap-y-2"
          >
            <div className="space-y-0.5 min-w-0">
              <div className="flex justify-between text-[10.5px] text-stone-500 tabular-nums">
                <span>{strings.fontSize}</span>
                <span>{draft.fontSize}px</span>
              </div>
              <PressHoldSlider
                testId="slider-font-size"
                ariaLabel={strings.fontSize}
                min={14}
                max={32}
                step={1}
                value={draft.fontSize}
                onChange={(v) => updateDraft({ fontSize: v })}
              />
            </div>

            <div className="space-y-0.5 min-w-0">
              <div className="flex justify-between text-[10.5px] text-stone-500 tabular-nums">
                <span>{strings.lineHeight}</span>
                <span>{draft.lineHeight.toFixed(2)}</span>
              </div>
              <PressHoldSlider
                testId="slider-line-height"
                ariaLabel={strings.lineHeight}
                min={1.3}
                max={2.3}
                step={0.05}
                value={draft.lineHeight}
                onChange={(v) => updateDraft({ lineHeight: v })}
              />
            </div>

            <div className="space-y-0.5 min-w-0">
              <div className="flex justify-between text-[10.5px] text-stone-500 tabular-nums">
                <span>{strings.paragraphSpacing}</span>
                <span>{draft.paragraphSpacing}px</span>
              </div>
              <PressHoldSlider
                testId="slider-paragraph-spacing"
                ariaLabel={strings.paragraphSpacing}
                min={4}
                max={36}
                step={2}
                value={draft.paragraphSpacing}
                onChange={(v) => updateDraft({ paragraphSpacing: v })}
              />
            </div>

            <div className="space-y-0.5 min-w-0">
              <div className="flex justify-between text-[10.5px] text-stone-500 tabular-nums">
                <span>{strings.letterSpacing}</span>
                <span>{draft.letterSpacing.toFixed(2)}em</span>
              </div>
              <PressHoldSlider
                testId="slider-letter-spacing"
                ariaLabel={strings.letterSpacing}
                min={-0.02}
                max={0.08}
                step={0.01}
                value={draft.letterSpacing}
                onChange={(v) => updateDraft({ letterSpacing: v })}
              />
            </div>

            <div className="space-y-0.5 min-w-0">
              <div className="flex justify-between text-[10.5px] text-stone-500 tabular-nums">
                <span>{strings.fontWeight}</span>
                <span>{draft.fontWeight}</span>
              </div>
              <PressHoldSlider
                testId="slider-font-weight"
                ariaLabel={strings.fontWeight}
                min={300}
                max={700}
                step={100}
                value={draft.fontWeight}
                onChange={(v) => updateDraft({ fontWeight: v })}
              />
            </div>

            <div className="space-y-0.5 min-w-0">
              <div className="flex justify-between text-[10.5px] text-stone-500 tabular-nums">
                <span>{strings.marginTop}</span>
                <span>{draft.marginTopPx ?? 12}px</span>
              </div>
              <PressHoldSlider
                testId="slider-margin-top"
                ariaLabel={strings.marginTop}
                min={0}
                max={64}
                step={2}
                value={draft.marginTopPx ?? 12}
                onChange={(v) => updateDraft({ marginTopPx: v })}
              />
            </div>

            <div className="space-y-0.5 min-w-0">
              <div className="flex justify-between text-[10.5px] text-stone-500 tabular-nums">
                <span>{strings.marginBottom}</span>
                <span>{draft.marginBottomPx ?? 20}px</span>
              </div>
              <PressHoldSlider
                testId="slider-margin-bottom"
                ariaLabel={strings.marginBottom}
                min={0}
                max={64}
                step={2}
                value={draft.marginBottomPx ?? 20}
                onChange={(v) => updateDraft({ marginBottomPx: v })}
              />
            </div>

            <div className="space-y-0.5 min-w-0">
              <div className="flex justify-between text-[10.5px] text-stone-500 tabular-nums">
                <span>{strings.marginHorizontal}</span>
                <span>{draft.marginHorizontalPx ?? 16}px</span>
              </div>
              <PressHoldSlider
                testId="slider-margin-horizontal"
                ariaLabel={strings.marginHorizontal}
                min={4}
                max={56}
                step={2}
                value={draft.marginHorizontalPx ?? 16}
                onChange={(v) => updateDraft({ marginHorizontalPx: v })}
              />
            </div>
          </div>
        </section>

        {/* Background / Paper Themes */}
        <section className="space-y-1.5 pt-2.5 border-t border-stone-200 dark:border-stone-800 min-w-0">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <h3 className="text-[11.5px] font-semibold text-stone-800 dark:text-stone-200">
              {strings.paperThemeHeading}
            </h3>
            <span className="text-[10px] text-amber-800 dark:text-amber-400 shrink-0 tabular-nums">
              {PAPER_THEMES.length}
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
              {strings.customColor}
            </button>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1 text-[11px]">
                <span className="text-stone-500">{strings.bgColor}</span>
                <input
                  type="color"
                  aria-label={strings.bgColor}
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
                <span className="text-stone-500">{strings.textColor}</span>
                <input
                  type="color"
                  aria-label={strings.textColor}
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
            <div className="space-y-0.5">
              <div className="flex justify-between text-[11px] text-stone-500 tabular-nums">
                <span>{strings.brightness}</span>
                <span>{draft.brightness}%</span>
              </div>
              <PressHoldSlider
                testId="slider-brightness"
                ariaLabel={strings.brightness}
                min={60}
                max={115}
                step={1}
                value={draft.brightness}
                onChange={(v) => updateDraft({ brightness: v })}
              />
            </div>
            <div className="space-y-0.5">
              <div className="flex justify-between text-[11px] text-stone-500 tabular-nums">
                <span>{strings.warmthYellow}</span>
                <span>{draft.warmth}%</span>
              </div>
              <PressHoldSlider
                testId="slider-warmth"
                ariaLabel={strings.warmthYellow}
                min={0}
                max={45}
                step={1}
                value={draft.warmth}
                onChange={(v) => updateDraft({ warmth: v })}
              />
            </div>
          </div>
        </section>

        {/* Compact Font Picker — NO redundant preview box (text updates live on the page behind) */}
        <section className="space-y-2 pt-3 border-t border-stone-200 dark:border-stone-800 min-w-0">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <h3 className="text-[11.5px] font-semibold text-stone-800 dark:text-stone-200 shrink-0">
              {strings.fontsHeading} ({unifiedFonts.length})
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
              <span>{strings.addFont}</span>
            </button>
          </div>

          <div
            role="listbox"
            data-testid="reader-font-picker-box"
            aria-label={strings.fontsHeading}
            className="w-full max-h-[144px] overflow-y-auto overscroll-contain rounded-xl border border-stone-200 dark:border-stone-800 divide-y divide-stone-100 dark:divide-stone-800/80 bg-white dark:bg-stone-900/70"
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
                  className={`ios-pressable w-full px-3 py-2 text-left flex items-center justify-between gap-2 transition-colors ${
                    active
                      ? 'bg-amber-50/90 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 font-semibold'
                      : 'hover:bg-stone-50 dark:hover:bg-stone-800/60 text-stone-800 dark:text-stone-200'
                  }`}
                >
                  <span style={{ fontFamily: f.cssValue }} className="text-[12px] truncate">
                    {f.name}
                  </span>
                  {active && <Check className="w-3.5 h-3.5 text-amber-700 shrink-0" />}
                </button>
              );
            })}
          </div>
        </section>

        {/* Minimal Page Turn Selector — ONLY Mode Names, ZERO Descriptions */}
        <section className="space-y-2 pt-2.5 border-t border-stone-200 dark:border-stone-800">
          <h3 className="text-[11.5px] font-semibold text-stone-800 dark:text-stone-200">
            {strings.pageTurnModeHeading}
          </h3>

          <div data-testid="page-turn-mode-list" className="space-y-1.5">
            {turnModes.map((opt) => {
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
                  <span className="text-[11.5px] truncate">{opt.label}</span>
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
                {strings.singlePage}
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
                {strings.twoPages}
              </button>
            </div>
          )}

          {/* Single Horizontal Row: Độ rộng khung chữ [value] [-] [+] */}
          <div
            data-testid="page-width-stepper-row"
            className="flex items-center justify-between gap-2 pt-0.5"
          >
            <span className="text-[11.5px] font-medium text-stone-700 dark:text-stone-300 truncate">
              {strings.pageWidthLabel}
            </span>
            <div className="inline-flex items-center gap-1.5 shrink-0">
              <span
                data-testid="page-width-value"
                className="text-[11px] font-semibold tabular-nums text-stone-600 dark:text-stone-300 min-w-[40px] text-right"
              >
                {currentWidthMeta.valueLabel}
              </span>
              <button
                type="button"
                data-testid="page-width-dec-btn"
                disabled={currentWidthIdx <= 0}
                onClick={() => {
                  const prev = PAGE_WIDTH_STEPS[Math.max(0, currentWidthIdx - 1)];
                  if (prev) updateDraft({ pageWidth: prev.id });
                }}
                aria-label="Giảm độ rộng khung chữ"
                className="w-7 h-7 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-sm font-semibold hover:border-amber-700 disabled:opacity-35 flex items-center justify-center"
              >
                −
              </button>
              <button
                type="button"
                data-testid="page-width-inc-btn"
                disabled={currentWidthIdx >= PAGE_WIDTH_STEPS.length - 1}
                onClick={() => {
                  const next =
                    PAGE_WIDTH_STEPS[Math.min(PAGE_WIDTH_STEPS.length - 1, currentWidthIdx + 1)];
                  if (next) updateDraft({ pageWidth: next.id });
                }}
                aria-label="Tăng độ rộng khung chữ"
                className="w-7 h-7 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-sm font-semibold hover:border-amber-700 disabled:opacity-35 flex items-center justify-center"
              >
                +
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {(
              [
                { id: 'justify', label: strings.alignJustify },
                { id: 'left', label: strings.alignLeft },
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
              <span>{strings.dropCapLabel}</span>
              <input
                type="checkbox"
                checked={draft.dropCap}
                onChange={(e) => updateDraft({ dropCap: e.target.checked })}
                className="accent-amber-800"
              />
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <span>{strings.firstLineIndentLabel}</span>
              <input
                type="checkbox"
                checked={draft.firstLineIndent}
                onChange={(e) => updateDraft({ firstLineIndent: e.target.checked })}
                className="accent-amber-800"
              />
            </label>
          </div>

          {draft.readingMode === 'scroll' && (
            <div className="space-y-1 pt-1">
              <div className="flex justify-between text-[11px] text-stone-500 tabular-nums">
                <span>{strings.autoScrollLabel}</span>
                <span>{draft.autoScrollSpeed === 0 ? strings.off : `${draft.autoScrollSpeed}`}</span>
              </div>
              <PressHoldSlider
                ariaLabel={strings.autoScrollLabel}
                min={0}
                max={5}
                step={1}
                value={draft.autoScrollSpeed}
                onChange={(v) => updateDraft({ autoScrollSpeed: v })}
              />
            </div>
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
          {strings.done}
        </button>
      </div>
    </>
  );

  return (
    <IosSheet
      isOpen={isOpen}
      onClose={commitAndClose}
      ariaLabel={strings.pageAndBgTitle}
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
