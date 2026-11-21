import { extractWebChapterFromHtml, resolveHref, type WebExtractionResult } from './webScraper.ts';
import { cleanParagraphText, isJunkScrapedText } from '../src/utils/bookCleaner.ts';

export interface YoutubeTranscriptResult {
  videoId: string;
  title: string;
  author: string;
  durationSec: number;
  languageCode: string;
  rawLines: string[];
}

export interface YoutubePlaylistVideo {
  videoId: string;
  title: string;
  url: string;
}

export interface YoutubePlaylistResult {
  playlistId: string;
  title: string;
  playlistTitle: string;
  totalVideos: number;
  estimatedSeconds: number;
  estimatedFullSec: number;
  estimatedSingleSec: number;
  videos: YoutubePlaylistVideo[];
}

export function normalizeExternalUrl(rawUrl: string, localPort: number): URL {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) {
    throw new Error('Vui lòng nhập đường dẫn URL hợp lệ.');
  }

  let candidate = trimmed;
  if (candidate.startsWith('/')) {
    candidate = `http://127.0.0.1:${localPort}${candidate}`;
  } else if (!/^https?:\/\//i.test(candidate)) {
    if (candidate.includes('.') && !candidate.includes(' ')) {
      candidate = `https://${candidate}`;
    } else {
      throw new Error('Đường dẫn URL không đúng định dạng (ví dụ: https://...).');
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('Đường dẫn URL không đúng định dạng.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Chỉ hỗ trợ giao thức HTTP hoặc HTTPS.');
  }

  return parsed;
}

export function extractYoutubeVideoId(rawUrl: string): string | null {
  const cleaned = String(rawUrl || '').trim();
  if (!cleaned) return null;
  const direct = cleaned.match(/^([a-zA-Z0-9_-]{11})$/);
  if (direct) return direct[1];

  const m = cleaned.match(
    /(?:(?:www\.|m\.|music\.)?youtube\.com\/(?:watch\?(?:[^#\s]*&)?v=|shorts\/|embed\/|live\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i
  );
  return m ? m[1] : null;
}

export function extractYoutubePlaylistId(rawUrl: string): string | null {
  const m = String(rawUrl || '').trim().match(/[?&]list=([a-zA-Z0-9_-]{10,120})/);
  return m ? m[1] : null;
}

export function decodeXmlEntities(str: string): string {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses ALL 3 YouTube timedtext caption response formats:
 *  1) JSON3 (`events[].segs[].utf8`)
 *  2) Timedtext Format 3 XML (`<p ...><s>...</s></p>` or `<p ...>text</p>`)
 *  3) Classic Timedtext XML (`<text ...>text</text>`)
 */
export function parseYoutubeCaptionPayload(payload: string): string[] {
  const trimmed = String(payload || '').trim();
  if (!trimmed) return [];

  // Format 1: JSON3
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as {
        events?: Array<{ segs?: Array<{ utf8?: string }> }>;
      };
      if (Array.isArray(parsed.events)) {
        const lines: string[] = [];
        for (const ev of parsed.events) {
          if (!Array.isArray(ev.segs)) continue;
          const line = ev.segs
            .map((s) => String(s.utf8 || ''))
            .join('')
            .replace(/\s+/g, ' ')
            .trim();
          if (line && line !== '\n') {
            lines.push(decodeXmlEntities(line));
          }
        }
        return lines.filter(Boolean);
      }
    } catch {
      // Fall through to XML parsers
    }
  }

  // Format 2: Timedtext Format 3 XML (<p ...>...</p>)
  const pLines: string[] = [];
  const pRegex = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let pm: RegExpExecArray | null;
  while ((pm = pRegex.exec(trimmed)) !== null) {
    const clean = decodeXmlEntities(pm[1]);
    if (clean) pLines.push(clean);
  }
  if (pLines.length > 0) return pLines;

  // Format 3: Classic Timedtext XML (<text ...>...</text>)
  const textLines: string[] = [];
  const textRegex = /<text\b[^>]*>([\s\S]*?)<\/text>/gi;
  let tm: RegExpExecArray | null;
  while ((tm = textRegex.exec(trimmed)) !== null) {
    const clean = decodeXmlEntities(tm[1]);
    if (clean) textLines.push(clean);
  }
  return textLines;
}

