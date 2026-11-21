export type AppLanguage = 'vi' | 'en' | 'zh';

export interface AppStrings {
  langLabel: string;
  langShort: string;
  langFlag: string;
  // Navigation
  navLibrary: string;
  navReader: string;
  navCommunity: string;
  navStudio: string;
  navSettings: string;
  searchAll: string;
  toggleDark: string;
  toggleLight: string;
  // Library
  importBook: string;
  searchBooks: string;
  readingTime: string;
  recentlyRead: string;
  privateLibrary: string;
  noRecentBook: string;
  continueReading: string;
  totalReadingHours: string;
  periodRowLabel: string;
  dailyAverageLabel: string;
  anonymousBtn: string;
  addBookBtn: string;
  tabAll: string;
  tabImported: string;
  tabDownloaded: string;
  tabCollections: string;
  searchCollections: string;
  loadingLibrary: string;
  // Reader & Quick Actions (!)
  backToLibrary: string;
  back: string;
  done: string;
  cancel: string;
  accept: string;
  close: string;
  prevPage: string;
  nextPage: string;
  options: string;
  fontAndBg: string;
  pageAndBgTitle: string;
  quickEditTitle: string;
  fontSize: string;
  lineHeight: string;
  paragraphSpacing: string;
  letterSpacing: string;
  fontWeight: string;
  marginTop: string;
  marginBottom: string;
  marginHorizontal: string;
  marginVertical: string;
  marginHorizontalQuick: string;
  translate: string;
  translated: string;
  quickTranslate: string;
  exportEpub: string;
  aiCleanBook: string;
  scanning: string;
  // Reader Settings Drawer
  slidersHeading: string;
  paperThemeHeading: string;
  customColor: string;
  bgColor: string;
  textColor: string;
  brightness: string;
  warmthYellow: string;
  fontsHeading: string;
  addFont: string;
  pageTurnModeHeading: string;
  turnSlide: string;
  turnScroll: string;
  turnCurl: string;
  singlePage: string;
  twoPages: string;
  pageWidthLabel: string;
  widthNarrow: string;
  widthMedium: string;
  widthWide: string;
  widthFull: string;
  alignJustify: string;
  alignLeft: string;
  dropCapLabel: string;
  firstLineIndentLabel: string;
  autoScrollLabel: string;
  off: string;
  on: string;
  // Audiobook Drawer
  audiobookTitle: string;
  play: string;
  pause: string;
  stop: string;
  highlightSpoken: string;
  aiFixErrors: string;
  aiFixErrorsActive: string;
  aiFixErrorsOff: string;
  sleepTimer: string;
  sleepHours: string;
  sleepMinutes: string;
  sleepEmptyHint: string;
  sleepRemainingPrefix: string;
  sleepOff: string;
  sleepEndChapter: string;
  readingStyle: string;
  narratorVoice: string;
  preview: string;
  previewing: string;
  characterVoice: string;
  scanBook: string;
  confirmSave: string;
  characterLockedHint: string;
  characterNarratorFallbackHint: string;
  // Ambient Sound Drawer
  ambientHeading: string;
  ambientDrawerTitle: string;
  masterVolume: string;
  stopAll: string;
  activeAmbientPrefix: string;
  // Voice Studio (Minimalist 6-Row Creator)
  voiceStudio: string;
  createVoice: string;
  createVoiceShort: string;
  importVoiceBtn: string;
  voiceReadyBadge: string;
  voiceNameLabel: string;
  voiceNamePlaceholder: string;
  voiceStyleLabel: string;
  aiInstructionLabel: string;
  aiInstructionPlaceholder: string;
  previewTextLabel: string;
  defaultPreviewText: string;
  previewVoiceBtn: string;
  stopPreviewBtn: string;
  saveVoiceBtn: string;
  saveVoiceConfirmPrefix: string;
  saveVoiceConfirmHint: string;
  voicesHeading: string;
  pronunciationHeading: string;
  // Settings & Language
  settingsHeading: string;
  basicSettingsHeading: string;
  basicShortHeading: string;
  themeLabel: string;
  themeLight: string;
  themeDark: string;
  tapToTurnPageLabel: string;
  keepScreenAwakeLabel: string;
  autoResumeLastBookLabel: string;
  volumeKeyPageTurnLabel: string;
  appearanceHeading: string;
  accentColorLabel: string;
  wallpaperLabel: string;
  languageLabel: string;
  languageDesc: string;
  // Community / Web / Modals
  communityTitle: string;
  shareAnonymously: string;
  disclaimerTitle: string;
  privacyPolicy: string;
  understand: string;
  mp3ToEpubPlaceholder: string;
  searchNovelPlaceholder: string;
  webReadBtn: string;
  webBrowserBtn: string;
  pasteLinkBtn: string;
  // Reader / Audiobook / Studio aliases
  listenBook: string;
  hours: string;
  minutes: string;
  sleepTimerHint: string;
  narrator: string;
  playing: string;
  previewShort: string;
  characters: string;
  scan: string;
  confirm: string;
  ambientMusic: string;
  translateQuick: string;
  readerOptions: string;
  textBgAndTurn: string;
  readingVoice: string;
  aiCleanScan: string;
  translateAndExportEpub: string;
  toc: string;
  voiceReady: string;
  importVoice: string;
  voiceName: string;
  voiceStyle: string;
  aiInstruction: string;
  previewContent: string;
  stopPreview: string;
  previewVoice: string;
  saveVoice: string;
}

