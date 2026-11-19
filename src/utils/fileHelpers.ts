import type {
  CustomFontAsset,
  ExternalVoiceAsset,
  GeminiVoiceName,
  PaperThemeId,
} from '../types/book';

export interface PaperThemeConfig {
  id: PaperThemeId;
  label: string;
  bg: string;
  text: string;
  muted: string;
  border: string;
  surface: string;
  isDark: boolean;
  badge?: string;
}

export const PAPER_THEMES: PaperThemeConfig[] = [
  {
    id: 'alabaster',
    label: 'Giấy ngà',
    bg: '#F7F4EE',
    text: '#1C1917',
    muted: '#6B655E',
    border: '#E2DDD3',
    surface: '#EFEAE0',
    isDark: false,
  },
  {
    id: 'pure',
    label: 'Sáng tinh',
    bg: '#FFFFFF',
    text: '#111827',
    muted: '#6B7280',
    border: '#E5E7EB',
    surface: '#F9FAFB',
    isDark: false,
  },
  {
    id: 'sepia',
    label: 'Sepia cổ',
    bg: '#EFE4CE',
    text: '#382B1E',
    muted: '#735F49',
    border: '#DDD0B6',
    surface: '#E6D9BE',
    isDark: false,
  },
  {
    id: 'vintage_yellow',
    label: 'Sách cũ ngả vàng',
    bg: '#EDE0BC',
    text: '#362717',
    muted: '#6E5539',
    border: '#D5C398',
    surface: '#E4D4AA',
    isDark: false,
    badge: 'Cổ điển',
  },
  {
    id: 'parchment',
    label: 'Giấy da dê cổ',
    bg: '#E6D4A7',
    text: '#2E2012',
    muted: '#634A2E',
    border: '#CBB380',
    surface: '#DCC795',
    isDark: false,
    badge: 'Ố vàng',
  },
  {
    id: 'newsprint',
    label: 'Giấy sách cũ 90s',
    bg: '#EAE2CE',
    text: '#2B2823',
    muted: '#5F594F',
    border: '#D0C6AF',
    surface: '#E0D7C0',
    isDark: false,
    badge: 'Hoài niệm',
  },
  {
    id: 'amber_aged',
    label: 'Hổ phách ngả vàng',
    bg: '#F2E3B6',
    text: '#3B2814',
    muted: '#755834',
    border: '#DBC58B',
    surface: '#EAD8A4',
    isDark: false,
    badge: 'Ấm mắt',
  },
  {
    id: 'sage',
    label: 'Xanh dịu',
    bg: '#E8EFE9',
    text: '#1A281E',
    muted: '#4B6352',
    border: '#CFDEC2',
    surface: '#DCE7DD',
    isDark: false,
  },
  {
    id: 'charcoal',
    label: 'Tối nhẹ',
    bg: '#1E2024',
    text: '#E4E2DD',
    muted: '#9CA3AF',
    border: '#2E3138',
    surface: '#26292E',
    isDark: true,
  },
  {
    id: 'oled',
    label: 'Đêm OLED',
    bg: '#0C0D10',
    text: '#E5E5E5',
    muted: '#8E8E93',
    border: '#22242A',
    surface: '#16181D',
    isDark: true,
  },
];

export const BUILTIN_FONTS = [
  { label: 'Lora (Sách văn học)', value: "'Lora', Georgia, serif" },
  { label: 'Source Serif 4 (Ấn bản)', value: "'Source Serif 4', Georgia, serif" },
  { label: 'Merriweather (Cổ điển)', value: "'Merriweather', Georgia, serif" },
  { label: 'Playfair Display (Nghệ thuật)', value: "'Playfair Display', Georgia, serif" },
  { label: 'Plus Jakarta Sans (Hiện đại)', value: "'Plus Jakarta Sans', system-ui, sans-serif" },
  { label: 'JetBrains Mono (Đơn cách)', value: "'JetBrains Mono', monospace" },
];

export const GEMINI_VOICES: Array<{
  name: GeminiVoiceName;
  label: string;
  gender: 'male' | 'female';
  tone: string;
}> = [
  { name: 'Kore', label: 'Kore · Nữ trầm ấm', gender: 'female', tone: 'Êm ái, truyền cảm, hợp dẫn truyện' },
  { name: 'Zephyr', label: 'Zephyr · Nữ thanh thoát', gender: 'female', tone: 'Nhẹ nhàng, trẻ trung, rõ nét' },
  { name: 'Charon', label: 'Charon · Nam trầm sâu', gender: 'male', tone: 'Điềm đạm, sâu lắng, trưởng thành' },
  { name: 'Puck', label: 'Puck · Nam năng động', gender: 'male', tone: 'Linh hoạt, biểu cảm, hợp hội thoại' },
  { name: 'Fenrir', label: 'Fenrir · Nam uy lực', gender: 'male', tone: 'Mạnh mẽ, dứt khoát, kịch tính' },
];

export const TARGET_LANGUAGES = [
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語 (Tiếng Nhật)' },
  { code: 'zh', label: '中文 (Tiếng Trung)' },
  { code: 'ko', label: '한국어 (Tiếng Hàn)' },
  { code: 'fr', label: 'Français (Tiếng Pháp)' },
];

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error || new Error('Không đọc được tệp'));
    reader.readAsArrayBuffer(file);
  });
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error || new Error('Không đọc được tệp'));
    reader.readAsDataURL(file);
  });
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error || new Error('Không đọc được tệp văn bản'));
    reader.readAsText(file, 'utf-8');
  });
}

export async function createCustomFontFromFile(file: File): Promise<CustomFontAsset> {
  const dataUrl = await readFileAsDataUrl(file);
  const baseName = file.name.replace(/\.(ttf|otf|woff2?|eot)$/i, '');
  const ext = file.name.split('.').pop()?.toLowerCase() || 'ttf';
  const safeFamily = `Custom_${baseName.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now().toString(36)}`;
  return {
    id: `font-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: baseName,
    fontFamily: safeFamily,
    fileName: file.name,
    format: ext,
    dataUrl,
    addedAt: Date.now(),
  };
}

export async function createExternalVoiceFromFile(file: File): Promise<ExternalVoiceAsset> {
  const dataUrl = await readFileAsDataUrl(file);
  const baseName = file.name.replace(/\.(mp3|wav|ogg|m4a|webm|aac)$/i, '');
  const mimeType = file.type || 'audio/mp3';
  return {
    id: `voice-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: baseName,
    fileName: file.name,
    mimeType,
    dataUrl,
    addedAt: Date.now(),
  };
}

export function slugifyFilename(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'laziread-book'
  );
}
