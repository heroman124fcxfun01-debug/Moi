export type AppLanguage = 'vi' | 'en' | 'zh';

export interface AppStrings {
  langLabel: string;
  navLibrary: string;
  navCommunity: string;
  navStudio: string;
  navSettings: string;
  importBook: string;
  searchBooks: string;
  readingTime: string;
  recentlyRead: string;
  privateLibrary: string;
  noRecentBook: string;
  continueReading: string;
  voiceStudio: string;
  createVoice: string;
  voicesHeading: string;
  fontsHeading: string;
  ambientHeading: string;
  pronunciationHeading: string;
  settingsHeading: string;
  languageLabel: string;
  languageDesc: string;
  sleepTimer: string;
  sleepOff: string;
  sleepEndChapter: string;
  characterVoice: string;
  scanBook: string;
  confirmSave: string;
  communityTitle: string;
  shareAnonymously: string;
  disclaimerTitle: string;
  privacyPolicy: string;
  understand: string;
}

const VI: AppStrings = {
  langLabel: 'Tiếng Việt',
  navLibrary: 'Thư viện',
  navCommunity: 'Cộng đồng',
  navStudio: 'Giọng đọc',
  navSettings: 'Cài đặt',
  importBook: 'Nhập sách',
  searchBooks: 'Tìm tên sách, tác giả...',
  readingTime: 'Thời gian đọc',
  recentlyRead: 'Sách mới đọc',
  privateLibrary: 'Kho sách riêng',
  noRecentBook: 'Chưa đọc cuốn nào',
  continueReading: 'Đọc tiếp',
  voiceStudio: 'Giọng đọc & Giao diện',
  createVoice: 'Tạo giọng mới',
  voicesHeading: 'Giọng đọc',
  fontsHeading: 'Phông chữ',
  ambientHeading: 'Nhạc nền',
  pronunciationHeading: 'Từ điển phát âm',
  settingsHeading: 'Cài đặt & Đồng bộ',
  languageLabel: 'Ngôn ngữ hệ thống',
  languageDesc: 'Đổi ngôn ngữ giao diện toàn ứng dụng',
  sleepTimer: 'Hẹn giờ tắt',
  sleepOff: 'Tắt',
  sleepEndChapter: 'Hết chương',
  characterVoice: 'Giọng nhân vật',
  scanBook: 'Quét',
  confirmSave: 'Xác nhận',
  communityTitle: 'Cộng đồng chia sẻ',
  shareAnonymously: '+ Chia sẻ',
  disclaimerTitle: 'Tuyên bố miễn trừ trách nhiệm',
  privacyPolicy: 'Chính sách quyền riêng tư',
  understand: 'Đã hiểu',
};

const EN: AppStrings = {
  langLabel: 'English',
  navLibrary: 'Library',
  navCommunity: 'Community',
  navStudio: 'Voices',
  navSettings: 'Settings',
  importBook: 'Import',
  searchBooks: 'Search title or author...',
  readingTime: 'Reading Time',
  recentlyRead: 'Recently Read',
  privateLibrary: 'My Library',
  noRecentBook: 'No recent books',
  continueReading: 'Continue',
  voiceStudio: 'Voice & Typography',
  createVoice: 'Create Voice',
  voicesHeading: 'Voices',
  fontsHeading: 'Fonts',
  ambientHeading: 'Ambient Audio',
  pronunciationHeading: 'Pronunciation Dictionary',
  settingsHeading: 'Settings & Sync',
  languageLabel: 'System Language',
  languageDesc: 'Switch interface language across the app',
  sleepTimer: 'Sleep Timer',
  sleepOff: 'Off',
  sleepEndChapter: 'End of Ch.',
  characterVoice: 'Character Voices',
  scanBook: 'Scan',
  confirmSave: 'Confirm',
  communityTitle: 'Community Library',
  shareAnonymously: '+ Share',
  disclaimerTitle: 'Disclaimer',
  privacyPolicy: 'Privacy Policy',
  understand: 'Got it',
};

const ZH: AppStrings = {
  langLabel: '中文',
  navLibrary: '书库',
  navCommunity: '社区',
  navStudio: '语音',
  navSettings: '设置',
  importBook: '导入书籍',
  searchBooks: '搜索书名或作者...',
  readingTime: '阅读时长',
  recentlyRead: '最近阅读',
  privateLibrary: '私人书库',
  noRecentBook: '暂无阅读记录',
  continueReading: '继续阅读',
  voiceStudio: '语音与字体',
  createVoice: '创建语音',
  voicesHeading: '朗读语音',
  fontsHeading: '阅读字体',
  ambientHeading: '背景音效',
  pronunciationHeading: '自定义发音词典',
  settingsHeading: '设置与同步',
  languageLabel: '系统语言',
  languageDesc: '切换整个应用的界面语言',
  sleepTimer: '定时关闭',
  sleepOff: '关闭',
  sleepEndChapter: '本章结束',
  characterVoice: '角色配音',
  scanBook: '扫描',
  confirmSave: '确认保存',
  communityTitle: '匿名共享社区',
  shareAnonymously: '+ 分享',
  disclaimerTitle: '免责声明',
  privacyPolicy: '隐私政策',
  understand: '我知道了',
};

export const APP_LANGUAGE_OPTIONS: Array<{ id: AppLanguage; label: string }> = [
  { id: 'vi', label: 'Tiếng Việt' },
  { id: 'en', label: 'English' },
  { id: 'zh', label: '中文' },
];

export function getAppStrings(lang?: AppLanguage): AppStrings {
  if (lang === 'en') return EN;
  if (lang === 'zh') return ZH;
  return VI;
}
