import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import { extractWebChapterFromHtml } from './server/webScraper.ts';
import { renderDemoChapterHtml } from './server/demoNovel.ts';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY chưa được cấu hình trên máy chủ.');
  }
  return new GoogleGenAI({
    apiKey,
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

  // Translate paragraphs 1-to-1 for Override or Bilingual reading modes
  app.post('/api/ai/translate', async (req, res) => {
    try {
      const { paragraphs, targetLang = 'vi', contextTitle = '' } = req.body as {
        paragraphs: string[];
        targetLang?: string;
        contextTitle?: string;
      };

      if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
        res.status(400).json({ error: 'Thiếu danh sách đoạn văn cần dịch.' });
        return;
      }

      const ai = getAiClient();
      const langLabel = getLanguageName(targetLang);

      // Process in chunks of 25 paragraphs to keep strict 1-to-1 alignment reliable
      const chunkSize = 25;
      const allTranslated: string[] = [];

      for (let i = 0; i < paragraphs.length; i += chunkSize) {
        const chunk = paragraphs.slice(i, i + chunkSize);
        const numberedInput = chunk.map((p, idx) => `[${idx}] ${p}`).join('\n\n');

        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Translate the following ${chunk.length} book paragraphs naturally and faithfully into ${langLabel}. Keep literary tone, dialogue punctuation, and character names consistent. Context chapter: "${contextTitle}".\n\nParagraphs:\n${numberedInput}`,
          config: {
            systemInstruction: `You are an expert literary translator. Return a JSON object with a "translations" array containing EXACTLY ${chunk.length} translated strings matching each input paragraph in order, without adding index prefixes like [0].`,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                translations: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: `Exactly ${chunk.length} translated paragraphs in order.`,
                },
              },
              required: ['translations'],
            },
          },
        });

        const parsed = JSON.parse(response.text || '{}') as { translations?: string[] };
        const arr = Array.isArray(parsed.translations) ? parsed.translations : [];
        for (let j = 0; j < chunk.length; j++) {
          allTranslated.push((arr[j] || chunk[j]).trim());
        }
      }

      res.json({ translations: allTranslated, targetLang });
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
          'Văn phong TIỂU THUYẾT: Tách rõ người dẫn chuyện và từng nhân vật đối thoại. Phân biệt rõ tuổi tác, giới tính và tâm lý nhân vật để chọn chất giọng phù hợp (Kore: nữ ấm áp truyền cảm; Zephyr: nữ trẻ trung dịu dàng; Charon: nam trầm ấm từng trải; Puck: nam/trẻ nhanh nhẹn linh hoạt; Fenrir: nam mạnh mẽ hùng hồn). Bắt buộc ghi nhận chính xác sắc thái cảm xúc từng câu thoại bằng tiếng Việt như: "Hoảng hốt, sợ hãi, thở gấp", "Mạnh mẽ, hùng hồn, dứt khoát", "Tự tin, sắc sảo", "Nhẹ nhàng, tình yêu ấm áp", "Thì thầm bí ẩn", hoặc "Trầm tư kể chuyện".',
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
        contents: `Analyze this book chapter "${title}" carefully to predict all characters/speakers for high-quality Vietnamese audiobook dubbing.\nGenre/Style guidance: ${styleGuides[readingStyle] || styleGuides.novel}\n1. Estimate total distinct characters/speakers appearing in the story.\n2. Create a complete cast list with id ("narrator" for the main narrator/speaker, and snake_case ids for every speaking or named active character), name, role (narrator | protagonist | supporting | antagonist), gender (male | female | neutral), ageGroup, voiceDescription (in Vietnamese describing tone warmth, pitch, personality), suggestedVoiceName (diverse voices matching character traits from: Kore, Puck, Charon, Fenrir, Zephyr), lineCount, and sampleQuote.\n3. Break down every paragraph [P0..P${limitedParagraphs.length - 1}] into ordered script segments so each segment has paragraphIndex, speakerId, speakerName, emotionStyle (vivid Vietnamese acting direction matching the exact emotional nuance), and text.\n\nChapter text:\n${indexedText}`,
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

      const validVoices = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'];
      const chosenVoice = validVoices.includes(voiceName) ? voiceName : 'Kore';
      const useExpressiveModel =
        expressive || readingStyle === 'novel' || readingStyle === 'essay' || readingStyle === 'selfhelp';
      const combinedStyle = `${genrePrefix[readingStyle] || ''} ${stylePrompt}. Phát âm tiếng Việt tự nhiên, truyền cảm, giàu nhạc điệu.`.trim();

      const ai = getAiClient();

      const response = await ai.models.generateContent({
        model: useExpressiveModel ? 'gemini-3.8-flash-tts' : 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: text.trim(),
                speechMetadata: {
                  style: combinedStyle,
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: chosenVoice },
            },
          },
        },
      });

      const audioBase64 =
        response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

      if (!audioBase64) {
        res.status(502).json({ error: 'Mô hình TTS không trả về dữ liệu âm thanh.' });
        return;
      }

      res.json({
        audioBase64,
        mimeType: 'audio/wav',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Lỗi tạo giọng đọc AI.';
      res.status(500).json({ error: msg });
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
              text: `Analyze this uploaded voice sample ("${fileName}") for audiobook character dubbing. Describe the voice timbre, gender/age feel, pace, and emotional tone in Vietnamese. Recommend the closest Gemini TTS base voice from [Kore, Puck, Charon, Fenrir, Zephyr], a stylePrompt to imitate this voice style, pitchHint (0.6 to 1.5), rateHint (0.75 to 1.35), and a short transcriptPreview.`,
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
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
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
