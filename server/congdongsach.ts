import fs from 'fs';
import path from 'path';

export interface CongDongComment {
  id: string;
  authorAlias: string;
  content: string;
  rating: number;
  createdAt: number;
}

export interface CongDongChapter {
  title: string;
  paragraphs: string[];
}

export interface CongDongBookRecord {
  id: string;
  title: string;
  author: string;
  uploaderAlias: string;
  category: string;
  description: string;
  coverGradient: string;
  coverImage?: string;
  downloads: number;
  uploadedAt: number;
  chapters: CongDongChapter[];
  comments: CongDongComment[];
}

const STORE_PATH = path.resolve(process.cwd(), 'server', 'congdongsach-store.json');

const SEED_BOOKS: CongDongBookRecord[] = [
  {
    id: 'cds-hanh-trinh-phuong-dong',
    title: 'Hành Trình Về Phương Đông (Bản Cộng Đồng)',
    author: 'Baird T. Spalding',
    uploaderAlias: 'Độc Giả Ẩn Danh #104',
    category: 'Tản văn & Triết lý',
    description:
      'Bản biên tập sạch lỗi chính tả, tối ưu ngắt câu cho giọng đọc AI tiểu thuyết & tản văn.',
    coverGradient: 'from-amber-800 via-stone-800 to-zinc-900',
    downloads: 1284,
    uploadedAt: Date.now() - 86_400_000 * 12,
    chapters: [
      {
        title: 'Chương 1: Khởi hành giữa mùa gió chướng',
        paragraphs: [
          'Đoàn thám hiểm rời bến cảng vào một buổi sáng sương giăng trắng xóa trên mặt biển Ấn Độ Dương.',
          'Không ai trong chúng tôi nghĩ rằng những trang ghi chép giản dị ban đầu lại mở ra một thế giới tĩnh lặng đến thế.',
          '"Khi tâm trí thôi ồn ào, từng nhịp thở cũng trở thành một trang sách," vị đạo sư mỉm cười nói.',
        ],
      },
      {
        title: 'Chương 2: Đêm bên chân dãy Himalaya',
        paragraphs: [
          'Gió lạnh từ đỉnh tuyết tràn xuống thung lũng, nhưng ánh lửa nhỏ trong căn nhà đá lại ấm áp lạ thường.',
          'Chúng tôi ngồi nghe tiếng chuông đồng ngân vang, cảm nhận thời gian như chậm lại từng nhịp.',
        ],
      },
    ],
    comments: [
      {
        id: 'cmt-seed-1',
        authorAlias: 'Người Đọc Đêm',
        content: 'Bản này ngắt đoạn cực gọn, bật giọng Tản văn nghe trước khi ngủ rất êm.',
        rating: 5,
        createdAt: Date.now() - 86_400_000 * 4,
      },
      {
        id: 'cmt-seed-2',
        authorAlias: 'Ẩn Danh #892',
        content: 'Cảm ơn bác đã chia sẻ, tải về BOOKHAD đọc offline trên máy mượt lắm!',
        rating: 5,
        createdAt: Date.now() - 86_400_000 * 1,
      },
    ],
  },
  {
    id: 'cds-kiem-lai-tien-hiep',
    title: 'Kiếm Lai - Khởi Nguyên Thôn Quê',
    author: 'Phong Hỏa Hí Chư Hầu',
    uploaderAlias: 'Tàng Kinh Các',
    category: 'Tiên hiệp & Kiếm hiệp',
    description:
      'Tuyển tập các chương mở đầu đã lọc sạch quảng cáo web truyện, giữ trọn hội thoại để AI phân vai nhân vật.',
    coverGradient: 'from-slate-800 via-indigo-900 to-zinc-950',
    downloads: 2540,
    uploadedAt: Date.now() - 86_400_000 * 8,
    chapters: [
      {
        title: 'Chương 1: Ngõ nhỏ Nê Bình',
        paragraphs: [
          'Cậu thiếu niên gầy gò ngồi trước hiên nhà gốm cũ, đôi mắt sáng quắc nhìn ra con ngõ lát đá xanh.',
          '"Đừng sợ gió lớn," lão thợ gốm khẽ gõ tẩu thuốc, "người rèn kiếm giỏi nhất chưa bao giờ sợ lửa."',
          'Ngoài đầu ngõ, tiếng vó ngựa đột ngột vang dội xé tan buổi chiều yên ả của trấn nhỏ.',
        ],
      },
      {
        title: 'Chương 2: Lời hẹn dưới tán hòe',
        paragraphs: [
          'Trần Bình An siết chặt quai dép cỏ, bước từng bước vững chãi qua cây cầu đá bắc ngang con suối cạn.',
          '"Đã quyết chí đi đường xa, một bước cũng không được lùi!" cậu nói nhỏ nhưng đầy kiên định.',
        ],
      },
    ],
    comments: [
      {
        id: 'cmt-seed-3',
        authorAlias: 'Kiếm Khách Ẩn Danh',
        content: 'Nghe bằng giọng Tiểu thuyết AI nhấn nhá đoạn đối thoại cực kỳ cuốn!',
        rating: 5,
        createdAt: Date.now() - 86_400_000 * 2,
      },
    ],
  },
  {
    id: 'cds-thoi-quen-nguyen-tu',
    title: 'Ghi Chép Thực Hành: 1% Mỗi Ngày',
    author: 'Ban Biên Tập Cộng Đồng',
    uploaderAlias: 'Học Tập Tự Do',
    category: 'Self-help & Học tập',
    description:
      'Tóm lược chuyên sâu các nguyên lý xây dựng thói quen bền vững, phù hợp phong cách Giọng Học tập.',
    coverGradient: 'from-emerald-800 via-teal-900 to-zinc-950',
    downloads: 942,
    uploadedAt: Date.now() - 86_400_000 * 5,
    chapters: [
      {
        title: 'Chương 1: Sức mạnh của những thay đổi nhỏ',
        paragraphs: [
          'Nếu mỗi ngày bạn tốt hơn chỉ 1%, sau một năm bạn sẽ tiến bộ gấp 37 lần so với xuất phát điểm.',
          'Thói quen là lãi kép của quá trình phát triển bản thân. Đừng đánh giá thấp 15 phút đọc sách mỗi tối.',
        ],
      },
      {
        title: 'Chương 2: Thiết kế môi trường không ma sát',
        paragraphs: [
          'Ý chí có giới hạn, nhưng môi trường thì hoạt động tự động. Hãy đặt cuốn sách ngay nơi dễ nhìn thấy nhất.',
        ],
      },
    ],
    comments: [
      {
        id: 'cmt-seed-4',
        authorAlias: 'Sinh Viên Bách Khoa',
        content: 'Ngắn gọn, dễ áp dụng, rất hợp bật nghe lúc đi bộ buổi sáng.',
        rating: 4,
        createdAt: Date.now() - 86_400_000 * 1,
      },
    ],
  },
  {
    id: 'cds-nhung-la-thu-tu-mua-thu',
    title: 'Những Lá Thư Gửi Mùa Thu',
    author: 'Minh An',
    uploaderAlias: 'Mây Trắng',
    category: 'Tản văn & Tình cảm',
    description:
      'Tuyển tập tản văn nhẹ nhàng về ký ức phố cũ, mùi hoa sữa và những chuyến tàu đêm.',
    coverGradient: 'from-rose-900 via-amber-900 to-stone-950',
    downloads: 618,
    uploadedAt: Date.now() - 86_400_000 * 3,
    chapters: [
      {
        title: 'Thư số 1: Chiều mưa sân ga',
        paragraphs: [
          'Có những cơn mưa mùa thu rơi rất khẽ, đủ để người ta nhớ lại một cái tên đã cất kỹ suốt nhiều năm.',
          'Tiếng còi tàu vọng lại từ cuối đường ray, mang theo hơi ấm của tách trà gừng còn nghi ngút khói.',
        ],
      },
    ],
    comments: [],
  },
];