const VI: AppStrings = {
  langLabel: 'Tiếng Việt',
  langShort: 'VI',
  langFlag: '🇻🇳',
  navLibrary: 'Thư viện',
  navReader: 'Trình đọc',
  navCommunity: 'Cộng đồng',
  navStudio: 'Giọng đọc',
  navSettings: 'Cài đặt',
  searchAll: 'Tìm kiếm',
  toggleDark: 'Giao diện tối',
  toggleLight: 'Giao diện sáng',
  importBook: 'Nhập sách',
  searchBooks: 'Tìm tên sách, tác giả...',
  readingTime: 'Thời gian đọc',
  recentlyRead: 'Sách mới đọc',
  privateLibrary: 'Kho sách riêng',
  noRecentBook: 'Chưa có sách nào',
  continueReading: 'Đọc tiếp',
  totalReadingHours: 'Tổng giờ đọc',
  periodRowLabel: 'Ngày / Tuần / Tháng / T.trước',
  dailyAverageLabel: 'TB 1 ngày:',
  anonymousBtn: 'Ẩn danh',
  addBookBtn: 'Thêm sách',
  tabAll: 'Tất cả',
  tabImported: 'Sách đã cho vào',
  tabDownloaded: 'Sách tải về',
  tabCollections: 'Bộ sưu tập',
  searchCollections: 'Tìm bộ sưu tập...',
  loadingLibrary: 'Đang tải tủ sách BOOKHAD...',
  backToLibrary: 'Tủ sách',
  back: 'Quay lại',
  done: 'Xong',
  cancel: 'Hủy',
  accept: 'Chấp nhận',
  close: 'Đóng',
  prevPage: 'Trước',
  nextPage: 'Tiếp',
  options: 'Tùy chọn',
  fontAndBg: 'Chữ, Nền & Lật',
  pageAndBgTitle: 'Chữ & Nền',
  quickEditTitle: 'Chỉnh nhanh giao diện đọc',
  fontSize: 'Cỡ chữ',
  lineHeight: 'Giãn dòng',
  paragraphSpacing: 'Khoảng đoạn',
  letterSpacing: 'Giãn chữ',
  fontWeight: 'Độ đậm',
  marginTop: 'Lề trên',
  marginBottom: 'Lề dưới',
  marginHorizontal: 'Lề ngang',
  marginVertical: 'Lề trên/dưới',
  marginHorizontalQuick: 'Lề trái/phải',
  translate: 'Dịch',
  translated: 'Đã dịch',
  quickTranslate: 'Dịch nhanh',
  exportEpub: 'Xuất EPUB',
  aiCleanBook: 'AI Quét sạch',
  scanning: 'Đang quét...',
  slidersHeading: 'Cỡ chữ, Giãn dòng & Lề trang (Nhấn giữ để kéo)',
  paperThemeHeading: 'Màu nền & Giấy sách',
  customColor: 'Màu tự chọn',
  bgColor: 'Nền',
  textColor: 'Chữ',
  brightness: 'Độ sáng',
  warmthYellow: 'Ánh vàng',
  fontsHeading: 'Phông chữ',
  addFont: 'Thêm phông',
  pageTurnModeHeading: 'Chế độ lật trang',
  turnSlide: 'Trượt ngang mờ dần',
  turnScroll: 'Lướt dọc',
  turnCurl: 'Lật cong góc 3D',
  singlePage: '1 trang đơn',
  twoPages: '2 trang sách mở',
  pageWidthLabel: 'Độ rộng khung chữ',
  widthNarrow: 'Hẹp',
  widthMedium: 'Chuẩn',
  widthWide: 'Rộng',
  widthFull: 'Tràn lề',
  alignJustify: 'Canh đều hai bên',
  alignLeft: 'Canh trái',
  dropCapLabel: 'Viết hoa đầu chương',
  firstLineIndentLabel: 'Thụt đầu dòng mỗi đoạn văn',
  autoScrollLabel: 'Tự động cuộn trang',
  off: 'Tắt',
  on: 'Bật',
  audiobookTitle: 'Nghe sách',
  play: 'Phát',
  pause: 'Tạm dừng',
  stop: 'Dừng',
  highlightSpoken: 'Sáng chữ đang đọc',
  aiFixErrors: 'AI sửa lỗi',
  aiFixErrorsActive: 'Tự bỏ link/địa chỉ thừa & sửa lỗi chữ trước khi đọc',
  aiFixErrorsOff: 'Đang tắt — đọc nguyên văn từng dòng',
  sleepTimer: 'Hẹn giờ tắt',
  sleepHours: 'giờ',
  sleepMinutes: 'phút',
  sleepEmptyHint: 'Để trống: Dừng khi hết chương',
  sleepRemainingPrefix: 'Còn',
  sleepOff: 'Tắt',
  sleepEndChapter: 'Hết chương',
  readingStyle: 'Phong cách',
  narratorVoice: 'Dẫn truyện',
  preview: 'Thử',
  previewing: 'Đang phát',
  characterVoice: 'Nhân vật',
  scanBook: 'Quét',
  confirmSave: 'Xác nhận',
  characterLockedHint: 'Bấm Quét toàn bộ sách (tối đa 10 nhân vật), gán giọng rồi bấm Xác nhận.',
  characterNarratorFallbackHint: 'Đang dùng giọng dẫn truyện cho mọi lời thoại.',
  ambientHeading: 'Nhạc nền',
  ambientDrawerTitle: 'Âm thanh & Nhạc nền',
  masterVolume: 'Âm lượng tổng',
  stopAll: 'Tắt hết',
  activeAmbientPrefix: 'Đang phát',
  voiceStudio: 'Giọng đọc & Giao diện',
  createVoice: 'Tạo giọng mới',
  createVoiceShort: 'Tạo giọng',
  importVoiceBtn: 'Import Voice',
  voiceReadyBadge: 'Sẵn sàng',
  voiceNameLabel: 'Tên giọng',
  voiceNamePlaceholder: 'Ví dụ: Nhân vật A...',
  voiceStyleLabel: 'Văn phong',
  aiInstructionLabel: 'Mô tả chỉ dẫn AI',
  aiInstructionPlaceholder: 'Mô tả cảm xúc, nhấn nhá, ngữ cảnh đọc...',
  previewTextLabel: 'Nội dung nghe thử',
  defaultPreviewText: 'Đêm khuya thanh vắng, từng trang sách mở ra như một hành trình kỳ diệu đưa tâm trí đi xa.',
  previewVoiceBtn: 'Nghe thử',
  stopPreviewBtn: 'Dừng thử',
  saveVoiceBtn: 'Lưu giọng',
  saveVoiceConfirmPrefix: 'Lưu giọng',
  saveVoiceConfirmHint: 'Giọng nhân bản cùng vector âm sắc gốc sẽ được lưu vào thư viện giọng đọc của bạn.',
  voicesHeading: 'Giọng đọc',
  pronunciationHeading: 'Từ điển phát âm',
  settingsHeading: 'Cài đặt & Đồng bộ',
  basicSettingsHeading: 'Cài đặt cơ bản',
  basicShortHeading: 'Cơ bản',
  themeLabel: 'Giao diện',
  themeLight: 'Sáng',
  themeDark: 'Tối',
  tapToTurnPageLabel: 'Chạm lật trang',
  keepScreenAwakeLabel: 'Giữ sáng màn',
  autoResumeLastBookLabel: 'Tự mở sách cũ',
  volumeKeyPageTurnLabel: 'Phím âm lượng',
  appearanceHeading: 'Màu & Ảnh nền',
  accentColorLabel: 'Màu chủ đạo',
  wallpaperLabel: 'Ảnh nền',
  languageLabel: 'Ngôn ngữ hệ thống',
  languageDesc: 'Đổi ngôn ngữ giao diện toàn ứng dụng',
  communityTitle: 'Cộng đồng chia sẻ',
  shareAnonymously: '+ Chia sẻ',
  disclaimerTitle: 'Tuyên bố miễn trừ trách nhiệm',
  privacyPolicy: 'Chính sách quyền riêng tư',
  understand: 'Đã hiểu',
  mp3ToEpubPlaceholder: 'MP3 sang Epub',
  searchNovelPlaceholder: 'Tìm truyện',
  webReadBtn: 'Đọc',
  webBrowserBtn: 'Trình duyệt',
  pasteLinkBtn: 'Dán link',
  listenBook: 'Nghe sách',
  hours: 'giờ',
  minutes: 'phút',
  sleepTimerHint: 'Để trống: Dừng khi hết chương',
  narrator: 'Dẫn truyện',
  playing: 'Đang phát',
  previewShort: 'Thử',
  characters: 'Nhân vật',
  scan: 'Quét',
  confirm: 'Xác nhận',
  ambientMusic: 'Nhạc nền',
  translateQuick: 'Dịch nhanh',
  readerOptions: 'Tùy chọn đọc',
  textBgAndTurn: 'Chữ, Nền & Lật',
  readingVoice: 'Giọng đọc',
  aiCleanScan: 'AI Quét sạch',
  translateAndExportEpub: 'Dịch & Xuất EPUB',
  toc: 'Mục lục',
  voiceReady: 'Sẵn sàng',
  importVoice: 'Import Voice',
  voiceName: 'Tên giọng',
  voiceStyle: 'Văn phong',
  aiInstruction: 'Mô tả chỉ dẫn AI',
  previewContent: 'Nội dung nghe thử',
  stopPreview: 'Dừng thử',
  previewVoice: 'Nghe thử',
  saveVoice: 'Lưu giọng',
};

