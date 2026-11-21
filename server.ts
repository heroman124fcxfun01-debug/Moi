import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { extractWebChapterFromHtml } from './server/webScraper.ts';
import { renderDemoChapterHtml } from './server/demoNovel.ts';
import {
  addCongDongComment,
  createCongDongBook,
  getCongDongBookById,
  incrementCongDongDownload,
  listCongDongBooks,
} from './server/congdongsach.ts';
import { normalizeVietnameseForSpeech } from './src/utils/vietnameseTtsNormalizer.ts';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;

function getAiClient(apiVersion?: string): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY chưa được cấu hình trên máy chủ.');
  }
  return new GoogleGenAI({
    apiKey,
    ...(apiVersion ? { apiVersion } : {}),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function getLanguageName(code: string): string {
  const map: Record<string, string> = {
    vi: 'Vietnamese (Tiếng Việt)',
    en: 'English',
    ja: 'Japanese',
    zh: 'Chinese (Simplified)',
    ko: 'Korean',
    fr: 'French',
  };
  return map[code] || code;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '35mb' }));

  // Allow requests from packaged Capacitor Android APK origins (https://localhost, capacitor://localhost)
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (
      origin &&
      (origin === 'https://localhost' ||
        origin === 'http://localhost' ||
        origin === 'capacitor://localhost' ||
        origin.startsWith('http://localhost:') ||
        origin.startsWith('https://localhost:'))
    ) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
    }
    next();
  });

  // Built-in demo web novel endpoints so Auto-Click & Web Scraper always have an instant testable target
  app.get('/demo-web-book/:slug', (req, res) => {
    const html = renderDemoChapterHtml(req.params.slug);
    if (!html) {
      res.status(404).send('<h1>Không tìm thấy chương truyện mẫu.</h1>');
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  });

  // Web fetch & readability extractor endpoint
  app.get('/api/web/fetch', async (req, res) => {
    try {
      const targetUrl = String(req.query.url || '').trim();
      const nextSelector = String(req.query.nextSelector || '').trim();
      if (!targetUrl) {
        res.status(400).json({ error: 'Vui lòng nhập đường dẫn URL hợp lệ.' });
        return;
      }

      // Resolve relative demo paths against local server
      const resolvedUrl = targetUrl.startsWith('/')
        ? `http://127.0.0.1:${PORT}${targetUrl}`
        : targetUrl;

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(resolvedUrl);
      } catch {
        res.status(400).json({ error: 'Đường dẫn URL không đúng định dạng.' });
        return;
      }

      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        res.status(400).json({ error: 'Chỉ hỗ trợ giao thức HTTP hoặc HTTPS.' });
        return;
      }

      const response = await fetch(parsedUrl.toString(), {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        res.status(response.status).json({
          error: `Trang web trả về mã lỗi HTTP ${response.status}.`,
        });
        return;
      }

      const html = await response.text();
      const extracted = extractWebChapterFromHtml(html, parsedUrl.toString(), nextSelector);
      res.json(extracted);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Lỗi không xác định khi tải trang web.';
      res.status(500).json({ error: `Không thể tải trang web: ${message}` });
    }
  });

  // AI-powered smart web reader page scanner (extracts clean book content & next chapter link automatically)
  app.post('/api/web/ai-scan', async (req, res) => {
    try {
      const { url: rawUrl, useAiClean = true } = req.body as {
        url?: string;
        useAiClean?: boolean;
      };
      const targetUrl = String(rawUrl || '').trim();
      if (!targetUrl) {
        res.status(400).json({ error: 'Vui lòng nhập đường dẫn URL trang đọc sách.' });
        return;
      }

      const resolvedUrl = targetUrl.startsWith('/')
        ? `http://127.0.0.1:${PORT}${targetUrl}`
        : targetUrl;

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(resolvedUrl);
      } catch {
        res.status(400).json({ error: 'Đường dẫn URL không đúng định dạng.' });
        return;
      }

      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        res.status(400).json({ error: 'Chỉ hỗ trợ giao thức HTTP hoặc HTTPS.' });
        return;
      }

      const response = await fetch(parsedUrl.toString(), {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        res.status(response.status).json({
          error: `Trang web trả về mã lỗi HTTP ${response.status}.`,
        });
        return;
      }

      const html = await response.text();
      const extracted = extractWebChapterFromHtml(html, parsedUrl.toString(), '');

      // Use Gemini AI to refine chapter extraction or discover next-chapter URL when heuristics are sparse
      const needsAiBoost =
        useAiClean &&
        Boolean(process.env.GEMINI_API_KEY) &&
        !extracted.paywallHint &&
        (extracted.paragraphs.length < 3 || !extracted.nextUrl);

      if (needsAiBoost) {
        try {
          const ai = getAiClient();
          const strippedText = html
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, '\n')
            .replace(/\n{2,}/g, '\n')
            .trim()
            .slice(0, 14000);

          const candidateLinks = (extracted.interactiveLinks || [])
            .filter((l) => l.href)
            .slice(0, 15)
            .map((l) => `- "${l.label}" => ${l.href}`)
            .join('\n');

          const aiResp = await ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: `You are an expert ebook web-page scanner. Extract ONLY the clean story/book chapter content from this web page (${parsedUrl.toString()}), removing ads, menus, comments, and site boilerplate. Also scan the bottom and right-edge navigation links to find the exact next-chapter/next-page URL if present.\n\nCandidate links:\n${candidateLinks || '(none)'}\n\nExtracted page text:\n${strippedText}`,
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  paragraphs: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  nextUrl: { type: Type.STRING },
                  nextLabel: { type: Type.STRING },
                },
                required: ['title', 'paragraphs'],
              },
            },
          });

          const parsed = JSON.parse(aiResp.text || '{}') as {
            title?: string;
            paragraphs?: string[];
            nextUrl?: string;
            nextLabel?: string;
          };

          const aiParas = Array.isArray(parsed.paragraphs)
            ? parsed.paragraphs.map((p) => String(p).trim()).filter((p) => p.length > 10)
            : [];

          const finalParagraphs = aiParas.length >= extracted.paragraphs.length ? aiParas : extracted.paragraphs;
          const finalNextUrl =
            extracted.nextUrl ||
            (parsed.nextUrl && /^https?:\/\//i.test(parsed.nextUrl) ? parsed.nextUrl : null);

          res.json({
            ...extracted,
            title: parsed.title?.trim() || extracted.title,
            paragraphs: finalParagraphs,
            wordCount: finalParagraphs.join(' ').split(/\s+/).filter(Boolean).length,
            nextUrl: finalNextUrl,
            nextLabel: parsed.nextLabel?.trim() || extracted.nextLabel,
            aiScanned: true,
          });
          return;
        } catch (aiErr) {
          console.warn('AI web-scan enhancement skipped (using fast readability fallback):', aiErr);
        }
      }

      res.json({
        ...extracted,
        aiScanned: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Lỗi không xác định khi AI quét trang web.';
      res.status(500).json({ error: `AI không thể quét trang web: ${message}` });
    }
  });

  // Downloadable in-app Language Pack bundle (literary glossary & translation directives)
  app.get('/api/language-packs/:code', (req, res) => {
    const code = String(req.params.code || 'vi').toLowerCase();
    const packs: Record<
      string,
      {
        code: string;
        version: string;
        styleDirective: string;
        glossary: Record<string, string>;
      }
    > = {
      vi: {
        code: 'vi',
        version: '2.1.0',
        styleDirective:
          'Dịch sang tiếng Việt văn học tự nhiên, mượt mà, chuẩn ngữ cảnh truyện/sách; giữ nhất quán đại từ nhân xưng (ta/ngươi, anh/em, hắn/nàng), giữ đúng tên riêng và dấu câu hội thoại.',
        glossary: {
          Chapter: 'Chương',
          Prologue: 'Mở đầu',
          Epilogue: 'Lời kết',
          Master: 'Sư phụ',
          'Senior Brother': 'Sư huynh',
          'Junior Sister': 'Sư muội',
          Cultivation: 'Tu luyện',
          Realm: 'Cảnh giới',
          Spirit: 'Linh khí',
          Guild: 'Hội quán',
        },
      },
      en: {
        code: 'en',
        version: '2.1.0',
        styleDirective:
          'Translate into fluent, idiomatic literary English with natural dialogue cadence and consistent proper nouns.',
        glossary: {
          'Chương': 'Chapter',
          'Mở đầu': 'Prologue',
          'Lời kết': 'Epilogue',
          'Sư phụ': 'Master',
          'Cảnh giới': 'Realm',
        },
      },
      zh: {
        code: 'zh',
        version: '2.1.0',
        styleDirective:
          '流畅地翻译为自然地道的简体中文文学表达，保持对话语气和专有名词一致。',
        glossary: { Chapter: '章', 'Chương': '章', Prologue: '序章' },
      },
      ja: {
        code: 'ja',
        version: '2.1.0',
        styleDirective:
          '自然な日本語の小説文体で翻訳し、会話の語尾や敬語を一貫させてください。',
        glossary: { Chapter: '章', 'Chương': '章', Prologue: 'プロローグ' },
      },
      ko: {
        code: 'ko',
        version: '2.1.0',
        styleDirective:
          '자연스러운 한국어 소설 문체로 번역하고 말투와 고유명사를 일관되게 유지하세요.',
        glossary: { Chapter: '장', 'Chương': '장', Prologue: '프롤로그' },
      },
      fr: {
        code: 'fr',
        version: '2.1.0',
        styleDirective:
          'Traduisez en français littéraire fluide et naturel, en conservant les nuances de dialogue.',
        glossary: { Chapter: 'Chapitre', 'Chương': 'Chapitre', Prologue: 'Prologue' },
      },
    };
    const pack = packs[code] || packs.vi;
    res.json(pack);
  });

  // Ultra-fast parallel paragraph translator (Gemini 3.1 Flash Lite + concurrency pool + language pack glossary)
  app.post('/api/ai/translate', async (req, res) => {
    try {
      const {
        paragraphs,
        targetLang = 'vi',
        contextTitle = '',
        styleDirective = '',
        glossaryHints = {},
      } = req.body as {
        paragraphs: string[];
        targetLang?: string;
        contextTitle?: string;
        styleDirective?: string;
        glossaryHints?: Record<string, string>;
      };

      if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
        res.status(400).json({ error: 'Thiếu danh sách đoạn văn cần dịch.' });
        return;
      }

      const ai = getAiClient();
      const langLabel = getLanguageName(targetLang);

      const glossaryEntries = Object.entries(glossaryHints || {})
        .slice(0, 24)
        .map(([k, v]) => `${k} => ${v}`)
        .join('; ');

      // Split into char-budgeted chunks (~4200 chars / max 35 paragraphs) and run up to 4 concurrently
      const chunks: Array<{ start: number; items: string[] }> = [];
      let curItems: string[] = [];
      let curChars = 0;
      let curStart = 0;
      for (let i = 0; i < paragraphs.length; i++) {
        const p = paragraphs[i] ?? '';
        const len = p.length + 10;
        if (curItems.length > 0 && (curItems.length >= 35 || curChars + len > 4200)) {
          chunks.push({ start: curStart, items: curItems });
          curItems = [p];
          curChars = len;
          curStart = i;
        } else {
          curItems.push(p);
          curChars += len;
        }
      }
      if (curItems.length > 0) {
        chunks.push({ start: curStart, items: curItems });
      }

      const results = new Array<string>(paragraphs.length);
      let chunkCursor = 0;
      const concurrency = Math.min(4, chunks.length);

      const translateOneChunk = async (chunkItems: string[]): Promise<string[]> => {
        const numberedInput = chunkItems.map((p, idx) => `[${idx}] ${p}`).join('\n');
        const prompt = `Translate all ${chunkItems.length} paragraphs into ${langLabel}. Context: "${contextTitle}".${
          glossaryEntries ? `\nPreferred glossary: ${glossaryEntries}` : ''
        }\n\n${numberedInput}`;
        const sysInst = `You are a fast, high-precision literary book translator. ${
          styleDirective || ''
        } Return ONLY valid JSON with a "translations" array of EXACTLY ${
          chunkItems.length
        } strings in matching order, without [0] prefixes.`.trim();

        const schemaConfig = {
          systemInstruction: sysInst,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              translations: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: ['translations'],
          },
        };

        let response;
        try {
          response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-lite',
            contents: prompt,
            config: {
              ...schemaConfig,
              thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
            },
          });
        } catch {
          // Graceful fallback to gemini-4-hydrogen at LOW thinking latency
          response = await ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: prompt,
            config: {
              ...schemaConfig,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            },
          });
        }

        const parsed = JSON.parse(response.text || '{}') as { translations?: string[] };
        const arr = Array.isArray(parsed.translations) ? parsed.translations : [];
        return chunkItems.map((orig, idx) => (arr[idx] || orig).trim());
      };

      const worker = async () => {
        while (chunkCursor < chunks.length) {
          const chunk = chunks[chunkCursor++];
          const translated = await translateOneChunk(chunk.items);
          for (let j = 0; j < chunk.items.length; j++) {
            results[chunk.start + j] = translated[j];
          }
        }
      };

      await Promise.all(Array.from({ length: concurrency }, () => worker()));

      res.json({ translations: results, targetLang });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Lỗi dịch văn bản.';
      res.status(500).json({ error: msg });
    }
  });

  // OCR + Direct Translation from uploaded book page image(s)
  app.post('/api/ai/ocr-translate', async (req, res) => {
    try {
      const {
        imageBase64,
        mimeType = 'image/png',
        targetLang = 'vi',
        mode = 'bilingual',
      } = req.body as {
        imageBase64: string;
        mimeType?: string;
        targetLang?: string;
        mode?: 'original' | 'override' | 'bilingual';
      };

      if (!imageBase64) {
        res.status(400).json({ error: 'Thiếu dữ liệu hình ảnh.' });
        return;
      }

      const ai = getAiClient();
      const langLabel = getLanguageName(targetLang);

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: imageBase64,
              },
            },
            {
              text: `Read all text from this book/comic/document page image cleanly in reading order, split into logical paragraphs. Also translate every paragraph naturally into ${langLabel}. Output mode requested: ${mode}.`,
            },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              detectedTitle: { type: Type.STRING },
              detectedLanguage: { type: Type.STRING },
              originalParagraphs: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              translatedParagraphs: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: ['originalParagraphs', 'translatedParagraphs'],
          },
        },
      });

      const parsed = JSON.parse(response.text || '{}') as {
        detectedTitle?: string;
        detectedLanguage?: string;
        originalParagraphs?: string[];
        translatedParagraphs?: string[];
      };

      res.json({
        detectedTitle: parsed.detectedTitle || 'Trang sách từ ảnh',
        detectedLanguage: parsed.detectedLanguage || 'auto',
        originalParagraphs: parsed.originalParagraphs || [],
        translatedParagraphs: parsed.translatedParagraphs || [],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Lỗi nhận dạng & dịch ảnh.';
      res.status(500).json({ error: msg });
    }
  });

  // Silent multi-page book scanner (video frames or photo batch -> structured EPUB chapters)
  app.post('/api/ai/scan-book-pages', async (req, res) => {
    try {
      const {
        pages,
        targetLang = 'vi',
        translateMode = 'original',
        fallbackTitle = 'Sách quét từ video',
      } = req.body as {
        pages: Array<{ base64: string; mimeType?: string }>;
        targetLang?: string;
        translateMode?: 'original' | 'override' | 'bilingual';
        fallbackTitle?: string;
      };

      if (!Array.isArray(pages) || pages.length === 0) {
        res.status(400).json({ error: 'Thiếu danh sách trang sách cần quét.' });
        return;
      }

      const ai = getAiClient();
      const langLabel = getLanguageName(targetLang);
      const boundedPages = pages.slice(0, 12);

      const parts: Array<
        | { inlineData: { mimeType: string; data: string } }
        | { text: string }
      > = boundedPages.map((p) => ({
        inlineData: {
          mimeType: p.mimeType || 'image/jpeg',
          data: p.base64,
        },
      }));

      const modeInstruction =
        translateMode === 'override'
          ? `Translate every extracted paragraph smoothly into ${langLabel}. Output only the translated text in paragraphs.`
          : translateMode === 'bilingual'
          ? `For each paragraph, output the original paragraph followed by its ${langLabel} translation as clean consecutive paragraphs.`
          : 'Keep the exact original language cleanly corrected for OCR typos and merged across line wraps.';

      parts.push({
        text: `You are an ultra-accurate book digitization engine. These ${boundedPages.length} ordered frames were captured while flipping through a physical or digital book.
1. Deduplicate any repeated page or overlapping text between consecutive frames.
2. Ignore page numbers, headers/footers, finger shadows, margins, and UI chrome.
3. Reconstruct clean reading-order paragraphs and group them into logical chapters (create "Chương 1" if no explicit chapter heading is visible).
4. Infer book title and author if visible (otherwise use "${fallbackTitle}").
5. ${modeInstruction}`,
      });

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: { parts },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              author: { type: Type.STRING },
              chapters: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    paragraphs: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                  },
                  required: ['title', 'paragraphs'],
                },
              },
            },
            required: ['title', 'chapters'],
          },
        },
      });

      const parsed = JSON.parse(response.text || '{}') as {
        title?: string;
        author?: string;
        chapters?: Array<{ title: string; paragraphs: string[] }>;
      };

      res.json({
        title: parsed.title?.trim() || fallbackTitle,
        author: parsed.author?.trim() || 'BOOKHAD Scan',
        chapters: Array.isArray(parsed.chapters) ? parsed.chapters : [],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Lỗi quét trang sách thành EPUB.';
      res.status(500).json({ error: msg });
    }
  });

  // Analyze story characters and split chapter into dialogue script for per-character AI voice dubbing
  app.post('/api/ai/analyze-characters', async (req, res) => {
    try {
      const { title, paragraphs, readingStyle = 'novel' } = req.body as {
        title: string;
        paragraphs: string[];
        readingStyle?: 'novel' | 'selfhelp' | 'essay' | 'research';
      };

      if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
        res.status(400).json({ error: 'Không có nội dung chương để phân tích.' });
        return;
      }

      const styleGuides: Record<string, string> = {
        novel:
          'Văn phong TIỂU THUYẾT: Tách rõ người dẫn chuyện và từng nhân vật đối thoại. Phân biệt rõ tuổi tác, giới tính và tâm lý nhân vật để chọn chất giọng phù hợp (Kore: giọng Google AI gốc dẫn chuyện; Charon: nam trầm ấm; Zephyr: nữ dịu dàng; Fenrir: nam hùng hồn; Puck: nam trẻ linh hoạt; Aoede: nữ sắc sảo). Bắt buộc ghi nhận chính xác sắc thái cảm xúc từng câu thoại bằng tiếng Việt như: "Hoảng hốt, sợ hãi, thở gấp", "Mạnh mẽ, hùng hồn, dứt khoát", "Tự tin, sắc sảo", "Nhẹ nhàng, tình yêu ấm áp", "Thì thầm bí ẩn", hoặc "Trầm tư kể chuyện".',
        selfhelp:
          'Văn phong HỌC TẬP: Phân tích dưới dạng Diễn giả / Người hướng dẫn chính (narrator) và các đoạn nhấn trọng tâm. Đánh dấu rõ các câu chứa khái niệm, nguyên tắc, bài học cốt lõi bằng emotionStyle như: "Nhấn mạnh điểm quan trọng, dứt khoát, truyền động lực" và phần diễn giải ví dụ là "Rõ ràng, tự tin, mạch lạc sư phạm".',
        essay:
          'Văn phong TẢN VĂN: Tạo giọng đọc giàu chất thơ, nhẹ nhàng, sâu lắng và truyền cảm hứng. Dùng emotionStyle như: "Nhẹ nhàng, truyền cảm hứng", "Hoài niệm êm dịu", "Sâu lắng, chiêm nghiệm".',
        research:
          'Văn phong NGHIÊN CỨU: Trình bày chuẩn xác, khách quan, tốc độ vừa phải, phân biệt thuật ngữ rõ ràng. Dùng emotionStyle như: "Rõ ràng, mạch lạc, học thuật", "Nhấn mạnh kết luận trọng tâm".',
      };

      const ai = getAiClient();
      const limitedParagraphs = paragraphs.slice(0, 60);
      const indexedText = limitedParagraphs
        .map((p, idx) => `[P${idx}] ${p}`)
        .join('\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Analyze this book chapter "${title}" carefully to predict all characters/speakers for high-quality Vietnamese audiobook dubbing.\nGenre/Style guidance: ${styleGuides[readingStyle] || styleGuides.novel}\n1. Estimate total distinct characters/speakers appearing in the story.\n2. Create a complete cast list with id ("narrator" for the main narrator/speaker, and snake_case ids for every speaking or named active character), name, role (narrator | protagonist | supporting | antagonist), gender (male | female | neutral), ageGroup, voiceDescription (in Vietnamese describing tone warmth, pitch, personality), suggestedVoiceName (diverse voices matching character traits from: Kore, Charon, Zephyr, Fenrir, Puck, Aoede), lineCount, and sampleQuote.\n3. Break down every paragraph [P0..P${limitedParagraphs.length - 1}] into ordered script segments so each segment has paragraphIndex, speakerId, speakerName, emotionStyle (vivid Vietnamese acting direction matching the exact emotional nuance), and text.\n\nChapter text:\n${indexedText}`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              estimatedTotalCharacters: { type: Type.INTEGER },
              summary: { type: Type.STRING },
              characters: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    name: { type: Type.STRING },
                    role: { type: Type.STRING },
                    gender: { type: Type.STRING },
                    ageGroup: { type: Type.STRING },
                    voiceDescription: { type: Type.STRING },
                    suggestedVoiceName: { type: Type.STRING },
                    lineCount: { type: Type.INTEGER },
                    sampleQuote: { type: Type.STRING },
                  },
                  required: [
                    'id',
                    'name',
                    'role',
                    'gender',
                    'voiceDescription',
                    'suggestedVoiceName',
                    'lineCount',
                  ],
                },
              },
              script: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    paragraphIndex: { type: Type.INTEGER },
                    speakerId: { type: Type.STRING },
                    speakerName: { type: Type.STRING },
                    emotionStyle: { type: Type.STRING },
                    text: { type: Type.STRING },
                  },
                  required: ['paragraphIndex', 'speakerId', 'speakerName', 'emotionStyle', 'text'],
                },
              },
            },
            required: ['estimatedTotalCharacters', 'summary', 'characters', 'script'],
          },
        },
      });

      const parsed = JSON.parse(response.text || '{}');
      res.json({ ...parsed, readingStyle });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Lỗi phân tích nhân vật truyện.';
      res.status(500).json({ error: msg });
    }
  });

  // Generate AI TTS WAV audio for a segment or character preview
  app.post('/api/ai/tts', async (req, res) => {
    try {
      const {
        text,
        voiceName = 'Kore',
        stylePrompt = 'Đọc truyền cảm, rõ ràng, tự nhiên như sách nói',
        expressive = true,
        useVoiceDesign = false,
        lang = 'vi-VN',
        readingStyle = 'novel',
      } = req.body as {
        text: string;
        voiceName?: string;
        stylePrompt?: string;
        expressive?: boolean;
        useVoiceDesign?: boolean;
        lang?: string;
        readingStyle?: 'novel' | 'selfhelp' | 'essay' | 'research';
      };

      if (!text || !text.trim()) {
        res.status(400).json({ error: 'Thiếu văn bản để tạo giọng đọc AI.' });
        return;
      }

      const spokenText = (lang || 'vi-VN').toLowerCase().startsWith('vi')
        ? normalizeVietnameseForSpeech(text.trim())
        : text.trim();

      const genrePrefix: Record<string, string> = {
        novel:
          'Diễn xuất sách nói tiểu thuyết tiếng Việt đẳng cấp phòng thu: ngắt nghỉ tự nhiên theo dấu câu, lấy hơi tinh tế, thay đổi cao độ và cường độ biểu cảm rõ rệt theo tâm lý nhân vật (hoảng hốt, mạnh mẽ, dịu dàng), tuyệt đối không đọc đều đều:',
        selfhelp:
          'Đọc văn phong học tập chuyên nghiệp: giọng tự tin, sáng rõ, tốc độ vừa phải dễ tiếp thu, chủ động nhấn nhá dứt khoát vào khái niệm trọng tâm, quy tắc và bài học thực tiễn:',
        essay:
          'Đọc tản văn giàu chất thơ: giọng nhẹ nhàng, êm ái, có khoảng lặng tinh tế, truyền cảm hứng sâu lắng:',
        research:
          'Đọc tài liệu nghiên cứu học thuật: mạch lạc, phát âm chuẩn xác từng thuật ngữ, nhấn rõ kết luận quan trọng:',
      };

      const validVoices = ['Kore', 'Charon', 'Zephyr', 'Fenrir', 'Puck', 'Aoede'];
      const chosenVoice = validVoices.includes(voiceName) ? voiceName : 'Kore';
      const combinedStyle = useVoiceDesign
        ? `Voice persona: ${stylePrompt}. ${genrePrefix[readingStyle] || ''} Giữ đúng âm sắc, giới tính, độ trầm bổng và phong cách giọng mẫu xuyên suốt câu đọc tiếng Việt tự nhiên, rõ chữ.`.trim()
        : `${genrePrefix[readingStyle] || ''} ${stylePrompt}. Phát âm tiếng Việt tự nhiên, truyền cảm, rõ chữ.`.trim();

      const isQuotaExceeded = (err: unknown): boolean => {
        const s = String(err instanceof Error ? err.message : err || '');
        return s.includes('429') || s.includes('RESOURCE_EXHAUSTED') || s.toLowerCase().includes('quota');
      };

      // Gemini TTS speechConfig / speechMetadata require v1beta endpoint
      const ai = getAiClient('v1beta');
      // Use gemini-3.8-flash-tts for Voice Design (custom/imported voices), flash-lite for fast standard TTS
      const primaryModel = useVoiceDesign
        ? 'gemini-3.8-flash-tts'
        : expressive
          ? 'gemini-3.8-flash-lite-tts'
          : 'gemini-3.8-flash-lite-tts';

      const callTts = async (modelName: string, voice: string, useMetadata: boolean) => {
        const part = useMetadata
          ? {
              text: spokenText,
              speechMetadata: {
                style: combinedStyle,
              },
            }
          : {
              text: spokenText,
            };
        return ai.models.generateContent({
          model: modelName,
          contents: [
            {
              role: 'user',
              parts: [part],
            },
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: voice },
              },
            },
          },
        });
      };

      let response;
      try {
        response = await callTts(primaryModel, chosenVoice, true);
      } catch (firstErr) {
        if (isQuotaExceeded(firstErr)) {
          res.status(200).json({
            quotaExceeded: true,
            code: 'QUOTA_EXCEEDED',
            error:
              'Hạn mức giọng Google AI miễn phí tạm hết trong ngày. Đã tự động chuyển sang giọng đọc thiết bị (đa nhân vật) để bạn nghe liên tục không gián đoạn.',
          });
          return;
        }
        // Fallback to flash-lite-tts (with metadata if flash-tts failed, or without metadata if lite failed)
        const fallbackModel = 'gemini-3.8-flash-lite-tts';
        const safeVoice = chosenVoice === 'Aoede' ? 'Zephyr' : chosenVoice;
        try {
          response = await callTts(fallbackModel, chosenVoice, useVoiceDesign);
        } catch (secondErr) {
          if (isQuotaExceeded(secondErr)) {
            res.status(200).json({
              quotaExceeded: true,
              code: 'QUOTA_EXCEEDED',
              error:
                'Hạn mức giọng Google AI miễn phí tạm hết trong ngày. Đã tự động chuyển sang giọng đọc thiết bị để bạn nghe liên tục.',
            });
            return;
          }
          try {
            response = await callTts(fallbackModel, safeVoice, false);
          } catch (thirdErr) {
            if (isQuotaExceeded(thirdErr)) {
              res.status(200).json({
                quotaExceeded: true,
                code: 'QUOTA_EXCEEDED',
                error:
                  'Hạn mức giọng Google AI miễn phí tạm hết trong ngày. Đã tự động chuyển sang giọng đọc thiết bị để bạn nghe liên tục.',
              });
              return;
            }
            throw thirdErr;
          }
        }
      }

      const inlineAudio = response.candidates?.[0]?.content?.parts?.find(
        (p) => p.inlineData?.data
      )?.inlineData;
      const audioBase64 = inlineAudio?.data;
      const rawMime = inlineAudio?.mimeType || 'audio/wav';

      if (!audioBase64) {
        res.status(502).json({ error: 'Mô hình TTS không trả về dữ liệu âm thanh.' });
        return;
      }

      // If Gemini returned raw PCM (audio/L16 or audio/pcm), wrap with standard 44-byte WAV header so <audio> plays natively
      let finalBase64 = audioBase64;
      let finalMime = rawMime;
      if (rawMime.toLowerCase().includes('l16') || rawMime.toLowerCase().includes('pcm')) {
        const pcmBuf = Buffer.from(audioBase64, 'base64');
        const rateMatch = rawMime.match(/rate=(\d+)/i);
        const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;
        const header = Buffer.alloc(44);
        header.write('RIFF', 0);
        header.writeUInt32LE(36 + pcmBuf.length, 4);
        header.write('WAVE', 8);
        header.write('fmt ', 12);
        header.writeUInt32LE(16, 16);
        header.writeUInt16LE(1, 20); // PCM
        header.writeUInt16LE(1, 22); // mono
        header.writeUInt32LE(sampleRate, 24);
        header.writeUInt32LE(sampleRate * 2, 28);
        header.writeUInt16LE(2, 32);
        header.writeUInt16LE(16, 34);
        header.write('data', 36);
        header.writeUInt32LE(pcmBuf.length, 40);
        finalBase64 = Buffer.concat([header, pcmBuf]).toString('base64');
        finalMime = 'audio/wav';
      }

      res.json({
        audioBase64: finalBase64,
        mimeType: finalMime,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Lỗi tạo giọng đọc AI.';
      const isQuota = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
      if (isQuota) {
        res.status(200).json({
          quotaExceeded: true,
          code: 'QUOTA_EXCEEDED',
          error:
            'Hạn mức giọng Google AI miễn phí tạm hết trong ngày. Đang tiếp tục đọc bằng giọng trên thiết bị.',
        });
        return;
      }
      res.status(500).json({
        code: 'TTS_ERROR',
        error: msg,
      });
    }
  });

  // Analyze an imported external voice file to build a voice dubbing profile
  app.post('/api/ai/analyze-voice-sample', async (req, res) => {
    try {
      const { audioBase64, mimeType = 'audio/mp3', fileName = 'voice-sample' } = req.body as {
        audioBase64: string;
        mimeType?: string;
        fileName?: string;
      };

      if (!audioBase64) {
        res.status(400).json({ error: 'Thiếu dữ liệu âm thanh tải lên.' });
        return;
      }

      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: audioBase64,
              },
            },
            {
              text: `Listen carefully to this uploaded voice sample ("${fileName}") and analyze its vocal fingerprint for audiobook voice cloning / Voice Design.
Return JSON with:
1. "description": Vietnamese description of the voice's gender, apparent age, timbre (trầm ấm / khàn / trong trẻo / dày / nhẹ), accent (Bắc / Trung / Nam / khác), speaking cadence, and emotional character.
2. "stylePrompt": A detailed Voice Design persona prompt (combining concise English acoustic cues + Vietnamese delivery cues) so a TTS Voice Design model replicates this exact voice's timbre, gender, age, warmth, resonance, breathiness, accent, and pacing.
3. "recommendedBaseVoice": Choose the closest match among ALL 6 voices:
   - "Fenrir": deep, resonant, dramatic male voice
   - "Charon": warm, calm, steady medium-low male narrator
   - "Puck": bright, youthful, expressive agile male voice
   - "Kore": balanced, warm, clear medium female narrator
   - "Zephyr": soft, gentle, airy, melodic female voice
   - "Aoede": crisp, bright, high-clarity expressive female voice
4. "gender": "male", "female", or "neutral".
5. "pitchHint": number between 0.65 and 1.45 matching the speaker's pitch relative to average (deep male ~0.70-0.82, medium male ~0.85-0.96, medium female ~1.02-1.15, high/bright female ~1.18-1.38).
6. "rateHint": number between 0.80 and 1.25 matching the speaker's natural speaking tempo.
7. "warmthDb": number between -6 and 10 representing bass/chest warmth EQ adjustment.
8. "clarityDb": number between -4 and 8 representing vocal treble/clarity EQ adjustment.
9. "transcriptPreview": short transcript of what is spoken in the sample (or empty string if non-speech).`,
            },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              description: { type: Type.STRING },
              stylePrompt: { type: Type.STRING },
              recommendedBaseVoice: { type: Type.STRING },
              gender: { type: Type.STRING },
              pitchHint: { type: Type.NUMBER },
              rateHint: { type: Type.NUMBER },
              warmthDb: { type: Type.NUMBER },
              clarityDb: { type: Type.NUMBER },
              transcriptPreview: { type: Type.STRING },
            },
            required: [
              'description',
              'stylePrompt',
              'recommendedBaseVoice',
              'gender',
              'pitchHint',
              'rateHint',
              'warmthDb',
              'clarityDb',
            ],
          },
        },
      });

      const raw = JSON.parse(response.text || '{}') as Record<string, unknown>;
      const validVoices = ['Kore', 'Charon', 'Zephyr', 'Fenrir', 'Puck', 'Aoede'];
      const recommendedBaseVoice = validVoices.includes(String(raw.recommendedBaseVoice))
        ? String(raw.recommendedBaseVoice)
        : 'Kore';
      const rawGender = String(raw.gender || '').toLowerCase();
      const gender =
        rawGender === 'male' || rawGender === 'female' || rawGender === 'neutral'
          ? rawGender
          : recommendedBaseVoice === 'Fenrir' ||
              recommendedBaseVoice === 'Charon' ||
              recommendedBaseVoice === 'Puck'
            ? 'male'
            : 'female';
      const clamp = (v: unknown, min: number, max: number, fallback: number) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return fallback;
        return Number(Math.max(min, Math.min(max, n)).toFixed(2));
      };
      res.json({
        description: String(raw.description || `AI đã phân tích đặc trưng giọng mẫu (${fileName}).`),
        stylePrompt: String(raw.stylePrompt || 'Đọc truyền cảm, giữ nguyên âm sắc tự nhiên của giọng mẫu'),
        recommendedBaseVoice,
        gender,
        pitchHint: clamp(raw.pitchHint, 0.65, 1.45, gender === 'male' ? 0.86 : 1.08),
        rateHint: clamp(raw.rateHint, 0.8, 1.25, 1.0),
        warmthDb: Math.round(clamp(raw.warmthDb, -6, 10, gender === 'male' ? 4 : 1)),
        clarityDb: Math.round(clamp(raw.clarityDb, -4, 8, 2)),
        transcriptPreview: String(raw.transcriptPreview || ''),
        analyzedBy: 'gemini-ai',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Lỗi phân tích tệp giọng nói ngoài.';
      res.status(500).json({ error: msg });
    }
  });

  // Download an audio voice sample from a public web URL (MP3/WAV/M4A/OGG) so AI can analyze it directly
  app.post('/api/ai/fetch-voice-url', async (req, res) => {
    try {
      const { url } = req.body as { url?: string };
      const rawUrl = String(url || '').trim();
      if (!rawUrl) {
        res.status(400).json({ error: 'Vui lòng nhập link tệp âm thanh (.mp3, .wav, .m4a, .ogg).' });
        return;
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(rawUrl);
      } catch {
        res.status(400).json({ error: 'Đường dẫn link giọng nói không hợp lệ.' });
        return;
      }

      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        res.status(400).json({ error: 'Chỉ hỗ trợ đường dẫn http:// hoặc https://.' });
        return;
      }

      const host = parsedUrl.hostname.toLowerCase();
      if (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '::1' ||
        host.startsWith('10.') ||
        host.startsWith('192.168.') ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
        host === '169.254.169.254'
      ) {
        res.status(400).json({ error: 'Không hỗ trợ tải tệp từ địa chỉ nội bộ.' });
        return;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      let fetchResp: Response;
      try {
        fetchResp = await fetch(parsedUrl.toString(), {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; BOOKHAD/1.0)',
            Accept: 'audio/*,application/octet-stream,*/*',
          },
        });
      } finally {
        clearTimeout(timer);
      }

      if (!fetchResp.ok) {
        res.status(502).json({ error: `Không tải được tệp âm thanh (HTTP ${fetchResp.status}).` });
        return;
      }

      const rawType = (fetchResp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const pathname = decodeURIComponent(parsedUrl.pathname || '');
      const baseName = path.basename(pathname) || 'voice-sample.mp3';
      const ext = path.extname(baseName).toLowerCase();
      const mimeByExt: Record<string, string> = {
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.m4a': 'audio/mp4',
        '.ogg': 'audio/ogg',
        '.aac': 'audio/aac',
        '.flac': 'audio/flac',
        '.webm': 'audio/webm',
      };
      const mimeType = rawType.startsWith('audio/')
        ? rawType
        : mimeByExt[ext] || (rawType === 'application/octet-stream' ? 'audio/mpeg' : '');

      if (!mimeType) {
        res.status(400).json({
          error: 'Link này không trỏ trực tiếp tới tệp âm thanh (.mp3, .wav, .m4a, .ogg).',
        });
        return;
      }

      const arrBuf = await fetchResp.arrayBuffer();
      const maxBytes = 12 * 1024 * 1024;
      if (arrBuf.byteLength === 0) {
        res.status(400).json({ error: 'Tệp âm thanh tải về bị rỗng.' });
        return;
      }
      if (arrBuf.byteLength > maxBytes) {
        res.status(413).json({ error: 'Tệp âm thanh vượt quá giới hạn 12 MB.' });
        return;
      }

      const audioBase64 = Buffer.from(arrBuf).toString('base64');
      res.json({
        fileName: baseName,
        mimeType,
        audioBase64,
        dataUrl: `data:${mimeType};base64,${audioBase64}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không thể tải tệp âm thanh từ link đã nhập.';
      res.status(500).json({ error: msg });
    }
  });

  // =========================================================================
  // CONGDONGSACH — Anonymous Community Book Sharing Hub (/api/congdongsach/*)
  // =========================================================================
  app.get('/api/congdongsach/books', (req, res) => {
    const q = String(req.query.q || '');
    res.json({ books: listCongDongBooks(q) });
  });

  app.get('/api/congdongsach/books/:id', (req, res) => {
    const book = getCongDongBookById(req.params.id);
    if (!book) {
      res.status(404).json({ error: 'Không tìm thấy sách trên congdongsach.' });
      return;
    }
    res.json({ book });
  });

  app.post('/api/congdongsach/books', (req, res) => {
    const body = req.body as {
      title?: string;
      author?: string;
      uploaderAlias?: string;
      category?: string;
      description?: string;
      coverGradient?: string;
      coverImage?: string;
      chapters?: Array<{ title?: string; paragraphs?: string[] }>;
    };
    if (!body?.title?.trim()) {
      res.status(400).json({ error: 'Vui lòng nhập tên sách trước khi đăng lên congdongsach.' });
      return;
    }
    if (!Array.isArray(body.chapters) || body.chapters.length === 0) {
      res.status(400).json({ error: 'Sách cần có ít nhất 1 chương nội dung để chia sẻ.' });
      return;
    }
    const created = createCongDongBook({
      title: body.title,
      author: body.author,
      uploaderAlias: body.uploaderAlias,
      category: body.category,
      description: body.description,
      coverGradient: body.coverGradient,
      coverImage: body.coverImage,
      chapters: body.chapters.map((c, idx) => ({
        title: c.title || `Chương ${idx + 1}`,
        paragraphs: Array.isArray(c.paragraphs) ? c.paragraphs : [],
      })),
    });
    res.status(201).json({ book: created });
  });

  app.get('/api/congdongsach/books/:id/download', (req, res) => {
    const book = incrementCongDongDownload(req.params.id);
    if (!book) {
      res.status(404).json({ error: 'Không tìm thấy sách để tải về.' });
      return;
    }
    res.json({ book });
  });

  app.post('/api/congdongsach/books/:id/comments', (req, res) => {
    const { authorAlias, content, rating } = req.body as {
      authorAlias?: string;
      content?: string;
      rating?: number;
    };
    if (!content?.trim()) {
      res.status(400).json({ error: 'Vui lòng nhập nội dung bình luận.' });
      return;
    }
    const comment = addCongDongComment(req.params.id, {
      authorAlias,
      content,
      rating,
    });
    if (!comment) {
      res.status(404).json({ error: 'Không tìm thấy sách để bình luận.' });
      return;
    }
    res.status(201).json({ comment });
  });

  // =========================================================================
  // IN-APP EMBEDDED BROWSER PROXY (/api/web/browse?url=...)
  // Renders web pages safely inside BOOKHAD's in-app browser window while
  // reporting the exact live URL back to BOOKHAD via postMessage so
  // "Bắt đầu AI quét tự động" immediately crawls whatever page the user opened.
  // =========================================================================
  app.get('/api/web/browse', async (req, res) => {
    const rawUrl = String(req.query.url || '').trim();
    const escapeHtml = (s: string) =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    // Clean built-in start portal inside the embedded browser window when URL is empty
    if (!rawUrl) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(`<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Trình duyệt BOOKHAD</title>
<style>
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8f6f1; color: #1c1917; padding: 20px 16px 40px; }
  .card { max-width: 560px; margin: 0 auto; background: #fff; border: 1px solid #e7e5e4; border-radius: 18px; padding: 18px; box-shadow: 0 8px 24px rgba(0,0,0,0.05); }
  h1 { font-size: 16px; margin: 0 0 6px; }
  p { font-size: 12px; color: #57534e; margin: 0 0 14px; line-height: 1.5; }
  form { display: flex; gap: 6px; margin-bottom: 14px; }
  input { flex: 1; padding: 10px 12px; border-radius: 12px; border: 1px solid #d6d3d1; font-size: 13px; }
  button { padding: 10px 14px; border-radius: 12px; border: 0; background: #92400e; color: #fff; font-weight: 600; font-size: 12px; cursor: pointer; }
  .links { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  a.tile { display: block; padding: 10px 12px; border-radius: 12px; background: #fafaf9; border: 1px solid #e7e5e4; color: #292524; text-decoration: none; font-size: 12px; font-weight: 600; }
  a.tile span { display: block; font-size: 10px; font-weight: 400; color: #78716c; margin-top: 2px; }
</style>
</head>
<body>
  <div class="card">
    <h1>Trình duyệt tìm truyện BOOKHAD</h1>
    <p>Nhập địa chỉ trang web truyện hoặc từ khóa tìm kiếm ngay tại đây. Khi mở tới Chương 1, bấm <b>Bắt đầu AI quét tự động</b> trên thanh phía trên để AI tự lướt trang và lưu sách.</p>
    <form id="navForm">
      <input id="q" type="text" placeholder="Nhập URL (https://...) hoặc tên truyện cần tìm..." autocomplete="off" />
      <button type="submit">Đi tới</button>
    </form>
    <div class="links">
      <a class="tile" href="/api/web/browse?url=${encodeURIComponent('/demo-web-book/chuong-1')}">Truyện Mẫu AI (Chương 1)<span>Thử ngay AI quét tự động</span></a>
      <a class="tile" href="/api/web/browse?url=${encodeURIComponent('https://vi.wikipedia.org/wiki/V%C4%83n_h%E1%BB%8Dc_Vi%E1%BB%87t_Nam')}">Wikipedia Văn học<span>Đọc & quét bài viết mở</span></a>
      <a class="tile" href="/api/web/browse?url=${encodeURIComponent('https://html.duckduckgo.com/html/?q=doc+truyen+chu+online')}">Tìm truyện chữ Online<span>Tìm kiếm trang truyện</span></a>
      <a class="tile" href="/api/web/browse?url=${encodeURIComponent('https://gutenberg.org/')}">Project Gutenberg<span>Kho sách mở quốc tế</span></a>
    </div>
  </div>
  <script>
    document.getElementById('navForm').addEventListener('submit', function(e) {
      e.preventDefault();
      var val = (document.getElementById('q').value || '').trim();
      if (!val) return;
      var target = /^https?:\\/\\//i.test(val) || val.startsWith('/')
        ? val
        : (val.indexOf('.') !== -1 && val.indexOf(' ') === -1
            ? 'https://' + val
            : 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(val));
      window.location.href = '/api/web/browse?url=' + encodeURIComponent(target);
    });
    window.parent.postMessage({ type: 'BOOKHAD_BROWSER_URL', url: '', title: 'Trình duyệt BOOKHAD' }, '*');
  </script>
</body>
</html>`);
      return;
    }

    try {
      const normalizedInput =
        rawUrl.startsWith('/') || /^https?:\/\//i.test(rawUrl)
          ? rawUrl
          : rawUrl.includes('.') && !rawUrl.includes(' ')
          ? `https://${rawUrl}`
          : `https://html.duckduckgo.com/html/?q=${encodeURIComponent(rawUrl)}`;

      const resolvedUrl = normalizedInput.startsWith('/')
        ? `http://127.0.0.1:${PORT}${normalizedInput}`
        : normalizedInput;

      const parsedUrl = new URL(resolvedUrl);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        res.status(400).send('<p>Chỉ hỗ trợ địa chỉ HTTP/HTTPS.</p>');
        return;
      }

      const upstream = await fetch(parsedUrl.toString(), {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
      });

      const finalUrl = upstream.url || parsedUrl.toString();
      const displayUrl = normalizedInput.startsWith('/') ? normalizedInput : finalUrl;
      const contentType = upstream.headers.get('content-type') || 'text/html; charset=utf-8';

      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
        const buf = Buffer.from(await upstream.arrayBuffer());
        res.setHeader('Content-Type', contentType);
        res.send(buf);
        return;
      }

      let html = await upstream.text();
      // Remove frame-busting meta tags so the page stays cleanly inside BOOKHAD's embedded window
      html = html.replace(/<meta[^>]+http-equiv=["']?(?:Content-Security-Policy|X-Frame-Options)["']?[^>]*>/gi, '');

      const bridgeScript = `<base href="${escapeHtml(finalUrl)}" />
<script>
(function(){
  var CURRENT_URL = ${JSON.stringify(displayUrl)};
  var FINAL_URL = ${JSON.stringify(finalUrl)};
  function reportUrl() {
    try {
      window.parent.postMessage({
        type: 'BOOKHAD_BROWSER_URL',
        url: CURRENT_URL,
        title: document.title || CURRENT_URL
      }, '*');
    } catch (e) {}
  }
  reportUrl();
  window.addEventListener('DOMContentLoaded', reportUrl);
  document.addEventListener('click', function(e) {
    var anchor = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!anchor) return;
    var rawHref = anchor.getAttribute('href') || '';
    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) return;
    e.preventDefault();
    try {
      var abs = new URL(rawHref, FINAL_URL).toString();
      var localOrigin = 'http://127.0.0.1:${PORT}';
      var nextParam = abs.startsWith(localOrigin) ? abs.slice(localOrigin.length) : abs;
      window.location.href = '/api/web/browse?url=' + encodeURIComponent(nextParam);
    } catch (err) {}
  }, true);
  document.addEventListener('submit', function(e) {
    var form = e.target;
    if (!form || (form.method && form.method.toLowerCase() === 'post')) return;
    e.preventDefault();
    try {
      var action = form.getAttribute('action') || FINAL_URL;
      var abs = new URL(action, FINAL_URL);
      var fd = new FormData(form);
      fd.forEach(function(v, k){ abs.searchParams.set(k, String(v)); });
      window.location.href = '/api/web/browse?url=' + encodeURIComponent(abs.toString());
    } catch (err) {}
  }, true);
})();
</script>`;

      if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head[^>]*>/i, (m) => `${m}\n${bridgeScript}`);
      } else {
        html = `${bridgeScript}\n${html}`;
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không tải được trang web.';
      res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(`<!doctype html><html lang="vi"><body style="font-family:sans-serif;padding:24px;background:#fafaf9;color:#1c1917;">
        <h3 style="margin:0 0 8px;">Không mở được trang web này</h3>
        <p style="font-size:13px;color:#57534e;">${escapeHtml(msg)}</p>
        <a href="/api/web/browse" style="display:inline-block;margin-top:12px;padding:8px 14px;background:#92400e;color:#fff;border-radius:10px;text-decoration:none;font-size:12px;">Quay lại trang tìm kiếm</a>
      </body></html>`);
    }
  });

  // Job 1 AI: Proofread & classify suspicious paragraphs on book import / cleanup
  app.post('/api/ai/proofread-book', async (req, res) => {
    try {
      const { bookTitle = '', candidates = [] } = req.body as {
        bookTitle?: string;
        candidates?: Array<{ chapterIndex: number; paragraphIndex: number; text: string }>;
      };

      if (!Array.isArray(candidates) || candidates.length === 0) {
        res.json({ findings: [] });
        return;
      }

      const ai = getAiClient();
      const bounded = candidates.slice(0, 28);
      const formatted = bounded
        .map(
          (c, i) =>
            `[${i}] (ch=${c.chapterIndex}, p=${c.paragraphIndex}) ${String(c.text || '').slice(0, 500)}`
        )
        .join('\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Bạn là AI biên tập và hiệu đính sách tiếng Việt cho ứng dụng BOOKHAD. Sách: "${bookTitle}".
Hãy kiểm tra danh sách đoạn văn nghi ngờ lỗi dưới đây và CHỈ trả về các đoạn thực sự có lỗi cần xóa hoặc sửa, phân loại vào đúng 1 trong 3 mục:
1. "addressesAndHeaders": Địa chỉ tải truyện/sách (vtbook, truyenfull, http://, www...), dòng bản quyền/chân trang web, tiêu đề lặp thừa, dòng toàn dấu gạch/ký hiệu thừa (---, ===, ***). Nếu cả đoạn là rác/địa chỉ -> action="remove". Nếu dính link trong câu chuyện -> action="replace" và xóa sạch link/ký hiệu thừa.
2. "typosAndCensored": Từ bị che ký tự * (ví dụ "l*n đ*nh núi" -> "lên đỉnh núi", "gi*t" -> "giết", "ng*ời" -> "người"), lỗi chính tả/gõ tắt/OCR tiếng Việt (ví dụ "ci" -> "chị", "ko" -> "không", "đc" -> "được", lỗi dính số trong chữ), cú pháp sai. Giữ nguyên ý văn học, KHÔNG viết lại câu đúng.
3. "repeatedNotes": Dòng chú thích dịch giả/converter, lời nhắn lặp lại, dòng kết chương thừa.

Đoạn cần kiểm tra:
${formatted}`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              findings: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    chapterIndex: { type: Type.INTEGER },
                    paragraphIndex: { type: Type.INTEGER },
                    category: { type: Type.STRING },
                    action: { type: Type.STRING },
                    cleaned: { type: Type.STRING },
                    reason: { type: Type.STRING },
                  },
                  required: ['chapterIndex', 'paragraphIndex', 'category', 'action', 'reason'],
                },
              },
            },
            required: ['findings'],
          },
        },
      });

      const parsed = JSON.parse(response.text || '{}') as { findings?: unknown[] };
      res.json({
        findings: Array.isArray(parsed.findings) ? parsed.findings : [],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Lỗi AI quét & hiệu đính sách.';
      res.status(500).json({ error: msg, findings: [] });
    }
  });

  // Job 2 AI: Live Pre-Read Lookahead Scanner running AHEAD of the AI Voice Reader
  app.post('/api/ai/preread-scan', async (req, res) => {
    try {
      const { bookTitle = '', chapterTitle = '', items = [] } = req.body as {
        bookTitle?: string;
        chapterTitle?: string;
        items?: Array<{ paragraphIndex: number; text: string }>;
      };

      if (!Array.isArray(items) || items.length === 0) {
        res.json({ decisions: [] });
        return;
      }

      const ai = getAiClient();
      const bounded = items.slice(0, 12);
      const formatted = bounded
        .map((it) => `[P${it.paragraphIndex}] ${String(it.text || '').slice(0, 480)}`)
        .join('\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Bạn là AI tiền quét chạy TRƯỚC AI đọc sách nói (Sách: "${bookTitle}", Chương: "${chapterTitle}").
Nhiệm vụ của bạn là đọc lướt trước từng đoạn sắp phát để báo cho AI đọc biết đoạn nào CẦN BỎ QUA không đọc và đoạn nào CẦN SỬA CHỮ cho chuẩn tiếng Việt:
- action = "skip": Đoạn là địa chỉ tải truyện/web (vtbook, http, www, tên miền), lời nhắn quảng cáo cuối trang, ký hiệu phân cách thừa (---, ===, ***), số trang, tiêu đề lặp hoặc chú thích rác không thuộc nội dung câu chuyện. Ghi rõ reason ngắn gọn bằng tiếng Việt (ví dụ: "Địa chỉ tải web").
- action = "fix": Đoạn thuộc nội dung sách nhưng dính link/watermark, từ bị che dấu * ("l*n đ*nh" -> "lên đỉnh"), sai chính tả/OCR ("ci" -> "chị", "ko" -> "không", "đc" -> "được"), ký hiệu thừa. Trả về cleanedText mượt mà, tự nhiên để AI đọc thành tiếng.
- action = "keep": Nội dung văn học sạch, giữ nguyên không cần sửa.

Các đoạn sắp đọc:
${formatted}`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              decisions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    paragraphIndex: { type: Type.INTEGER },
                    action: { type: Type.STRING },
                    cleanedText: { type: Type.STRING },
                    reason: { type: Type.STRING },
                  },
                  required: ['paragraphIndex', 'action'],
                },
              },
            },
            required: ['decisions'],
          },
        },
      });

      const parsed = JSON.parse(response.text || '{}') as { decisions?: unknown[] };
      res.json({
        decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Lỗi AI tiền quét trước khi đọc.';
      res.status(500).json({ error: msg, decisions: [] });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    // Serve a clean WebSocket-free @vite/client stub because HMR/WS is disabled behind the reverse proxy
    app.get('/@vite/client', (_req, res) => {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.send(`
const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    document.head.appendChild(style);
    sheetsMap.set(id, style);
  }
  style.textContent = content;
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    document.head.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url) {
  return url;
}
export class ErrorOverlay extends HTMLElement {}
`);
    });

    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: false,
        hmr: false,
        watch: null,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`BOOKHAD server running at http://localhost:${PORT}`);
  });
}

startServer();