let memoryCache: CongDongBookRecord[] | null = null;

function ensureLoaded(): CongDongBookRecord[] {
  if (memoryCache) return memoryCache;
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        memoryCache = parsed as CongDongBookRecord[];
        return memoryCache;
      }
    }
  } catch {
    // fall through to seed
  }
  memoryCache = [...SEED_BOOKS];
  persistStore(memoryCache);
  return memoryCache;
}

function persistStore(records: CongDongBookRecord[]): void {
  try {
    const dir = path.dirname(STORE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(records, null, 2), 'utf-8');
  } catch {
    // Non-fatal in read-only environments; keep in memoryCache
  }
}

export function listCongDongBooks(query = '') {
  const all = ensureLoaded();
  const q = query.trim().toLowerCase();
  const filtered = q
    ? all.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          b.author.toLowerCase().includes(q) ||
          b.category.toLowerCase().includes(q) ||
          b.description.toLowerCase().includes(q) ||
          b.uploaderAlias.toLowerCase().includes(q)
      )
    : all;

  return filtered
    .slice()
    .sort((a, b) => b.uploadedAt - a.uploadedAt)
    .map((b) => ({
      id: b.id,
      title: b.title,
      author: b.author,
      uploaderAlias: b.uploaderAlias,
      category: b.category,
      description: b.description,
      coverGradient: b.coverGradient,
      coverImage: b.coverImage,
      downloads: b.downloads,
      uploadedAt: b.uploadedAt,
      chapterCount: b.chapters.length,
      commentCount: b.comments.length,
    }));
}

