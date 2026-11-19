import JSZip from 'jszip';
import type { Book, Chapter, TranslationMode } from '../types/book';
import { cleanExtractedParagraphs } from './textProcessing';
import { computeBookFingerprint } from './syncAndStats';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXml(str: string): string {
  return str
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

export interface EpubArchiveSpec {
  mimetype: string;
  containerXml: string;
  contentOpf: string;
  tocNcx: string;
  navXhtml: string;
  chapters: Array<{ fileName: string; xhtml: string }>;
}

/**
 * Pure synchronous builder generating standards-compliant EPUB 3/2 files.
 * Can optionally export original, override-translated, or bilingual text.
 */
export function buildEpubArchiveSpec(
  book: Book,
  options?: { translationMode?: TranslationMode; targetLang?: string }
): EpubArchiveSpec {
  const mode = options?.translationMode ?? 'original';
  const targetLang = options?.targetLang ?? 'vi';
  const safeUid = `laziread-${book.id.replace(/[^a-zA-Z0-9_-]/g, '') || 'book'}`;
  const title = escapeXml(book.title || 'Sách chưa đặt tên');
  const author = escapeXml(book.author || 'Khuyết danh');
  const lang = escapeXml(book.language || 'vi');
  const description = escapeXml(book.description || '');

  const chapterFiles = book.chapters.map((ch, idx) => {
    const fileName = `chapter_${idx + 1}.xhtml`;
    const chTitle = escapeXml(ch.title || `Chương ${idx + 1}`);
    const transList = ch.translations?.[targetLang]?.paragraphs ?? [];

    const bodyParagraphs = ch.paragraphs
      .map((para, pIdx) => {
        const trans = transList[pIdx];
        if (mode === 'override' && trans) {
          return `    <p>${escapeXml(trans)}</p>`;
        }
        if (mode === 'bilingual' && trans) {
          return [
            `    <p class="orig">${escapeXml(para)}</p>`,
            `    <p class="trans"><em>${escapeXml(trans)}</em></p>`,
          ].join('\n');
        }
        return `    <p>${escapeXml(para)}</p>`;
      })
      .join('\n');

    const xhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${lang}">
<head>
  <meta charset="utf-8" />
  <title>${chTitle}</title>
  <style>
    body { font-family: Georgia, serif; line-height: 1.75; margin: 1.5em; color: #1c1917; }
    h1 { font-size: 1.5em; margin-bottom: 1em; }
    p { margin: 0 0 0.9em 0; text-align: justify; }
    p.trans { color: #57534e; padding-left: 0.75em; border-left: 2px solid #d6d3d1; }
  </style>
</head>
<body>
  <section id="ch-${idx + 1}">
    <h1>${chTitle}</h1>
${bodyParagraphs}
  </section>
</body>
</html>`;

    return { fileName, xhtml };
  });

  const manifestItems = chapterFiles
    .map(
      (f, idx) =>
        `    <item id="ch${idx + 1}" href="${f.fileName}" media-type="application/xhtml+xml"/>`
    )
    .join('\n');

  const spineItems = chapterFiles
    .map((_, idx) => `    <itemref idref="ch${idx + 1}"/>`)
    .join('\n');

  const navPoints = book.chapters
    .map(
      (ch, idx) => `    <navPoint id="navPoint-${idx + 1}" playOrder="${idx + 1}">
      <navLabel><text>${escapeXml(ch.title || `Chương ${idx + 1}`)}</text></navLabel>
      <content src="chapter_${idx + 1}.xhtml"/>
    </navPoint>`
    )
    .join('\n');

  const navLis = book.chapters
    .map(
      (ch, idx) =>
        `      <li><a href="chapter_${idx + 1}.xhtml">${escapeXml(ch.title || `Chương ${idx + 1}`)}</a></li>`
    )
    .join('\n');

  const contentOpf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookId">${safeUid}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:creator>${author}</dc:creator>
    <dc:language>${lang}</dc:language>
    <dc:description>${description}</dc:description>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${manifestItems}
  </manifest>
  <spine toc="ncx">
${spineItems}
  </spine>
</package>`;

  const tocNcx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${safeUid}"/>
    <meta name="dtb:depth" content="1"/>
  </head>
  <docTitle><text>${title}</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>`;

  const navXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><meta charset="utf-8" /><title>Mục lục</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Mục lục</h1>
    <ol>
${navLis}
    </ol>
  </nav>
</body>
</html>`;

  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

  return {
    mimetype: 'application/epub+zip',
    containerXml,
    contentOpf,
    tocNcx,
    navXhtml,
    chapters: chapterFiles,
  };
}

/**
 * Generates an actual downloadable `.epub` Blob using JSZip.
 */
export async function buildEpubBlob(
  book: Book,
  options?: { translationMode?: TranslationMode; targetLang?: string }
): Promise<Blob> {
  const spec = buildEpubArchiveSpec(book, options);
  const zip = new JSZip();

  // EPUB spec requires uncompressed mimetype as first entry
  zip.file('mimetype', spec.mimetype, { compression: 'STORE' });
  zip.file('META-INF/container.xml', spec.containerXml);
  zip.file('OEBPS/content.opf', spec.contentOpf);
  zip.file('OEBPS/toc.ncx', spec.tocNcx);
  zip.file('OEBPS/nav.xhtml', spec.navXhtml);

  for (const ch of spec.chapters) {
    zip.file(`OEBPS/${ch.fileName}`, ch.xhtml);
  }

  return await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
  });
}

function resolveRelativePath(baseDir: string, relPath: string): string {
  const cleanRel = decodeURIComponent(relPath.split('#')[0]);
  if (!baseDir) return cleanRel;
  const parts = baseDir.split('/').filter(Boolean);
  for (const seg of cleanRel.split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

function stripHtmlToParagraphs(html: string): { title: string; paragraphs: string[] } {
  // Works in both browser DOMParser and Node test fallback
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const titleEl = doc.querySelector('h1, h2, title');
    const title = titleEl?.textContent?.trim() || '';

    const nodes = Array.from(doc.querySelectorAll('p, h2, h3, blockquote, li'));
    const paras = nodes
      .map((n) => n.textContent?.replace(/\s+/g, ' ').trim() || '')
      .filter((t) => t.length > 0);

    if (paras.length > 0) {
      return { title, paragraphs: paras };
    }
    const bodyText = doc.body?.textContent || '';
    return { title, paragraphs: cleanExtractedParagraphs(bodyText) };
  }

  // Regex fallback for non-DOM environments (Node unit tests)
  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>|<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = unescapeXml(
    (titleMatch?.[1] || titleMatch?.[2] || '').replace(/<[^>]+>/g, '').trim()
  );
  const pMatches = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
  const paragraphs = pMatches
    .map((m) => unescapeXml(m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()))
    .filter(Boolean);

  if (paragraphs.length > 0) {
    return { title, paragraphs };
  }

  const stripped = unescapeXml(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, '\n')
  );
  return { title, paragraphs: cleanExtractedParagraphs(stripped) };
}

/**
 * Parses a real `.epub` binary buffer into our structured `Book` model.
 */
export async function parseEpubBuffer(
  buffer: ArrayBuffer,
  fileName: string
): Promise<Omit<Book, 'id' | 'addedAt' | 'lastReadAt'>> {
  const zip = await JSZip.loadAsync(buffer);

  // 1. Locate OPF path via META-INF/container.xml
  let opfPath = '';
  const containerFile = zip.file('META-INF/container.xml');
  if (containerFile) {
    const containerXml = await containerFile.async('text');
    const match = containerXml.match(/full-path=["']([^"']+)["']/i);
    if (match) opfPath = match[1];
  }

  if (!opfPath) {
    const opfEntry = Object.keys(zip.files).find((k) => k.endsWith('.opf'));
    if (opfEntry) opfPath = opfEntry;
  }

  const fallbackTitle = fileName.replace(/\.epub$/i, '');
  let title = fallbackTitle;
  let author = 'Không rõ tác giả';
  let description = '';
  let language = 'vi';
  let coverUrl: string | undefined;

  const chapters: Chapter[] = [];

  if (opfPath && zip.file(opfPath)) {
    const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
    const opfText = await zip.file(opfPath)!.async('text');

    const titleMatch = opfText.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i);
    if (titleMatch?.[1]?.trim()) title = unescapeXml(titleMatch[1].trim());

    const creatorMatch = opfText.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i);
    if (creatorMatch?.[1]?.trim()) author = unescapeXml(creatorMatch[1].trim());

    const descMatch = opfText.match(/<dc:description[^>]*>([\s\S]*?)<\/dc:description>/i);
    if (descMatch?.[1]?.trim()) {
      description = unescapeXml(descMatch[1].replace(/<[^>]+>/g, '').trim());
    }

    const langMatch = opfText.match(/<dc:language[^>]*>([\s\S]*?)<\/dc:language>/i);
    if (langMatch?.[1]?.trim()) language = unescapeXml(langMatch[1].trim());

    // Parse manifest items
    const manifestMap = new Map<string, { href: string; mediaType: string; properties?: string }>();
    const itemRegex = /<item\s+([^>]+?)\/?\s*>/gi;
    let m: RegExpExecArray | null;
    while ((m = itemRegex.exec(opfText)) !== null) {
      const attrs = m[1];
      const idM = attrs.match(/id=["']([^"']+)["']/i);
      const hrefM = attrs.match(/href=["']([^"']+)["']/i);
      const mediaM = attrs.match(/media-type=["']([^"']+)["']/i);
      const propM = attrs.match(/properties=["']([^"']+)["']/i);
      if (idM && hrefM) {
        manifestMap.set(idM[1], {
          href: hrefM[1],
          mediaType: mediaM?.[1] || '',
          properties: propM?.[1],
        });
      }
    }

    // Try extracting cover image
    let coverHref: string | undefined;
    for (const item of manifestMap.values()) {
      if (item.properties?.includes('cover-image')) {
        coverHref = item.href;
        break;
      }
    }
    if (!coverHref) {
      const metaCover = opfText.match(/<meta[^>]*name=["']cover["'][^>]*content=["']([^"']+)["']/i);
      if (metaCover && manifestMap.has(metaCover[1])) {
        coverHref = manifestMap.get(metaCover[1])!.href;
      }
    }
    if (coverHref) {
      const fullCoverPath = resolveRelativePath(opfDir, coverHref);
      const coverZipFile = zip.file(fullCoverPath);
      if (coverZipFile) {
        const b64 = await coverZipFile.async('base64');
        const ext = fullCoverPath.split('.').pop()?.toLowerCase() || 'jpeg';
        const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
        coverUrl = `data:${mime};base64,${b64}`;
      }
    }

    // Parse spine order
    const spineIds: string[] = [];
    const spineRegex = /<itemref\s+[^>]*idref=["']([^"']+)["'][^>]*>/gi;
    while ((m = spineRegex.exec(opfText)) !== null) {
      spineIds.push(m[1]);
    }

    const orderedPaths: string[] = [];
    for (const idref of spineIds) {
      const item = manifestMap.get(idref);
      if (
        item &&
        !item.properties?.includes('nav') &&
        (item.mediaType.includes('html') || /\.(xhtml|html|htm)$/i.test(item.href))
      ) {
        orderedPaths.push(resolveRelativePath(opfDir, item.href));
      }
    }

    for (const chPath of orderedPaths) {
      const file = zip.file(chPath);
      if (!file) continue;
      const html = await file.async('text');
      const { title: chTitle, paragraphs } = stripHtmlToParagraphs(html);
      if (paragraphs.length === 0) continue;
      const idx = chapters.length;
      chapters.push({
        id: `ch-${idx + 1}`,
        index: idx,
        title: chTitle || `Chương ${idx + 1}`,
        paragraphs,
      });
    }
  }

  // Fallback if OPF parsing yielded no chapters
  if (chapters.length === 0) {
    const htmlKeys = Object.keys(zip.files)
      .filter((k) => /\.(xhtml|html|htm)$/i.test(k) && !k.includes('nav'))
      .sort();
    for (const key of htmlKeys) {
      const html = await zip.file(key)!.async('text');
      const { title: chTitle, paragraphs } = stripHtmlToParagraphs(html);
      if (paragraphs.length === 0) continue;
      const idx = chapters.length;
      chapters.push({
        id: `ch-${idx + 1}`,
        index: idx,
        title: chTitle || `Chương ${idx + 1}`,
        paragraphs,
      });
    }
  }

  if (chapters.length === 0) {
    chapters.push({
      id: 'ch-1',
      index: 0,
      title: 'Nội dung',
      paragraphs: ['Không tìm thấy nội dung văn bản trong tệp EPUB này.'],
    });
  }

  const fingerprint = computeBookFingerprint({ title, author, chapters });

  return {
    title,
    author,
    description: description || `Sách EPUB nhập từ tệp ${fileName}`,
    language,
    sourceType: 'epub',
    collection: 'Sách EPUB đã nhập',
    readingStyle: 'novel',
    fingerprint,
    coverUrl,
    chapters,
    currentChapterIndex: 0,
    currentParagraphIndex: 0,
    progressPercent: 1,
    bookmarks: [],
    highlights: [],
    voiceAssignments: {},
  };
}
