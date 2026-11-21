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

export interface BuiltinFontOption {
  id: string;
  name: string;
  label: string;
  value: string;
  group: 'ereader' | 'classic';
  origin: string;
  description: string;
  sample: string;
}

export const EREADER_COMMUNITY_FONTS: BuiltinFontOption[] = [
  {
    id: 'literata',
    name: 'Literata',
    label: 'Literata (Huyền thoại máy đọc sách · Google Books)',
    value: "'Literata', Georgia, serif",
    group: 'ereader',
    origin: 'Google Books · Chuẩn E-Ink số 1',
    description:
      'Được cộng đồng Kindle/Kobo/Boox đánh giá cao nhất để thay thế Bookerly; dấu tiếng Việt cực kỳ sắc nét và thoáng mắt.',
    sample: 'Dưới ánh đèn vàng dịu, từng dòng chữ hiện lên êm ái như trang giấy in hảo hạng.',
  },
  {
    id: 'newsreader',
    name: 'Newsreader',
    label: 'Newsreader (Tiểu thuyết & Ấn bản dài kỳ)',
    value: "'Newsreader', Georgia, serif",
    group: 'ereader',
    origin: 'Ấn bản biên tập · E-Ink sắc nét',
    description:
      'Tối ưu quang học cho văn bản dài trên màn hình độ phân giải cao, nhịp chữ cân đối, đọc hàng giờ không mỏi.',
    sample: 'Mỗi trang sách mở ra một chân trời tĩnh lặng giữa nhịp sống vội vã thường ngày.',
  },
  {
    id: 'crimson-pro',
    name: 'Crimson Pro',
    label: 'Crimson Pro (Garamond thanh lịch, văn học)',
    value: "'Crimson Pro', Georgia, serif",
    group: 'ereader',
    origin: 'Cộng đồng yêu sách văn chương',
    description:
      'Lấy cảm hứng từ Garamond kinh điển, nét chữ thanh thoát, bay bổng, cực hợp tiểu thuyết, thơ và triết học.',
    sample: 'Trăm năm trong cõi người ta, chữ tài chữ mệnh khéo là ghét nhau.',
  },
  {
    id: 'vollkorn',
    name: 'Vollkorn',
    label: 'Vollkorn (Sách giấy cổ điển · Kobo/Boox)',
    value: "'Vollkorn', Georgia, serif",
    group: 'ereader',
    origin: 'Cộng đồng Kobo & Onyx Boox',
    description:
      'Phong cách sách in cổ điển châu Âu với nét thanh nét đậm giàu sức sống, cảm giác như cầm cuốn sách giấy bìa cứng.',
    sample: 'Gió thu thổi qua những hàng cây cổ thụ, mang theo mùi giấy mới dịu nhẹ.',
  },
  {
    id: 'eb-garamond',
    name: 'EB Garamond',
    label: 'EB Garamond (Kinh điển ấn bản sưu tầm)',
    value: "'EB Garamond', Georgia, serif",
    group: 'ereader',
    origin: 'Ấn bản văn học thế kỷ 16',
    description:
      'Tinh xảo và sang trọng bậc nhất trong dòng chữ cổ điển, hỗ trợ đầy đủ dấu tiếng Việt hài hòa.',
    sample: 'Những câu chuyện hay nhất luôn ở lại rất lâu sau khi ta khép trang cuối cùng.',
  },
  {
    id: 'spectral',
    name: 'Spectral',
    label: 'Spectral (Serif hiện đại mượt mắt)',
    value: "'Spectral', Georgia, serif",
    group: 'ereader',
    origin: 'Production Type · Tối ưu màn hình số',
    description:
      'Nét chữ chuyển tiếp sắc gọn, gọn chiều ngang giúp chứa nhiều chữ hơn mỗi dòng mà vẫn cực kỳ dễ theo dõi.',
    sample: 'Ánh trăng nghiêng trên mái ngói cũ, soi sáng con đường nhỏ ven sông.',
  },
  {
    id: 'bitter',
    name: 'Bitter',
    label: 'Bitter (Chân vuông E-Ink rõ nét · Đọc đêm)',
    value: "'Bitter', Georgia, serif",
    group: 'ereader',
    origin: 'Slab Serif cho màn hình E-Ink',
    description:
      'Chân chữ vuông vức, thân chữ dày dặn giúp chống lóa và tăng độ tương phản khi đọc ban đêm hoặc cỡ chữ nhỏ.',
    sample: 'Đêm khuya thanh vắng, từng câu chữ đậm nét và rõ ràng đến từng dấu thanh.',
  },
  {
    id: 'lexend',
    name: 'Lexend',
    label: 'Lexend (Đọc nhanh chống mỏi mắt)',
    value: "'Lexend', system-ui, sans-serif",
    group: 'ereader',
    origin: 'Cộng đồng đọc tốc độ & giảm mỏi mắt',
    description:
      'Thiết kế khoa học giúp giảm hiện tượng dính chữ, tăng tốc độ đọc và giảm căng thẳng thị giác đáng kể.',
    sample: 'Khoảng cách chữ rộng rãi giúp mắt lướt nhanh và tiếp thu nội dung nhẹ nhàng hơn.',
  },
  {
    id: 'be-vietnam-pro',
    name: 'Be Vietnam Pro',
    label: 'Be Vietnam Pro (Không chân chuẩn dấu Việt)',
    value: "'Be Vietnam Pro', system-ui, sans-serif",
    group: 'ereader',
    origin: 'Thiết kế riêng cho Tiếng Việt',
    description:
      'Bộ chữ không chân hiện đại được chế tác đặc biệt cho hệ thống dấu thanh tiếng Việt, lý tưởng cho sách kỹ năng & học thuật.',
    sample: 'Tiếng Việt trong sáng, sắc nét đến từng dấu hỏi, dấu ngã và chữ cái đặc trưng.',
  },
];