interface CaptionTrackCandidate {
  baseUrl: string;
  languageCode?: string;
  kind?: string;
}

function pickBestCaptionTrack(tracks: CaptionTrackCandidate[]): CaptionTrackCandidate | null {
  if (!Array.isArray(tracks) || tracks.length === 0) return null;
  return (
    tracks.find((t) => (t.languageCode || '').toLowerCase().startsWith('vi') && t.kind !== 'asr') ||
    tracks.find((t) => (t.languageCode || '').toLowerCase().startsWith('vi')) ||
    tracks.find((t) => (t.languageCode || '').toLowerCase().startsWith('en') && t.kind !== 'asr') ||
    tracks.find((t) => (t.languageCode || '').toLowerCase().startsWith('en')) ||
    tracks[0]
  );
}

async function fetchInnerTubePlayer(
  videoId: string,
  clientName: 'ANDROID' | 'IOS',
  clientVersion: string,
  userAgent: string
): Promise<{
  title: string;
  author: string;
  durationSec: number;
  tracks: CaptionTrackCandidate[];
} | null> {
  try {
    const resp = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': userAgent,
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName,
            clientVersion,
            hl: 'vi',
            gl: 'VN',
          },
        },
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as {
      videoDetails?: { title?: string; author?: string; lengthSeconds?: string };
      captions?: {
        playerCaptionsTracklistRenderer?: {
          captionTracks?: CaptionTrackCandidate[];
        };
      };
    };
    const tracks = json?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    return {
      title: json?.videoDetails?.title || `YouTube ${videoId}`,
      author: json?.videoDetails?.author || 'YouTube',
      durationSec: Number(json?.videoDetails?.lengthSeconds || 600) || 600,
      tracks: Array.isArray(tracks) ? tracks : [],
    };
  } catch {
    return null;
  }
}

