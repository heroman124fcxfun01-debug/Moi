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