export function getCongDongBookById(id: string): CongDongBookRecord | null {
  const all = ensureLoaded();
  return all.find((b) => b.id === id) || null;
}

export function createCongDongBook(input: {
  title: string;
  author?: string;
  uploaderAlias?: string;
  category?: string;
  description?: string;
  coverGradient?: string;
  coverImage?: string;
  chapters: CongDongChapter[];
}): CongDongBookRecord {
  const all = ensureLoaded();
  const cleanTitle = input.title.trim().slice(0, 160);
  const cleanChapters = (input.chapters || [])
    .map((ch, idx) => ({
      title: (ch.title || `Chương ${idx + 1}`).trim().slice(0, 160),
      paragraphs: (ch.paragraphs || [])
        .map((p) => String(p || '').trim())
        .filter(Boolean),
    }))
    .filter((ch) => ch.paragraphs.length > 0);

  const gradients = [
    'from-amber-800 via-stone-800 to-zinc-900',
    'from-indigo-900 via-slate-800 to-zinc-950',
    'from-emerald-800 via-teal-900 to-zinc-950',
    'from-rose-900 via-amber-900 to-stone-950',
    'from-violet-900 via-indigo-950 to-zinc-950',
  ];

  const record: CongDongBookRecord = {
    id: `cds-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: cleanTitle,
    author: (input.author || 'Tác giả ẩn danh').trim().slice(0, 120),
    uploaderAlias: (input.uploaderAlias || 'Độc giả ẩn danh').trim().slice(0, 80),
    category: (input.category || 'Cộng đồng chia sẻ').trim().slice(0, 60),
    description: (input.description || 'Sách do thành viên ẩn danh chia sẻ lên congdongsach.')
      .trim()
      .slice(0, 600),
    coverGradient: input.coverGradient || gradients[all.length % gradients.length],
    coverImage: input.coverImage,
    downloads: 0,
    uploadedAt: Date.now(),
    chapters: cleanChapters,
    comments: [],
  };

  all.unshift(record);
  persistStore(all);
  return record;
}

export function incrementCongDongDownload(id: string): CongDongBookRecord | null {
  const all = ensureLoaded();
  const found = all.find((b) => b.id === id);
  if (!found) return null;
  found.downloads += 1;
  persistStore(all);
  return found;
}

export function addCongDongComment(
  bookId: string,
  input: { authorAlias?: string; content: string; rating?: number }
): CongDongComment | null {
  const all = ensureLoaded();
  const found = all.find((b) => b.id === bookId);
  if (!found) return null;

  const comment: CongDongComment = {
    id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    authorAlias: (input.authorAlias || 'Ẩn danh').trim().slice(0, 60),
    content: input.content.trim().slice(0, 800),
    rating: Math.max(1, Math.min(5, Math.round(Number(input.rating) || 5))),
    createdAt: Date.now(),
  };

  found.comments.unshift(comment);
  persistStore(all);
  return comment;
}
