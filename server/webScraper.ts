import * as cheerio from 'cheerio';

export interface WebInteractiveTarget {
  label: string;
  selector: string;
  href: string | null;
}

export interface WebExtractionResult {
  url: string;
  title: string;
  paragraphs: string[];
  nextUrl: string | null;
  nextLabel: string | null;
  prevUrl: string | null;
  wordCount: number;
  interactiveLinks?: WebInteractiveTarget[];
  paywallHint?: string;
}

const NEXT_TEXT_PATTERNS = [
  /chương\s*tiếp/i,
  /chương\s*sau/i,
  /trang\s*sau/i,
  /tiếp\s*theo/i,
  /next\s*chapter/i,
  /next\s*page/i,
  /^next$/i,
  /^tiếp$/i,
  /^sau$/i,
  /→|»|›/,
];

const PREV_TEXT_PATTERNS = [
  /chương\s*trước/i,
  /trang\s*trước/i,
  /prev/i,
  /previous/i,
  /←|«|‹/,
];

export function resolveHref(baseUrl: string, href: string | undefined): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('javascript:')) {
    return null;
  }
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return null;
  }
}

export function extractWebChapterFromHtml(
  html: string,
  pageUrl: string,
  customNextSelector?: string
): WebExtractionResult {
  const $ = cheerio.load(html);

  // Detect Next & Prev links + interactive clickable targets BEFORE stripping nav elements
  let nextUrl: string | null = null;
  let nextLabel: string | null = null;
  let prevUrl: string | null = null;

  const interactiveLinks: WebInteractiveTarget[] = [];
  const seenTargets = new Set<string>();
  $('a[href], button').each((_, el) => {
    const node = $(el);
    const label = node.text().replace(/\s+/g, ' ').trim();
    if (!label || label.length > 60) return;
    const id = node.attr('id');
    const cls = (node.attr('class') || '').trim().split(/\s+/).filter(Boolean)[0];
    const tag = el.tagName?.toLowerCase() || 'a';
    const selector = id ? `#${id}` : cls ? `${tag}.${cls}` : `${tag}:contains("${label.slice(0, 24)}")`;
    const href = resolveHref(pageUrl, node.attr('href'));
    const key = `${selector}|${label}`;
    if (!seenTargets.has(key) && interactiveLinks.length < 18) {
      seenTargets.add(key);
      interactiveLinks.push({ label, selector, href });
    }
  });

  if (customNextSelector && customNextSelector.trim()) {
    const customEl = $(customNextSelector.trim()).first();
    if (customEl.length > 0) {
      const href = customEl.attr('href') || customEl.closest('a').attr('href');
      nextUrl = resolveHref(pageUrl, href);
      nextLabel = customEl.text().replace(/\s+/g, ' ').trim() || 'Trang tiếp';
    }
  }

  if (!nextUrl) {
    const relNext = $('a[rel="next"], link[rel="next"]').first();
    if (relNext.length > 0) {
      nextUrl = resolveHref(pageUrl, relNext.attr('href'));
      nextLabel = relNext.text().replace(/\s+/g, ' ').trim() || 'Trang tiếp';
    }
  }

  if (!nextUrl) {
    const anchors = $('a[href]').toArray();
    for (const el of anchors) {
      const anchor = $(el);
      const text = anchor.text().replace(/\s+/g, ' ').trim();
      const cls = (anchor.attr('class') || '') + ' ' + (anchor.attr('id') || '');
      if (
        NEXT_TEXT_PATTERNS.some((rx) => rx.test(text)) ||
        /\b(next|next-chap|next-chapter|btn-next)\b/i.test(cls)
      ) {
        const resolved = resolveHref(pageUrl, anchor.attr('href'));
        if (resolved && resolved !== pageUrl) {
          nextUrl = resolved;
          nextLabel = text || 'Chương tiếp';
          break;
        }
      }
    }
  }

  // Detect Prev link
  const prevAnchors = $('a[href]').toArray();
  for (const el of prevAnchors) {
    const anchor = $(el);
    const text = anchor.text().replace(/\s+/g, ' ').trim();
    if (PREV_TEXT_PATTERNS.some((rx) => rx.test(text))) {
      const resolved = resolveHref(pageUrl, anchor.attr('href'));
      if (resolved && resolved !== pageUrl) {
        prevUrl = resolved;
        break;
      }
    }
  }

  // Title extraction
  const h1Text = $('article h1, main h1, .chapter-title, #chapter-title, h1').first().text().replace(/\s+/g, ' ').trim();
  const docTitle = $('title').first().text().replace(/\s+/g, ' ').trim();
  const title = h1Text || docTitle || 'Trang web chưa có tiêu đề';

  const paywallNotice = $('.paywall-notice, .vip-lock, [data-paywall]').text().replace(/\s+/g, ' ').trim();

  // Remove chrome & non-content blocks
  $('script, style, noscript, iframe, svg, nav, header, footer, aside, form, .ads, .advertisement, .sidebar, .comments, .menu, .breadcrumb').remove();

  // Locate main prose container
  const contentSelectors = [
    '#chapter-c',
    '.chapter-c',
    '.chapter-content',
    '#chapter-content',
    '.reading-content',
    'article',
    'main',
    '.content',
    '#content',
    'body',
  ];

  let container: cheerio.Cheerio<any> = $('body');
  for (const sel of contentSelectors) {
    const found = $(sel).first();
    if (found.length > 0 && found.text().trim().length > 40) {
      container = found;
      break;
    }
  }

  let paragraphs: string[] = [];
  const pTags = container.find('p').toArray();
  if (pTags.length >= 2) {
    paragraphs = pTags
      .map((el) => $(el).text().replace(/\s+/g, ' ').trim())
      .filter((t) => t.length > 1);
  } else {
    // Handle <br>-separated content common on web novel sites
    const htmlFrag = container.html() || '';
    const withNewlines = htmlFrag
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6])>/gi, '\n');
    const textOnly = cheerio.load(`<div>${withNewlines}</div>`)('div').text();
    paragraphs = textOnly
      .split('\n')
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter((l) => l.length > 1 && l !== h1Text);
  }

  // Filter out stray nav strings at start/end
  paragraphs = paragraphs.filter(
    (p) => !/^((chương|trang)\s*(tiếp|trước|sau)|next chapter|previous)$/i.test(p)
  );

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
    prevUrl,
    wordCount,
    interactiveLinks,
    paywallHint: paywallNotice || undefined,
  };
}
