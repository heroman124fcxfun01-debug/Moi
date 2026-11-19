import type { Book } from '../types/book';
import { computeBookFingerprint } from '../utils/syncAndStats';

export function createSeedBooks(): Book[] {
  const now = Date.now();
  const rawBooks: Book[] = [
    {
      id: 'seed-eastern-journey',
      title: 'Hành Trình Phương Đông',
      author: 'Hoàng Nguyên Vũ',
      description:
        'Tiểu thuyết phiêu lưu triết lý về chàng lữ khách băng qua sa mạc cát trắng để tìm lại bản đồ thất lạc và tiếng nói của chính mình.',
      language: 'vi',
      sourceType: 'sample',
      collection: 'Phiêu lưu & Triết lý',
      readingStyle: 'novel',
      coverUrl: '/src/assets/images/cover_eastern_journey_1795004903688.jpg',
      currentChapterIndex: 0,
      currentParagraphIndex: 1,
      progressPercent: 18,
      bookmarks: [],
      highlights: [],
      voiceAssignments: {},
      addedAt: now - 86400000 * 3,
      lastReadAt: now - 1800000,
      chapters: [
        {
          id: 'ch-1',
          index: 0,
          title: 'Chương 1: Đêm Trăng Trên Cồn Cát',
          paragraphs: [
            'Gió đêm từ phía đông thổi qua những triền cát vàng óng ánh dưới ánh trăng khuyết, mang theo mùi hương khô hanh của thảo mộc sa mạc.',
            'Lữ Khách dừng bước trên đỉnh đồi đá, siết chặt quai ba lô da cũ kỹ. Trước mắt cậu, biển cát trải dài vô tận như một trang giấy chưa từng có dấu mực.',
            '"Con tìm gì ở nơi tận cùng của gió?" — giọng nói trầm đục vang lên từ bóng tối bên tảng đá lớn. Đó là Nhà Giả Kim, người gác đền của ốc đảo Al-Qamar, khoác chiếc áo choàng sẫm màu đính những sợi chỉ bạc.',
            'Lữ Khách quay lại, ánh mắt vừa cảnh giác vừa khao khát: "Tôi đi tìm cuốn sách ghi chép thứ ngôn ngữ mà không cần chữ viết người ta vẫn hiểu được nhau."',
            'Nhà Giả Kim khẽ bật cười, tiếng cười vang nhẹ như tiếng chuông đồng cổ: "Mọi kẻ bộ hành đều nói thế khi mới rời khỏi mái nhà của mình. Nhưng sa mạc chỉ trả lời những ai biết lắng nghe sự im lặng."',
            'Từ phía lều vải dưới chân đồi, một cô gái trẻ bước ra với chiếc đèn dầu nhỏ trên tay. Ánh lửa hắt lên khuôn mặt thanh tú nhưng cương nghị của Cô Gái Sa Mạc.',
            '"Thưa thầy, nước giếng đêm nay dâng cao hơn thường lệ," Cô Gái Sa Mạc cất tiếng trong trẻo. Rồi nàng liếc nhìn Lữ Khách: "Và vị khách lạ này mang theo một chiếc la bàn không chỉ hướng bắc."',
            'Lữ Khách ngạc nhiên rút chiếc la bàn đồng trong túi áo ra. Kim la bàn quả thực đang quay chậm rãi về phía ốc đảo nơi họ đang đứng.',
          ],
        },
        {
          id: 'ch-2',
          index: 1,
          title: 'Chương 2: Bí Mật Trong Chợ Gia Vị',
          paragraphs: [
            'Sáng hôm sau, ánh nắng sớm nhuộm hồng những mái vòm đất nung của khu chợ cổ. Tiếng rao hàng, tiếng chuông lạc đà và hương quế hồi hòa quyện thành một bản giao hưởng náo nhiệt.',
            'Lữ Khách đi cạnh Cô Gái Sa Mạc qua những sạp vải lụa nhiều màu. Cậu cẩn thận ghi chép từng câu chuyện truyền miệng vào cuốn sổ bìa da.',
            '"Anh viết nhanh thế để làm gì?" Cô Gái Sa Mạc hỏi, tay khẽ chạm vào một chiếc bình gốm vẽ họa tiết thiên văn. "Nếu chỉ giữ trên giấy, chữ sẽ ngủ yên khi trang sách khép lại."',
            '"Tôi sợ mình sẽ quên mất thanh âm của ngày hôm nay," Lữ Khách đáp nhỏ nhẹ. "Ở quê hương tôi, người ta tin rằng điều gì không được chép lại sẽ tan biến theo gió."',
            'Bỗng từ góc phố, một thương nhân đeo kính gọng đồng bước tới chặn đường họ. Ông ta cúi chào trịnh trọng rồi thì thầm: "Nhà Giả Kim dặn tôi trao cho cậu cuộn giấy này trước khi đoàn lữ hành khởi hành lúc chính ngọ."',
          ],
        },
      ],
    },
    {
      id: 'seed-hanoi-memories',
      title: 'Ký Ức Phố Cổ',
      author: 'Trần Minh Khuê',
      description:
        'Những trang tản văn nhẹ nhàng đan xen giữa hiện tại và hoài niệm bên hồ Gươm buổi sớm mai, nơi một hiệu sách cũ cất giữ những bức thư chưa từng gửi.',
      language: 'vi',
      sourceType: 'sample',
      collection: 'Tản văn & Hoài niệm',
      readingStyle: 'essay',
      coverUrl: '/src/assets/images/cover_hanoi_memories_1795004905310.jpg',
      currentChapterIndex: 0,
      currentParagraphIndex: 0,
      progressPercent: 42,
      bookmarks: [],
      highlights: [],
      voiceAssignments: {},
      addedAt: now - 86400000 * 6,
      lastReadAt: now - 7200000,
      chapters: [
        {
          id: 'ch-1',
          index: 0,
          title: 'Chương 1: Tiệm Sách Dưới Tán Đa',
          paragraphs: [
            'Sương sớm còn bảng lảng trên mặt hồ xanh thẫm, phủ một lớp lụa mỏng lên mái ngói rêu phong của phố Hàng Bạc.',
            'Minh đẩy cánh cửa gỗ lim nặng trịch của hiệu sách An Hiên, tiếng chuông đồng treo trên khung cửa rung lên lanh canh.',
            'Bên trong, Ông Đồ đang cặm cụi lau từng gáy sách bọc vải bố bằng chiếc khăn mềm. Đôi kính lão trễ xuống sống mũi khi ông ngước nhìn cậu cháu trai.',
            '"Hôm nay cháu đến sớm thế, Minh?" Ông Đồ hỏi, giọng ấm áp nhưng pha chút trầm tư. "Ngoài phố chắc vẫn còn lạnh lắm."',
            '"Dạ, cháu mang trà sen mới ướp sang biếu ông," Minh đặt chiếc ấm sứ lên bàn gỗ. "Mà ông ơi, hôm qua có một cô gái ghé hỏi mua tập thơ in từ năm sáu mươi, cô ấy nói để lại lời nhắn trong hộp thư."',
            'Đúng lúc ấy, Linh bước vào từ phía hiên nhà, chiếc áo khoác dạ màu be còn vương vài giọt sương. Cô mỉm cười chào hai ông cháu.',
            '"Cháu chào ông ạ! Anh Minh đã mở cái hộp gỗ cũ ở tầng gác xép chưa?" Linh hỏi, ánh mắt sáng lên vẻ hồi hộp.',
            'Ông Đồ khựng tay lại một nhịp, ánh mắt nhìn lên chiếc cầu thang gỗ xoắn dẫn lên gác xép tối mờ.',
          ],
        },
        {
          id: 'ch-2',
          index: 1,
          title: 'Chương 2: Bức Thư Trong Trang Sách Cũ',
          paragraphs: [
            'Trên gác xép nhỏ, ánh nắng ban mai xuyên qua ô cửa sổ kính màu tạo thành những vệt sáng vàng ấm áp trên sàn gỗ.',
            'Minh mở nắp chiếc hòm thiếc đã hoen gỉ. Bên trong là ba cuốn sổ tay bìa vải xanh và một phong bì giấy dó đề nét mực tím đã phai màu.',
            '"Đọc thử xem nào anh Minh!" Linh khẽ giục, ngồi xuống chiếc ghế đẩu cạnh bàn.',
            'Minh rút tờ giấy mỏng ra, cẩn thận đọc thành tiếng từng dòng chữ mềm mại của nửa thế kỷ trước.',
          ],
        },
      ],
    },
    {
      id: 'seed-skill-focus',
      title: 'Nghệ Thuật Tập Trung Sâu',
      author: 'Nguyễn Bảo Nam',
      description:
        'Cẩm nang học tập & rèn luyện tư duy làm việc sâu giữa thế giới đầy xao nhãng — tối ưu để nghe với văn phong học tập nhấn mạnh các luận điểm cốt lõi.',
      language: 'vi',
      sourceType: 'web',
      collection: 'Học tập & Tư duy',
      readingStyle: 'selfhelp',
      currentChapterIndex: 0,
      currentParagraphIndex: 0,
      progressPercent: 15,
      bookmarks: [],
      highlights: [],
      voiceAssignments: {},
      addedAt: now - 86400000 * 2,
      lastReadAt: now - 5400000,
      sourceUrl: '/demo-web-book/chap-1',
      chapters: [
        {
          id: 'skill-ch-1',
          index: 0,
          title: 'Chương 1: Ba Quy Luật Của Sự Chú Tâm',
          paragraphs: [
            'Trong kỷ nguyên thông báo liên tục, khả năng giữ tâm trí tĩnh lặng trong suốt chín mươi phút chính là lợi thế cạnh tranh lớn nhất của mỗi người.',
            'Điểm cốt lõi đầu tiên bạn cần ghi nhớ: sự tập trung không đến từ việc cố gắng làm nhiều việc cùng lúc, mà đến từ nghệ thuật loại bỏ những việc không quan trọng.',
            'Hãy thực hành nghi thức khởi động năm phút mỗi sáng: dọn sạch mặt bàn, tắt chuông điện thoại và viết ra duy nhất một mục tiêu phải hoàn thành trước giờ trưa.',
            'Khi bạn bảo vệ được giờ làm việc sâu đầu tiên trong ngày, cảm giác chủ động và tự tin sẽ lan tỏa sang mọi quyết định tiếp theo.',
          ],
        },
        {
          id: 'skill-ch-2',
          index: 1,
          title: 'Chương 2: Thiết Kế Môi Trường Đọc Sách Không Xao Nhãng',
          paragraphs: [
            'Ý chí là nguồn tài nguyên có hạn; thay vì ép bản thân chống lại cám dỗ, hãy thiết kế không gian sao cho sự tập trung trở thành lựa chọn dễ dàng nhất.',
            'Nguyên tắc quan trọng thứ hai: phân tách rạch ròi giữa thời gian tiếp nhận thông tin nhanh và thời gian đọc sâu để nghiền ngẫm.',
            'Mỗi tối hai mươi phút đọc sách giấy hoặc nghe sách nói chậm rãi sẽ giúp não bộ sắp xếp lại ký ức và khơi mở những ý tưởng sáng tạo bền vững.',
          ],
        },
      ],
    },
    {
      id: 'seed-prague-clockmaker',
      title: 'The Clockmaker of Prague',
      author: 'Clara Vance',
      description:
        'A short literary mystery set beneath the astronomical clock of Prague — ideal for testing direct Vietnamese override and bilingual translation modes.',
      language: 'en',
      sourceType: 'sample',
      collection: 'Trinh thám cổ điển',
      readingStyle: 'novel',
      coverUrl: '/src/assets/images/cover_prague_clockmaker_1795004905270.jpg',
      currentChapterIndex: 0,
      currentParagraphIndex: 0,
      progressPercent: 10,
      bookmarks: [],
      highlights: [],
      voiceAssignments: {},
      addedAt: now - 86400000 * 10,
      lastReadAt: now - 14400000,
      chapters: [
        {
          id: 'ch-1',
          index: 0,
          title: 'Chapter 1: The Thirteenth Gear',
          paragraphs: [
            'Fog curled around the gothic spires of Old Town Square as midnight approached, muffling the footsteps of late wanderers on the wet cobblestones.',
            'Inside the narrow workshop behind the Astronomical Clock, Master Lukas adjusted his brass magnifying loupe and examined a tiny golden gear that did not belong to any known mechanism.',
            '"This wheel was forged three centuries ago, yet its teeth show no trace of wear," Lukas murmured to himself.',
            'A sharp knock echoed against the oak door. Standing in the lantern light was Elena, an archivist from the Clementinum Library holding a leather-bound ledger.',
            '"Master Lukas, the celestial dial stopped for seven seconds at dusk," Elena said briskly, stepping out of the chill. "And the city chronicles mention a thirteenth gear hidden inside the moon ring."',
            'Lukas set his tweezers down carefully. "If the moon ring has been unlocked, then someone else knows how to read the sky backwards."',
          ],
          translations: {
            vi: {
              targetLang: 'vi',
              translatedAt: now - 10000,
              paragraphs: [
                'Sương mù cuộn quanh những ngọn tháp Gothic của Quảng trường Phố Cổ khi nửa đêm gần kề, làm dịu đi tiếng bước chân của những người dạo bước muộn trên nền đá cuội ẩm ướt.',
                'Bên trong xưởng thợ hẹp phía sau Đồng hồ Thiên văn, Nghệ nhân Lukas chỉnh lại chiếc kính lúp bằng đồng và kiểm tra một bánh răng vàng nhỏ bé không thuộc về bất kỳ cơ cấu nào từng được biết đến.',
                '"Bánh xe này được rèn từ ba thế kỷ trước, vậy mà các răng cưa của nó chẳng hề có dấu vết mài mòn," Lukas khẽ lẩm bẩm một mình.',
                'Một tiếng gõ cửa dứt khoát vang lên trên cánh cửa gỗ sồi. Đứng dưới ánh đèn lồng là Elena, một nhân viên lưu trữ từ Thư viện Clementinum, tay ôm cuốn sổ cái bọc da.',
                '"Thưa nghệ nhân Lukas, mặt số thiên văn đã ngừng chạy bảy giây vào lúc chạng vạng," Elena nói nhanh, bước tránh khỏi cái lạnh bên ngoài. "Và biên niên sử thành phố nhắc đến bánh răng thứ mười ba được giấu trong vòng mặt trăng."',
                'Lukas cẩn thận đặt chiếc nhíp xuống bàn. "Nếu vòng mặt trăng đã được mở khóa, vậy thì còn một người khác nữa biết cách đọc ngược bầu trời."',
              ],
            },
          },
        },
        {
          id: 'ch-2',
          index: 1,
          title: 'Chapter 2: Lanterns Over the Vltava',
          paragraphs: [
            'They walked across Charles Bridge before dawn while the river lay still as smoked glass beneath the stone arches.',
            'Elena opened the ledger under a wrought-iron streetlamp, pointing to a diagram drawn in faded iron-gall ink.',
            '"Look at the alignment between Venus and Mars," she whispered. "Every sixty years, the shadow of the tower points to the vault beneath the river wall."',
          ],
        },
      ],
    },
  ];

  return rawBooks.map((b) => ({
    ...b,
    fingerprint: computeBookFingerprint(b),
  }));
}
