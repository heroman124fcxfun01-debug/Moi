export interface DemoChapter {
  slug: string;
  title: string;
  paragraphs: string[];
  prevSlug: string | null;
  nextSlug: string | null;
}

export const DEMO_WEB_BOOK_CHAPTERS: DemoChapter[] = [
  {
    slug: 'chap-1',
    title: 'Chương 1: Chiếc Chìa Khóa Bằng Đồng',
    prevSlug: null,
    nextSlug: 'chap-2',
    paragraphs: [
      'Cơn mưa rào đầu hạ trút xuống mái ngói tháp đồng hồ cũ kỹ nằm ở rìa thành phố ven biển.',
      'An đứng dưới mái hiên đá, tay nắm chặt chiếc chìa khóa bằng đồng xanh gỉ mà ông nội để lại trong chiếc hộp gỗ trắc.',
      '"Đừng mở cánh cửa tầng gác chuông khi trời chưa nổi gió nam," giọng nói khàn khàn của Ông Tư gác tháp vang lên từ phía sau hành lang tối.',
      'An giật mình quay lại: "Thưa bác, cháu chỉ muốn xem cuốn sổ nhật ký bảo trì từ năm một chín tám mươi còn nằm trên đó không ạ."',
      'Ông Tư khẽ lắc đầu, ánh mắt dõi theo những giọt mưa rơi tí tách qua ô cửa vòm.',
    ],
  },
  {
    slug: 'chap-2',
    title: 'Chương 2: Tiếng Chuông Lúc Nửa Đêm',
    prevSlug: 'chap-1',
    nextSlug: 'chap-3',
    paragraphs: [
      'Đúng mười một giờ năm mươi lăm phút, gió từ biển bắt đầu thổi mạnh qua những khe cửa chớp bằng gỗ sồi.',
      'An bật đèn pin, cẩn thận bước từng bậc thang xoắn ốc bằng gang đã mòn vẹt theo năm tháng.',
      'Trên tầng gác chuông, giữa những bánh răng khổng lồ đứng im lìm, một ngăn tủ nhỏ khắc hình mỏ neo bất ngờ hé mở.',
      '"Hóa ra bộ máy này không dùng để đo giờ," An thì thầm khi nhìn thấy tấm bản đồ thủy triều khắc trên tấm đồng mỏng.',
    ],
  },
  {
    slug: 'chap-3',
    title: 'Chương 3: Bức Mật Thư Dưới Ngọn Hải Đăng',
    prevSlug: 'chap-2',
    nextSlug: 'chap-4',
    paragraphs: [
      'Sáng hôm sau, An mang bản sao tấm bản đồ đến gặp Hải — người bạn thân làm việc tại viện lưu trữ hàng hải.',
      'Hải soi đèn lúp lên từng đường nét khắc chìm rồi reo lên: "Đây là tọa độ của ngọn hải đăng cổ ngoài mũi Đá Bạc, nơi đã bị bỏ hoang từ ba mươi năm trước!"',
      '"Vậy chiều nay khi thủy triều rút, tụi mình thuê thuyền ra đó xem sao," An quyết định dứt khoát.',
      'Ngoài bến cảng, những cánh buồm trắng bắt đầu căng gió chuẩn bị cho một chuyến hải trình bất ngờ.',
    ],
  },
  {
    slug: 'chap-4',
    title: 'Chương 4: Hầm Đá Ngoài Mũi Đá Bạc',
    prevSlug: 'chap-3',
    nextSlug: 'chap-5',
    paragraphs: [
      'Con thuyền gỗ cập bến đá khi nắng chiều nhuộm vàng mặt vịnh phẳng lặng.',
      'Phía sau chân tháp hải đăng phủ đầy dây leo là một khung cửa sắt thấp dẫn xuống căn hầm khô ráo.',
      'Bên trong căn hầm, trên chiếc bàn đá dài, hàng chục cuộn phim ảnh và sổ tay hàng hải được niêm phong cẩn thận trong hộp thiếc.',
      '"Ông nội cậu là người vẽ lại toàn bộ hải đồ vùng vịnh này để bảo vệ các rạn san hô cổ!" Hải thốt lên đầy khâm phục.',
    ],
  },
  {
    slug: 'chap-5',
    title: 'Chương 5: Bình Minh Trên Tháp Đồng Hồ',
    prevSlug: 'chap-4',
    nextSlug: null,
    paragraphs: [
      'Khi trở lại đất liền, An và Hải trao toàn bộ tài liệu quý giá cho bảo tàng hàng hải địa phương để phục dựng và trưng bày.',
      'Sáng chủ nhật hôm đó, lần đầu tiên sau nhiều thập kỷ im lìm, bánh răng tháp đồng hồ lại xoay nhẹ dưới bàn tay chỉnh sửa của người thợ trẻ.',
      'Tiếng chuông ngân vang khắp phố biển hòa cùng tiếng sóng vỗ rì rào, khép lại một bí mật kéo dài suốt ba thế hệ.',
    ],
  },
  {
    slug: 'chap-vip',
    title: 'Chương VIP: Yêu Cầu Trả Phí Đọc Tiếp',
    prevSlug: 'chap-2',
    nextSlug: 'chap-3',
    paragraphs: [
      'Đây là chương VIP bị khóa. Vui lòng trả phí 50 Xu hoặc đăng nhập tài khoản hội viên để đọc tiếp nội dung.',
    ],
  },
];

export function renderDemoChapterHtml(slug: string): string | null {
  const ch = DEMO_WEB_BOOK_CHAPTERS.find((c) => c.slug === slug);
  if (!ch) return null;

  const prevHtml = ch.prevSlug
    ? `<a class="prev-chapter-btn" href="/demo-web-book/${ch.prevSlug}">← Chương trước</a>`
    : `<span class="disabled">Đầu truyện</span>`;
  const nextHtml = ch.nextSlug
    ? `<a class="next-chapter-btn" href="/demo-web-book/${ch.nextSlug}">Chương tiếp →</a>`
    : `<span class="disabled">Hết truyện mẫu</span>`;

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>${ch.title} — Bí Mật Tháp Đồng Hồ</title>
</head>
<body>
  <article class="story-reader">
    <div class="book-meta">Bí Mật Tháp Đồng Hồ · Truyện Web Mẫu</div>
    <h1>${ch.title}</h1>
    ${slug === 'chap-vip' ? '<div class="paywall-notice" data-paywall="true">Chương VIP yêu cầu trả phí để đọc tiếp</div>' : ''}
    <div class="chapter-content">
      ${ch.paragraphs.map((p) => `<p>${p}</p>`).join('\n      ')}
    </div>
    <div class="pager">
      ${prevHtml}
      ${nextHtml}
      <a class="toc-btn" href="/demo-web-book/chap-1">Về trang đầu</a>
    </div>
  </article>
</body>
</html>`;
}
