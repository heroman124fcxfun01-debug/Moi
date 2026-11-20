import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzePcmVoiceMetrics,
  extractWebChapterClientSide,
} from './deviceHardware';

function makeSineWave(freqHz: number, sampleRate: number, seconds: number, amplitude = 0.25): Float32Array {
  const len = Math.floor(sampleRate * seconds);
  const buf = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    buf[i] = Math.sin((2 * Math.PI * freqHz * i) / sampleRate) * amplitude;
  }
  return buf;
}

test('analyzePcmVoiceMetrics accurately distinguishes deep male vs bright female pitch on-device', () => {
  const deepMale = analyzePcmVoiceMetrics(makeSineWave(105, 16000, 1.5, 0.2), 16000, 'nam.wav');
  assert.ok(deepMale.estimatedF0Hz && deepMale.estimatedF0Hz >= 95 && deepMale.estimatedF0Hz <= 120);
  assert.ok(['Charon', 'Fenrir'].includes(deepMale.recommendedBaseVoice));
  assert.ok(deepMale.pitchHint < 1.0);

  const gentleFemale = analyzePcmVoiceMetrics(makeSineWave(210, 16000, 1.5, 0.12), 16000, 'nu.wav');
  assert.ok(
    gentleFemale.estimatedF0Hz && gentleFemale.estimatedF0Hz >= 195 && gentleFemale.estimatedF0Hz <= 225
  );
  assert.equal(gentleFemale.recommendedBaseVoice, 'Zephyr');
  assert.ok(gentleFemale.pitchHint > 1.0);
});

test('extractWebChapterClientSide parses HTML chapter title, paragraphs, and next link offline', () => {
  const html = `
    <html>
      <head><title>Truyện Mẫu</title><style>.ad{display:none}</style></head>
      <body>
        <nav><a href="/">Trang chủ</a></nav>
        <h1>Chương 12: Đỉnh Núi Sương Mù</h1>
        <p>Sương sớm phủ kín con đường đá dẫn lên đỉnh núi cao, nơi gió lạnh thổi qua từng tán thông già.</p>
        <p>Chàng kiếm khách dừng chân, đưa tay chạm nhẹ vào chuôi kiếm cũ đã đồng hành cùng mình suốt mười năm.</p>
        <a href="/truyen/chuong-13">Chương sau →</a>
      </body>
    </html>
  `;
  const parsed = extractWebChapterClientSide(html, 'https://example.com/truyen/chuong-12');
  assert.equal(parsed.title, 'Chương 12: Đỉnh Núi Sương Mù');
  assert.equal(parsed.paragraphs.length, 2);
  assert.equal(parsed.nextUrl, 'https://example.com/truyen/chuong-13');
  assert.equal(parsed.nextLabel, 'Chương sau →');
  assert.ok(parsed.wordCount > 25);
});

test('extractWebChapterClientSide strips head meta/link viewport and DTV-EBOOK scraper noise', () => {
  const noisyHtml = `
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lora">
      </head>
      <body>
        <p>scale=1.0, maximum-scale=1.0, href="https://fonts.googleapis.com"</p>
        <p>DTV-EBOOK - Kho truyện hay</p>
        <p>Đêm khuya thanh vắng, tiếng gió rít qua mái ngói rêu phong nghe thật não nề.</p>
      </body>
    </html>
  `;
  const parsed = extractWebChapterClientSide(noisyHtml, 'https://example.com/ch1');
  assert.equal(parsed.paragraphs.length, 1);
  assert.equal(
    parsed.paragraphs[0],
    'Đêm khuya thanh vắng, tiếng gió rít qua mái ngói rêu phong nghe thật não nề.'
  );
});
