import test from 'node:test';
import assert from 'node:assert/strict';
import { extractWebChapterFromHtml } from './webScraper';

test('extractWebChapterFromHtml extracts title, paragraphs, and auto-detects next chapter URL', () => {
  const html = `
    <!doctype html>
    <html>
      <head><title>Truyện mẫu</title></head>
      <body>
        <nav><a href="/home">Trang chủ</a></nav>
        <article>
          <h1>Chương 1: Cánh Cửa Thời Gian</h1>
          <div class="chapter-content">
            <p>Đêm buông xuống trên quảng trường đá cổ kính.</p>
            <p>"Ngươi đã sẵn sàng bước qua cánh cổng chưa?" — Người Gác Đền hỏi.</p>
          </div>
          <div class="pager">
            <a href="/chap-2" class="next-chapter-btn">Chương tiếp →</a>
          </div>
        </article>
        <footer>Bản quyền 2026</footer>
      </body>
    </html>
  `;

  const result = extractWebChapterFromHtml(html, 'http://localhost:3000/demo-web-book/chap-1');
  assert.equal(result.title, 'Chương 1: Cánh Cửa Thời Gian');
  assert.equal(result.paragraphs.length, 2);
  assert.equal(result.paragraphs[0], 'Đêm buông xuống trên quảng trường đá cổ kính.');
  assert.equal(result.nextUrl, 'http://localhost:3000/chap-2');
  assert.equal(result.nextLabel, 'Chương tiếp →');
});

test('extractWebChapterFromHtml respects customNextSelector when provided', () => {
  const html = `
    <html>
      <body>
        <main>
          <h1>Phần 3</h1>
          <p>Nội dung phần ba.</p>
          <a id="go-next" href="/book/part-4">Đọc tiếp</a>
        </main>
      </body>
    </html>
  `;
  const result = extractWebChapterFromHtml(html, 'https://example.com/book/part-3', '#go-next');
  assert.equal(result.nextUrl, 'https://example.com/book/part-4');
  assert.equal(result.nextLabel, 'Đọc tiếp');
});

import {
  extractYoutubePlaylistId,
  extractYoutubeVideoId,
  normalizeExternalUrl,
  parseReaderMarkdownToChapter,
  parseYoutubeCaptionPayload,
} from './communityExtractors';

test('normalizeExternalUrl auto-prepends https:// and resolves local demo paths', () => {
  assert.equal(
    normalizeExternalUrl('truyenfull.io/truyen-hay/chuong-1', 3000).toString(),
    'https://truyenfull.io/truyen-hay/chuong-1'
  );
  assert.equal(
    normalizeExternalUrl('/demo-web-book/chuong-1', 3000).toString(),
    'http://127.0.0.1:3000/demo-web-book/chuong-1'
  );
  assert.throws(() => normalizeExternalUrl('javascript:alert(1)', 3000));
});

test('extractYoutubeVideoId & extractYoutubePlaylistId support standard, mobile, shorts, live, and youtu.be URLs', () => {
  assert.equal(extractYoutubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYoutubeVideoId('https://youtu.be/dQw4w9WgXcQ?t=42'), 'dQw4w9WgXcQ');
  assert.equal(extractYoutubeVideoId('https://m.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYoutubeVideoId('https://www.youtube.com/live/dQw4w9WgXcQ?feature=share'), 'dQw4w9WgXcQ');
  assert.equal(
    extractYoutubePlaylistId('https://www.youtube.com/playlist?list=PL1234567890abcdef'),
    'PL1234567890abcdef'
  );
});

test('parseYoutubeCaptionPayload parses JSON3, Timedtext Format 3 XML (<p>), and Classic XML (<text>)', () => {
  const json3 = JSON.stringify({
    events: [
      { segs: [{ utf8: 'Xin chào ' }, { utf8: 'các bạn đọc giả.' }] },
      { segs: [{ utf8: 'Hôm nay chúng ta nghe truyện.' }] },
    ],
  });
  assert.deepEqual(parseYoutubeCaptionPayload(json3), [
    'Xin chào các bạn đọc giả.',
    'Hôm nay chúng ta nghe truyện.',
  ]);

  const xmlFormat3 = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><body><p t="1360" d="1680"><s>Chương một</s><s> bắt đầu.</s></p><p t="3100" d="2000">Gió đêm thổi qua thung lũng.</p></body></timedtext>`;
  assert.deepEqual(parseYoutubeCaptionPayload(xmlFormat3), [
    'Chương một bắt đầu.',
    'Gió đêm thổi qua thung lũng.',
  ]);

  const classicXml = `<transcript><text start="0">Dòng thứ nhất &amp; rõ ràng.</text><text start="2">Dòng thứ hai.</text></transcript>`;
  assert.deepEqual(parseYoutubeCaptionPayload(classicXml), [
    'Dòng thứ nhất & rõ ràng.',
    'Dòng thứ hai.',
  ]);
});

test('parseReaderMarkdownToChapter extracts clean Vietnamese novel paragraphs and next chapter link', () => {
  const md = `Title: Chương 12: Bí Mật Dưới Ánh Trăng
URL Source: https://example.com/truyen/chuong-12
Markdown Content:
* [Trang chủ](https://example.com/)
# Chương 12: Bí Mật Dưới Ánh Trăng

Ánh trăng bạc trải dài trên mặt hồ phẳng lặng như gương, phản chiếu bóng dáng người lữ khách đứng lặng lẽ bên bờ đá.

"Chúng ta phải lên đường trước lúc bình minh," ông lão khẽ nói rồi trao tấm bản đồ cổ.

[Chương tiếp →](https://example.com/truyen/chuong-13)
`;
  const result = parseReaderMarkdownToChapter(md, 'https://example.com/truyen/chuong-12');
  assert.equal(result.title, 'Chương 12: Bí Mật Dưới Ánh Trăng');
  assert.equal(result.paragraphs.length, 2);
  assert.equal(result.nextUrl, 'https://example.com/truyen/chuong-13');
  assert.equal(result.nextLabel, 'Chương tiếp →');
});