const EN: AppStrings = {
  langLabel: 'English',
  langShort: 'EN',
  langFlag: '🇺🇸',
  navLibrary: 'Library',
  navReader: 'Reader',
  navCommunity: 'Community',
  navStudio: 'Voices',
  navSettings: 'Settings',
  searchAll: 'Search',
  toggleDark: 'Dark mode',
  toggleLight: 'Light mode',
  importBook: 'Import',
  searchBooks: 'Search title or author...',
  readingTime: 'Reading Time',
  recentlyRead: 'Recently Read',
  privateLibrary: 'My Library',
  noRecentBook: 'No books yet',
  continueReading: 'Continue',
  totalReadingHours: 'Total Hours',
  periodRowLabel: 'Day / Week / Month / Prev',
  dailyAverageLabel: 'Daily avg:',
  anonymousBtn: 'Community',
  addBookBtn: 'Add Book',
  tabAll: 'All',
  tabImported: 'Imported',
  tabDownloaded: 'Downloaded',
  tabCollections: 'Collections',
  searchCollections: 'Search collections...',
  loadingLibrary: 'Loading BOOKHAD library...',
  backToLibrary: 'Library',
  back: 'Back',
  done: 'Done',
  cancel: 'Cancel',
  accept: 'Confirm',
  close: 'Close',
  prevPage: 'Prev',
  nextPage: 'Next',
  options: 'Options',
  fontAndBg: 'Text, Theme & Flip',
  pageAndBgTitle: 'Text & Theme',
  quickEditTitle: 'Quick Reader Controls',
  fontSize: 'Font size',
  lineHeight: 'Line height',
  paragraphSpacing: 'Paragraph gap',
  letterSpacing: 'Letter spacing',
  fontWeight: 'Font weight',
  marginTop: 'Top margin',
  marginBottom: 'Bottom margin',
  marginHorizontal: 'Side margin',
  marginVertical: 'Top/Bottom margin',
  marginHorizontalQuick: 'Left/Right margin',
  translate: 'Translate',
  translated: 'Translated',
  quickTranslate: 'Quick Translate',
  exportEpub: 'Export EPUB',
  aiCleanBook: 'AI Clean Book',
  scanning: 'Scanning...',
  slidersHeading: 'Type, Spacing & Margins (Press & hold to drag)',
  paperThemeHeading: 'Paper & Theme',
  customColor: 'Custom color',
  bgColor: 'Bg',
  textColor: 'Text',
  brightness: 'Brightness',
  warmthYellow: 'Warm glow',
  fontsHeading: 'Fonts',
  addFont: 'Add font',
  pageTurnModeHeading: 'Page Turn Mode',
  turnSlide: 'Fade Slide',
  turnScroll: 'Vertical Scroll',
  turnCurl: '3D Corner Curl',
  singlePage: 'Single Page',
  twoPages: 'Two-Page Spread',
  pageWidthLabel: 'Text Frame Width',
  widthNarrow: 'Narrow',
  widthMedium: 'Medium',
  widthWide: 'Wide',
  widthFull: 'Full',
  alignJustify: 'Justified',
  alignLeft: 'Left Aligned',
  dropCapLabel: 'Chapter Drop Cap',
  firstLineIndentLabel: 'First-line paragraph indent',
  autoScrollLabel: 'Auto-scroll speed',
  off: 'Off',
  on: 'On',
  audiobookTitle: 'Audiobook',
  play: 'Play',
  pause: 'Pause',
  stop: 'Stop',
  highlightSpoken: 'Highlight spoken text',
  aiFixErrors: 'AI Fix Errors',
  aiFixErrorsActive: 'Auto-skip links/junk & fix typos before speaking',
  aiFixErrorsOff: 'Off — reading raw text verbatim',
  sleepTimer: 'Sleep Timer',
  sleepHours: 'hr',
  sleepMinutes: 'min',
  sleepEmptyHint: 'Leave empty: Stop at end of chapter',
  sleepRemainingPrefix: 'Left',
  sleepOff: 'Off',
  sleepEndChapter: 'End of Ch.',
  readingStyle: 'Reading Style',
  narratorVoice: 'Narrator',
  preview: 'Test',
  previewing: 'Playing',
  characterVoice: 'Characters',
  scanBook: 'Scan',
  confirmSave: 'Confirm',
  characterLockedHint: 'Tap Scan (up to 10 characters), assign voices, then tap Confirm.',
  characterNarratorFallbackHint: 'Using narrator voice for all dialogue.',
  ambientHeading: 'Ambient Audio',
  ambientDrawerTitle: 'Ambient & Music',
  masterVolume: 'Master Volume',
  stopAll: 'Stop All',
  activeAmbientPrefix: 'Playing',
  voiceStudio: 'Voice & Typography',
  createVoice: 'Create Voice',
  createVoiceShort: 'Create Voice',
  importVoiceBtn: 'Import Voice',
  voiceReadyBadge: 'Ready',
  voiceNameLabel: 'Voice Name',
  voiceNamePlaceholder: 'e.g., Character A...',
  voiceStyleLabel: 'Style',
  aiInstructionLabel: 'AI Instruction',
  aiInstructionPlaceholder: 'Describe emotion, emphasis, or reading context...',
  previewTextLabel: 'Preview Passage',
  defaultPreviewText: 'In the quiet midnight, each turned page opens a vivid journey far beyond the horizon.',
  previewVoiceBtn: 'Preview',
  stopPreviewBtn: 'Stop',
  saveVoiceBtn: 'Save Voice',
  saveVoiceConfirmPrefix: 'Save voice',
  saveVoiceConfirmHint: 'Your cloned voice and extracted on-device timbre vector will be saved to your library.',
  voicesHeading: 'Voices',
  pronunciationHeading: 'Pronunciation Dictionary',
  settingsHeading: 'Settings & Sync',
  basicSettingsHeading: 'Basic Settings',
  basicShortHeading: 'Basic',
  themeLabel: 'Appearance',
  themeLight: 'Light',
  themeDark: 'Dark',
  tapToTurnPageLabel: 'Tap to turn page',
  keepScreenAwakeLabel: 'Keep screen awake',
  autoResumeLastBookLabel: 'Resume last book',
  volumeKeyPageTurnLabel: 'Volume key turn',
  appearanceHeading: 'Color & Wallpaper',
  accentColorLabel: 'Accent color',
  wallpaperLabel: 'Wallpaper',
  languageLabel: 'System Language',
  languageDesc: 'Switch interface language across the app',
  communityTitle: 'Community Library',
  shareAnonymously: '+ Share',
  disclaimerTitle: 'Disclaimer',
  privacyPolicy: 'Privacy Policy',
  understand: 'Got it',
  mp3ToEpubPlaceholder: 'YouTube / MP3 to EPUB',
  searchNovelPlaceholder: 'Search or paste novel URL',
  webReadBtn: 'Read',
  webBrowserBtn: 'Browser',
  pasteLinkBtn: 'Paste link',
  listenBook: 'Audiobook',
  hours: 'hr',
  minutes: 'min',
  sleepTimerHint: 'Leave empty: Stop at end of chapter',
  narrator: 'Narrator',
  playing: 'Playing',
  previewShort: 'Test',
  characters: 'Characters',
  scan: 'Scan',
  confirm: 'Confirm',
  ambientMusic: 'Ambient Audio',
  translateQuick: 'Translate',
  readerOptions: 'Reader Options',
  textBgAndTurn: 'Text, Theme & Flip',
  readingVoice: 'Reading Voice',
  aiCleanScan: 'AI Clean Book',
  translateAndExportEpub: 'Translate & Export EPUB',
  toc: 'Contents',
  voiceReady: 'Ready',
  importVoice: 'Import Voice',
  voiceName: 'Voice Name',
  voiceStyle: 'Style',
  aiInstruction: 'AI Instruction',
  previewContent: 'Preview Passage',
  stopPreview: 'Stop',
  previewVoice: 'Preview',
  saveVoice: 'Save Voice',
};