async function fetchWatchPagePlayer(videoId: string): Promise<{
  title: string;
  author: string;
  durationSec: number;
  tracks: CaptionTrackCandidate[];
} | null> {
  try {
    const watchRes = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=vi`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!watchRes.ok) return null;
    const html = await watchRes.text();
    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    const title = titleMatch
      ? decodeXmlEntities(titleMatch[1]).replace(/\s*-\s*YouTube$/i, '').trim()
      : `YouTube ${videoId}`;
    const authorMatch = html.match(/"ownerChannelName":"([^"]+)"/);
    const author = authorMatch ? authorMatch[1] : 'YouTube';
    const durationMatch = html.match(/"lengthSeconds":"(\d+)"/);
    const durationSec = durationMatch ? Number(durationMatch[1]) : 600;
    const captionTracksMatch = html.match(/"captionTracks":(\[[\s\S]*?\])/);
    let tracks: CaptionTrackCandidate[] = [];
    if (captionTracksMatch) {
      try {
        tracks = JSON.parse(captionTracksMatch[1]);
      } catch {
        tracks = [];
      }
    }
    return { title, author, durationSec, tracks };
  } catch {
    return null;
  }
}

async function downloadCaptionLines(track: CaptionTrackCandidate): Promise<string[]> {
  const baseUrl = String(track.baseUrl || '').replace(/\\u0026/g, '&');
  if (!baseUrl) return [];

  const candidateUrls = [
    baseUrl.includes('fmt=') ? baseUrl : `${baseUrl}&fmt=json3`,
    baseUrl,
  ];

  for (const url of candidateUrls) {
    try {
      const capRes = await fetch(url, {
        headers: {
          'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip',
          'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
        },
        signal: AbortSignal.timeout(12000),
      });
      if (!capRes.ok) continue;
      const body = await capRes.text();
      const lines = parseYoutubeCaptionPayload(body);
      if (lines.length > 0) return lines;
    } catch {
      // try next format
    }
  }
  return [];
}

export async function fetchYoutubeTranscriptResilient(
  rawUrl: string
): Promise<
  | { ok: true; data: YoutubeTranscriptResult }
  | { ok: false; status: number; code?: string; error: string; title?: string; author?: string; videoId?: string; durationSec?: number }
> {
  const videoId = extractYoutubeVideoId(rawUrl);
  if (!videoId) {
    return {
      ok: false,
      status: 400,
      error: 'Link YouTube không hợp lệ. Vui lòng dán link youtube.com/watch?v=..., youtu.be/... hoặc Shorts.',
    };
  }

  // Try InnerTube ANDROID first (returns live timedtext URLs), then IOS, then Web Watch HTML
  const sources = [
    () =>
      fetchInnerTubePlayer(
        videoId,
        'ANDROID',
        '20.10.38',
        'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip'
      ),
    () =>
      fetchInnerTubePlayer(
        videoId,
        'IOS',
        '20.10.4',
        'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)'
      ),
    () => fetchWatchPagePlayer(videoId),
  ];

  let lastMeta: { title: string; author: string; durationSec: number } | null = null;
  let sawAnyTracks = false;

  for (const loadSource of sources) {
    const info = await loadSource();
    if (!info) continue;
    lastMeta = { title: info.title, author: info.author, durationSec: info.durationSec };
    if (info.tracks.length === 0) continue;
    sawAnyTracks = true;

    const best = pickBestCaptionTrack(info.tracks);
    if (!best) continue;
    const rawLines = await downloadCaptionLines(best);
    if (rawLines.length > 0) {
      return {
        ok: true,
        data: {
          videoId,
          title: info.title,
          author: info.author,
          durationSec: info.durationSec,
          languageCode: best.languageCode || 'vi',
          rawLines,
        },
      };
    }
  }

  if (!lastMeta) {
    return {
      ok: false,
      status: 502,
      error: 'Không thể kết nối tới YouTube lúc này. Vui lòng thử lại sau vài giây.',
    };
  }

  return {
    ok: false,
    status: 404,
    code: 'NO_CAPTIONS',
    error: sawAnyTracks
      ? 'Không tải được văn bản phụ đề công khai của video này.'
      : 'Video này chưa có phụ đề (CC/Transcript) công khai trên YouTube.',
    title: lastMeta.title,
    author: lastMeta.author,
    videoId,
    durationSec: lastMeta.durationSec,
  };
}

export async function fetchYoutubePlaylistResilient(
  rawUrl: string
): Promise<{ ok: true; data: YoutubePlaylistResult } | { ok: false; status: number; error: string }> {
  const playlistId = extractYoutubePlaylistId(rawUrl);
  if (!playlistId) {
    return {
      ok: false,
      status: 400,
      error: 'Link Playlist YouTube không hợp lệ (cần có tham số list=...).',
    };
  }

  const plRes = await fetch(`https://www.youtube.com/playlist?list=${playlistId}&hl=vi`, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!plRes.ok) {
    return { ok: false, status: 502, error: 'Không tải được danh sách phát YouTube.' };
  }
  const html = await plRes.text();
  const titleMatch = html.match(/<title>(.*?)<\/title>/i);
  const playlistTitle = titleMatch
    ? decodeXmlEntities(titleMatch[1]).replace(/\s*-\s*YouTube$/i, '').trim()
    : `Playlist ${playlistId.slice(0, 8)}`;

  const items: YoutubePlaylistVideo[] = [];
  const seen = new Set<string>();
  const itemRegex =
    /"playlistVideoRenderer":\{"videoId":"([a-zA-Z0-9_-]{11})"[\s\S]*?"title":\{"runs":\[\{"text":"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(html)) !== null && items.length < 40) {
    const vid = m[1];
    if (seen.has(vid)) continue;
    seen.add(vid);
    items.push({
      videoId: vid,
      title: m[2].replace(/\\"/g, '"'),
      url: `https://www.youtube.com/watch?v=${vid}`,
    });
  }

  if (items.length === 0) {
    const fallbackRegex = /"videoId":"([a-zA-Z0-9_-]{11})"/g;
    let fm: RegExpExecArray | null;
    while ((fm = fallbackRegex.exec(html)) !== null && items.length < 25) {
      if (seen.has(fm[1])) continue;
      seen.add(fm[1]);
      items.push({
        videoId: fm[1],
        title: `Tập ${items.length + 1}`,
        url: `https://www.youtube.com/watch?v=${fm[1]}`,
      });
    }
  }

  const estimatedFullSec = Math.max(8, items.length * 6);
  return {
    ok: true,
    data: {
      playlistId,
      title: playlistTitle,
      playlistTitle,
      totalVideos: items.length,
      estimatedSeconds: estimatedFullSec,
      estimatedFullSec,
      estimatedSingleSec: 6,
      videos: items,
    },
  };
}

/**
 * Parses clean Markdown returned by readability gateway (r.jina.ai) into a WebExtractionResult
 * when a novel website blocks direct server fetch (403/503/Cloudflare) or renders via JS.
 */
export function parseReaderMarkdownToChapter(
  markdown: string,
  pageUrl: string
): WebExtractionResult {
  const raw = String(markdown || '');
  const titleMatch = raw.match(/^Title:\s*(.+)$/m);
  const headerTitle = titleMatch ? titleMatch[1].trim() : '';

  const contentIdx = raw.indexOf('Markdown Content:');
  const body = contentIdx >= 0 ? raw.slice(contentIdx + 'Markdown Content:'.length) : raw;

  // Detect Next Chapter markdown links before stripping links
  let nextUrl: string | null = null;
  let nextLabel: string | null = null;
  const linkRegex = /\[([^\]]{1,60})\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g;
  const nextRx =
    /chương\s*tiếp|chương\s*sau|trang\s*sau|tiếp\s*theo|next\s*chapter|next\s*page|^next$|^tiếp$|^sau$|→|»/i;
  let lm: RegExpExecArray | null;
  while ((lm = linkRegex.exec(body)) !== null) {
    const label = lm[1].trim();
    const href = resolveHref(pageUrl, lm[2]);
    if (href && href !== pageUrl && nextRx.test(label)) {
      nextUrl = href;
      nextLabel = label;
      break;
    }
  }

  // Strip images, navigation bullet links, and markdown formatting into clean book paragraphs
  const lines = body.split(/\r?\n/);
  const paragraphs: string[] = [];
  let h1Title = '';

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;
    if (/^!\[[^\]]*\]\([^)]+\)$/.test(line)) continue; // standalone image
    if (/^[-*_]{3,}$/.test(line)) continue; // horizontal rule
    if (/^(\*|-|\+)\s+\[[^\]]+\]\([^)]+\)$/.test(line)) continue; // nav list item
    if (/^\[[^\]]{1,40}\]\([^)]+\)$/.test(line)) continue; // standalone nav link

    const headingMatch = line.match(/^#{1,3}\s+(.+)$/);
    if (headingMatch) {
      const hText = headingMatch[1].replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
      if (!h1Title && hText.length > 2) h1Title = hText;
      continue;
    }

    // Replace inline markdown links [text](url) -> text and strip bold/italic markers
    line = line
      .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[*_`~]/g, '')
      .trim();

    const cleaned = cleanParagraphText(line);
    if (
      cleaned.length > 15 &&
      !isJunkScrapedText(cleaned) &&
      !/^((chương|trang)\s*(tiếp|trước|sau)|next chapter|previous)$/i.test(cleaned)
    ) {
      paragraphs.push(cleaned);
    }
  }

  const title = headerTitle || h1Title || 'Trang web chưa có tiêu đề';
  const wordCount = paragraphs.reduce(
    (sum, p) => sum + (p.trim() ? p.trim().split(/\s+/).length : 0),
    0
  );

  return {
    url: pageUrl,
    title,
    paragraphs,
    nextUrl,
    nextLabel,
    prevUrl: null,
    wordCount,
    interactiveLinks: [],
  };
}

function looksBlockedHtml(html: string): boolean {
  const head = html.slice(0, 6000).toLowerCase();
  return (
    head.includes('just a moment...') ||
    head.includes('cf-browser-verification') ||
    head.includes('attention required! | cloudflare') ||
    head.includes('checking your browser before accessing')
  );
}

/**
 * Multi-tier resilient web chapter fetcher:
 *  Tier 1: Direct fetch with realistic Desktop Chrome headers
 *  Tier 2: Mobile Android Chrome User-Agent retry if blocked
 *  Tier 3: Readability JS-rendering gateway (r.jina.ai) if blocked (403/503/Cloudflare) or empty SPA body
 */
export async function fetchWebChapterResilient(
  rawUrl: string,
  localPort: number,
  nextSelector = ''
): Promise<{ html: string; extracted: WebExtractionResult; usedFallback: boolean }> {
  const parsedUrl = normalizeExternalUrl(rawUrl, localPort);
  const urlStr = parsedUrl.toString();
  const isLocal = parsedUrl.hostname === '127.0.0.1' || parsedUrl.hostname === 'localhost';

  const headerProfiles: Array<Record<string, string>> = [
    {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
      Referer: parsedUrl.origin + '/',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
    },
    {
      'User-Agent':
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.122 Mobile Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
    },
  ];

  let lastHtml = '';
  let lastExtracted: WebExtractionResult | null = null;
  let lastErrorMsg = '';

  for (const headers of headerProfiles) {
    try {
      const response = await fetch(urlStr, {
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(14000),
      });
      if (!response.ok) {
        lastErrorMsg = `Trang web trả về mã lỗi HTTP ${response.status}.`;
        continue;
      }
      const finalUrl = response.url || urlStr;
      const html = await response.text();
      if (looksBlockedHtml(html)) {
        lastErrorMsg = 'Trang web bật lớp bảo vệ chống bot (Cloudflare).';
        continue;
      }
      const extracted = extractWebChapterFromHtml(html, finalUrl, nextSelector);
      lastHtml = html;
      lastExtracted = extracted;

      // Good extraction found — return immediately!
      if (extracted.paragraphs.length >= 2 || isLocal) {
        return { html, extracted, usedFallback: false };
      }
    } catch (err) {
      lastErrorMsg = err instanceof Error ? err.message : 'Lỗi mạng khi tải trang web.';
    }
  }

  // Tier 3: Readability JS-rendering gateway fallback for external sites blocked by 403/Cloudflare/JS-SPA
  if (!isLocal) {
    try {
      const jinaUrl = `https://r.jina.ai/${urlStr}`;
      const jinaRes = await fetch(jinaUrl, {
        headers: {
          Accept: 'text/plain',
          'X-Return-Format': 'markdown',
        },
        signal: AbortSignal.timeout(15000),
      });
      if (jinaRes.ok) {
        const md = await jinaRes.text();
        const fallbackExtracted = parseReaderMarkdownToChapter(md, urlStr);
        if (
          fallbackExtracted.paragraphs.length > (lastExtracted?.paragraphs.length || 0)
        ) {
          return {
            html: md,
            extracted: fallbackExtracted,
            usedFallback: true,
          };
        }
      }
    } catch {
      // Keep best direct result or throw clear error below
    }
  }

  if (lastExtracted) {
    return { html: lastHtml, extracted: lastExtracted, usedFallback: false };
  }

  throw new Error(
    lastErrorMsg || 'Không thể kết nối tới trang web này. Hãy mở trang trong Trình duyệt WebView để kiểm tra.'
  );
}
