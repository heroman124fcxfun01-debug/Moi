import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { extractWebChapterFromHtml } from './server/webScraper.ts';
import { renderDemoChapterHtml } from './server/demoNovel.ts';

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
            contents: `You are an expert ebook web-page scanner. Extract ONLY the clean story/book chapter content from this web page (${parsedUrl.toString()}), removing ads, menus, comments, and site boilerplate. Also identify the exact next-chapter URL if present in the candidate links.\n\nCandidate links:\n${candidateLinks || '(none)'}\n\nExtracted page text:\n${strippedText}`,
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
        readingStyle = 'novel',
      } = req.body as {
        text: string;
        voiceName?: string;
        stylePrompt?: string;
        expressive?: boolean;
        readingStyle?: 'novel' | 'selfhelp' | 'essay' | 'research';
      };

      if (!text || !text.trim()) {
        res.status(400).json({ error: 'Thiếu văn bản để tạo giọng đọc AI.' });
        return;
      }

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
      const combinedStyle = `${genrePrefix[readingStyle] || ''} ${stylePrompt}. Phát âm tiếng Việt tự nhiên, truyền cảm, rõ chữ.`.trim();

      const isQuotaExceeded = (err: unknown): boolean => {
        const s = String(err instanceof Error ? err.message : err || '');
        return s.includes('429') || s.includes('RESOURCE_EXHAUSTED') || s.toLowerCase().includes('quota');
      };

      // Gemini TTS speechConfig / speechMetadata require v1beta endpoint
      const ai = getAiClient('v1beta');
      const primaryModel = expressive ? 'gemini-3.8-flash-lite-tts' : 'gemini-3.8-flash-lite-tts';

      const callTts = async (modelName: string, voice: string, useMetadata: boolean) => {
        const part = useMetadata
          ? {
              text: text.trim(),
              speechMetadata: {
                style: combinedStyle,
              },
            }
          : {
              text: text.trim(),
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
        // Retry once without speechMetadata (and fallback Aoede -> Zephyr if voice name unsupported)
        const safeVoice = chosenVoice === 'Aoede' ? 'Zephyr' : chosenVoice;
        try {
          response = await callTts(primaryModel, safeVoice, false);
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
          throw secondErr;
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
              text: `Analyze this uploaded voice sample ("${fileName}") for audiobook character dubbing. Describe the voice timbre, gender/age feel, pace, and emotional tone in Vietnamese. Recommend the closest Gemini TTS base voice from [Kore, Charon, Zephyr, Fenrir], a stylePrompt to imitate this voice style, pitchHint (0.6 to 1.5), rateHint (0.75 to 1.35), and a short transcriptPreview.`,
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
              pitchHint: { type: Type.NUMBER },
              rateHint: { type: Type.NUMBER },
              transcriptPreview: { type: Type.STRING },
            },
            required: ['description', 'stylePrompt', 'recommendedBaseVoice', 'pitchHint', 'rateHint'],
          },
        },
      });

      const parsed = JSON.parse(response.text || '{}');
      res.json(parsed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Lỗi phân tích tệp giọng nói ngoài.';
      res.status(500).json({ error: msg });
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
    console.log(`LaziRead server running at http://localhost:${PORT}`);
  });
}

startServer();