export const CLASSIC_BUILTIN_FONTS: BuiltinFontOption[] = [
  {
    id: 'lora',
    name: 'Lora',
    label: 'Lora (Sách văn học)',
    value: "'Lora', Georgia, serif",
    group: 'classic',
    origin: 'Mặc định LaziRead',
    description: 'Serif mềm mại, cân bằng tốt cho hầu hết các thể loại tiểu thuyết.',
    sample: 'Một cuốn sách hay là người bạn đồng hành lặng lẽ nhưng bền bỉ.',
  },
  {
    id: 'source-serif-4',
    name: 'Source Serif 4',
    label: 'Source Serif 4 (Ấn bản)',
    value: "'Source Serif 4', Georgia, serif",
    group: 'classic',
    origin: 'Adobe Open Source',
    description: 'Kiểu chữ ấn bản nghiêm túc, chuẩn mực cho sách nghiên cứu & phi hư cấu.',
    sample: 'Tri thức tích lũy từng trang một qua những giờ phút đọc tập trung.',
  },
  {
    id: 'merriweather',
    name: 'Merriweather',
    label: 'Merriweather (Cổ điển)',
    value: "'Merriweather', Georgia, serif",
    group: 'classic',
    origin: 'Kinh điển màn hình số',
    description: 'Chiều cao chữ lớn, dễ đọc trên điện thoại màn hình nhỏ.',
    sample: 'Mỗi chương sách là một cánh cửa bước vào thế giới mới.',
  },
  {
    id: 'playfair-display',
    name: 'Playfair Display',
    label: 'Playfair Display (Nghệ thuật)',
    value: "'Playfair Display', Georgia, serif",
    group: 'classic',
    origin: 'Tạp chí & Nghệ thuật',
    description: 'Tương phản nét đậm mảnh cao, hợp tản văn và trích dẫn nghệ thuật.',
    sample: 'Vẻ đẹp ngôn từ nằm ở nhịp điệu giữa các khoảng lặng.',
  },
  {
    id: 'plus-jakarta-sans',
    name: 'Plus Jakarta Sans',
    label: 'Plus Jakarta Sans (Hiện đại)',
    value: "'Plus Jakarta Sans', system-ui, sans-serif",
    group: 'classic',
    origin: 'Hiện đại tối giản',
    description: 'Không chân sạch sẽ, trẻ trung cho sách công nghệ và ghi chú.',
    sample: 'Gọn gàng, rõ ràng và tối ưu cho trải nghiệm đọc hiện đại.',
  },
  {
    id: 'jetbrains-mono',
    name: 'JetBrains Mono',
    label: 'JetBrains Mono (Đơn cách)',
    value: "'JetBrains Mono', monospace",
    group: 'classic',
    origin: 'Sách kỹ thuật & Lập trình',
    description: 'Phông đơn cách sắc nét dành cho tài liệu kỹ thuật và mã nguồn.',
    sample: 'Độ rộng ký tự đồng đều, chuẩn xác từng dòng lệnh và công thức.',
  },
  {
    id: 'device-system-serif',
    name: 'Phông gốc của máy (Có chân)',
    label: 'Phông gốc của máy (Serif hệ thống)',
    value: 'Georgia, "Times New Roman", serif',
    group: 'classic',
    origin: 'Phông mặc định có sẵn trên thiết bị',
    description: 'Sử dụng trực tiếp phông có chân gốc của điện thoại/máy tính, hiển thị tức thì 100% offline.',
    sample: 'Dưới ánh đèn vàng dịu, từng dòng chữ hiện lên rõ nét ngay trên thiết bị của bạn.',
  },
  {
    id: 'device-system-sans',
    name: 'Phông gốc của máy (Không chân)',
    label: 'Phông gốc của máy (Sans hệ thống)',
    value: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    group: 'classic',
    origin: 'Phông mặc định có sẵn trên thiết bị',
    description: 'Sử dụng trực tiếp phông chữ hệ thống của Android/iOS/Windows, siêu nhẹ và quen mắt.',
    sample: 'Hiển thị tự nhiên theo đúng phông chữ mặc định trên điện thoại của bạn.',
  },
];