const ZH: AppStrings = {
  langLabel: '中文',
  langShort: '中',
  langFlag: '🇨🇳',
  navLibrary: '书库',
  navReader: '阅读器',
  navCommunity: '社区',
  navStudio: '语音',
  navSettings: '设置',
  searchAll: '搜索',
  toggleDark: '深色模式',
  toggleLight: '浅色模式',
  importBook: '导入书籍',
  searchBooks: '搜索书名或作者...',
  readingTime: '阅读时长',
  recentlyRead: '最近阅读',
  privateLibrary: '私人书库',
  noRecentBook: '暂无书籍',
  continueReading: '继续阅读',
  totalReadingHours: '总阅读时长',
  periodRowLabel: '日 / 周 / 月 / 上月',
  dailyAverageLabel: '日均:',
  anonymousBtn: '匿名社区',
  addBookBtn: '导入书籍',
  tabAll: '全部',
  tabImported: '本地导入',
  tabDownloaded: '网络下载',
  tabCollections: '书单合集',
  searchCollections: '搜索书单...',
  loadingLibrary: '正在加载 BOOKHAD 书库...',
  backToLibrary: '书架',
  back: '返回',
  done: '完成',
  cancel: '取消',
  accept: '确认',
  close: '关闭',
  prevPage: '上一页',
  nextPage: '下一页',
  options: '选项',
  fontAndBg: '字体、背景与翻页',
  pageAndBgTitle: '字体与背景',
  quickEditTitle: '快捷阅读调整',
  fontSize: '字号',
  lineHeight: '行距',
  paragraphSpacing: '段距',
  letterSpacing: '字距',
  fontWeight: '字重',
  marginTop: '上边距',
  marginBottom: '下边距',
  marginHorizontal: '左右边距',
  marginVertical: '上下边距',
  marginHorizontalQuick: '左右边距',
  translate: '翻译',
  translated: '已翻译',
  quickTranslate: '快捷翻译',
  exportEpub: '导出 EPUB',
  aiCleanBook: 'AI 净化文本',
  scanning: '正在扫描...',
  slidersHeading: '排版与边距（长按拖动调节）',
  paperThemeHeading: '纸张与背景色',
  customColor: '自定义颜色',
  bgColor: '背景',
  textColor: '文字',
  brightness: '亮度',
  warmthYellow: '暖黄光',
  fontsHeading: '字体',
  addFont: '添加字体',
  pageTurnModeHeading: '翻页模式',
  turnSlide: '淡出平移',
  turnScroll: '上下滚动',
  turnCurl: '3D 卷角翻页',
  singlePage: '单页',
  twoPages: '双页摊开',
  pageWidthLabel: '正文宽度',
  widthNarrow: '较窄',
  widthMedium: '标准',
  widthWide: '较宽',
  widthFull: '满屏',
  alignJustify: '两端对齐',
  alignLeft: '左对齐',
  dropCapLabel: '章首放大字',
  firstLineIndentLabel: '段落首行缩进',
  autoScrollLabel: '自动滚动',
  off: '关',
  on: '开',
  audiobookTitle: '听书',
  play: '播放',
  pause: '暂停',
  stop: '停止',
  highlightSpoken: '朗读高亮',
  aiFixErrors: 'AI 纠错',
  aiFixErrorsActive: '朗读前自动跳过广告链接并修复错字',
  aiFixErrorsOff: '已关闭 — 按原文逐句朗读',
  sleepTimer: '定时关闭',
  sleepHours: '时',
  sleepMinutes: '分',
  sleepEmptyHint: '留空：本章读完自动停止',
  sleepRemainingPrefix: '剩余',
  sleepOff: '关闭',
  sleepEndChapter: '本章结束',
  readingStyle: '朗读风格',
  narratorVoice: '旁白语音',
  preview: '试听',
  previewing: '试听中',
  characterVoice: '角色配音',
  scanBook: '扫描',
  confirmSave: '确认',
  characterLockedHint: '点击扫描全书（最多10位角色），分配语音后点击确认。',
  characterNarratorFallbackHint: '所有对白当前使用旁白语音。',
  ambientHeading: '背景音效',
  ambientDrawerTitle: '音效与背景音乐',
  masterVolume: '总音量',
  stopAll: '全部停止',
  activeAmbientPrefix: '播放中',
  voiceStudio: '语音与字体',
  createVoice: '创建语音',
  createVoiceShort: '创建语音',
  importVoiceBtn: '导入语音',
  voiceReadyBadge: '已就绪',
  voiceNameLabel: '语音名称',
  voiceNamePlaceholder: '例如：角色 A...',
  voiceStyleLabel: '风格',
  aiInstructionLabel: 'AI 朗读指令',
  aiInstructionPlaceholder: '描述情感、重音或朗读语境...',
  previewTextLabel: '试听文本',
  defaultPreviewText: '夜深人静，翻开书页仿佛踏上一场穿越星海的奇妙旅程。',
  previewVoiceBtn: '试听',
  stopPreviewBtn: '停止试听',
  saveVoiceBtn: '保存语音',
  saveVoiceConfirmPrefix: '保存语音',
  saveVoiceConfirmHint: '克隆语音及其本机音色特征向量将保存至语音库。',
  voicesHeading: '朗读语音',
  pronunciationHeading: '发音词典',
  settingsHeading: '设置与同步',
  basicSettingsHeading: '基础设置',
  basicShortHeading: '基础',
  themeLabel: '外观主题',
  themeLight: '浅色',
  themeDark: '深色',
  tapToTurnPageLabel: '点击翻页',
  keepScreenAwakeLabel: '屏幕常亮',
  autoResumeLastBookLabel: '自动续读上次书籍',
  volumeKeyPageTurnLabel: '音量键翻页',
  appearanceHeading: '配色与壁纸',
  accentColorLabel: '主题色',
  wallpaperLabel: '壁纸',
  languageLabel: '系统语言',
  languageDesc: '切换整个应用的界面语言',
  communityTitle: '匿名共享社区',
  shareAnonymously: '+ 分享',
  disclaimerTitle: '免责声明',
  privacyPolicy: '隐私政策',
  understand: '我知道了',
  mp3ToEpubPlaceholder: 'YouTube / MP3 转 EPUB',
  searchNovelPlaceholder: '搜索小说或粘贴网址',
  webReadBtn: '阅读',
  webBrowserBtn: '浏览器',
  pasteLinkBtn: '粘贴链接',
  listenBook: '听书',
  hours: '时',
  minutes: '分',
  sleepTimerHint: '留空：本章读完自动停止',
  narrator: '旁白',
  playing: '播放中',
  previewShort: '试听',
  characters: '角色',
  scan: '扫描',
  confirm: '确认',
  ambientMusic: '背景音效',
  translateQuick: '快捷翻译',
  readerOptions: '阅读选项',
  textBgAndTurn: '字体、背景与翻页',
  readingVoice: '朗读语音',
  aiCleanScan: 'AI 净化文本',
  translateAndExportEpub: '翻译并导出 EPUB',
  toc: '目录',
  voiceReady: '已就绪',
  importVoice: '导入语音',
  voiceName: '语音名称',
  voiceStyle: '风格',
  aiInstruction: 'AI 朗读指令',
  previewContent: '试听文本',
  stopPreview: '停止试听',
  previewVoice: '试听',
  saveVoice: '保存语音',
};

export const APP_LANGUAGE_OPTIONS: Array<{
  id: AppLanguage;
  label: string;
  short: string;
  flag: string;
}> = [
  { id: 'vi', label: 'Tiếng Việt', short: 'VI', flag: '🇻🇳' },
  { id: 'en', label: 'English', short: 'EN', flag: '🇺🇸' },
  { id: 'zh', label: '中文', short: 'ZH', flag: '🇨🇳' },
];

export function getAppStrings(lang?: AppLanguage): AppStrings {
  if (lang === 'en') return EN;
  if (lang === 'zh') return ZH;
  return VI;
}