export const BUILTIN_FONTS: BuiltinFontOption[] = [
  ...EREADER_COMMUNITY_FONTS,
  ...CLASSIC_BUILTIN_FONTS,
];

export const GEMINI_VOICES: Array<{
  name: GeminiVoiceName;
  label: string;
  gender: 'male' | 'female';
  tone: string;
  isDefault?: boolean;
  isCharacterVoice?: boolean;
}> = [
  {
    name: 'Kore',
    label: 'Nữ ấm (Gốc)',
    gender: 'female',
    tone: 'Mặc định · Tự nhiên, rõ chữ',
    isDefault: true,
  },
  {
    name: 'Charon',
    label: 'Nam trầm',
    gender: 'male',
    tone: 'Điềm đạm, sâu lắng',
    isCharacterVoice: true,
  },
  {
    name: 'Zephyr',
    label: 'Nữ dịu',
    gender: 'female',
    tone: 'Nhẹ nhàng, tình cảm',
    isCharacterVoice: true,
  },
  {
    name: 'Fenrir',
    label: 'Nam vang',
    gender: 'male',
    tone: 'Mạnh mẽ, kịch tính',
    isCharacterVoice: true,
  },
  {
    name: 'Puck',
    label: 'Nam trẻ',
    gender: 'male',
    tone: 'Tươi sáng, linh hoạt',
    isCharacterVoice: true,
  },
  {
    name: 'Aoede',
    label: 'Nữ thanh',
    gender: 'female',
    tone: 'Sắc nét, cá tính',
    isCharacterVoice: true,
  },
];

export const TARGET_LANGUAGES = [
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語 (Tiếng Nhật)' },
  { code: 'zh', label: '中文 (Tiếng Trung)' },
  { code: 'ko', label: '한국어 (Tiếng Hàn)' },
  { code: 'fr', label: 'Français (Tiếng Pháp)' },
];

export async function downloadBlob(blob: Blob, filename: string): Promise<'shared' | 'downloaded'> {
  const isTouchMobile =
    typeof navigator !== 'undefined' &&
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');

  // On mobile WebViews / iOS Safari, Web Share with files gives the most reliable save-to-Files/Downloads dialog
  if (
    isTouchMobile &&
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof File !== 'undefined'
  ) {
    try {
      const file = new File([blob], filename, {
        type: blob.type || 'application/epub+zip',
      });
      if (typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: filename,
        });
        return 'shared';
      }
    } catch (shareErr) {
      // If user dismissed share sheet or share failed, fall through to direct anchor download
      if (shareErr instanceof Error && shareErr.name === 'AbortError') {
        return 'shared';
      }
    }
  }

  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    // Keep anchor & ObjectURL alive long enough for mobile download managers (15 seconds)
    setTimeout(() => {
      try {
        document.body.removeChild(a);
      } catch {
        // already removed
      }
      URL.revokeObjectURL(url);
    }, 15000);
    return 'downloaded';
  } catch {
    // Fallback via FileReader DataURL for restrictive WebViews where createObjectURL fails
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = typeof reader.result === 'string' ? reader.result : '';
        if (dataUrl) {
          const a = document.createElement('a');
          a.href = dataUrl;
          a.download = filename;
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            try {
              document.body.removeChild(a);
            } catch {
              // ignore
            }
          }, 3000);
        }
        resolve('downloaded');
      };
      reader.readAsDataURL(blob);
    });
  }
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
