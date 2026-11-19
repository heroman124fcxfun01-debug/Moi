import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBatchedPlaybackUnits,
  findBatchIndexForParagraph,
  resolveActiveHighlightInBatch,
} from './audiobookPrefetch.ts';
import type { ScriptSegment } from '../types/book.ts';

test('buildBatchedPlaybackUnits merges consecutive same-speaker paragraphs and splits on speaker change', () => {
  const script: ScriptSegment[] = [
    { id: 's0', paragraphIndex: 0, speakerId: 'narrator', speakerName: 'Người dẫn', emotionStyle: 'Tự nhiên', text: 'Đoạn một ngắn gọn.' },
    { id: 's1', paragraphIndex: 1, speakerId: 'narrator', speakerName: 'Người dẫn', emotionStyle: 'Tự nhiên', text: 'Đoạn hai tiếp nối mạch truyện.' },
    { id: 's2', paragraphIndex: 2, speakerId: 'hero', speakerName: 'Lữ Khách', emotionStyle: 'Hào hứng', text: 'Tôi đã tới nơi!' },
    { id: 's3', paragraphIndex: 3, speakerId: 'narrator', speakerName: 'Người dẫn', emotionStyle: 'Tự nhiên', text: 'Ánh nắng chiếu xuống.' },
  ];

  const batches = buildBatchedPlaybackUnits(script, 650);
  assert.equal(batches.length, 3);
  assert.equal(batches[0].spans.length, 2);
  assert.equal(batches[0].speakerId, 'narrator');
  assert.equal(batches[1].speakerId, 'hero');
  assert.equal(batches[2].speakerId, 'narrator');
});

test('resolveActiveHighlightInBatch maps batch progress ratio to the exact paragraph and word ratio', () => {
  const script: ScriptSegment[] = [
    { id: 's0', paragraphIndex: 0, speakerId: 'narrator', speakerName: 'Người dẫn', emotionStyle: 'Tự nhiên', text: 'A'.repeat(100) },
    { id: 's1', paragraphIndex: 1, speakerId: 'narrator', speakerName: 'Người dẫn', emotionStyle: 'Tự nhiên', text: 'B'.repeat(100) },
  ];

  const batches = buildBatchedPlaybackUnits(script, 500);
  assert.equal(batches.length, 1);

  const early = resolveActiveHighlightInBatch(batches[0], 0.25);
  assert.equal(early.paragraphIndex, 0);
  assert.ok(early.paragraphRatio > 0.4 && early.paragraphRatio < 0.6);

  const late = resolveActiveHighlightInBatch(batches[0], 0.75);
  assert.equal(late.paragraphIndex, 1);
  assert.ok(late.paragraphRatio > 0.4 && late.paragraphRatio < 0.6);
});

test('findBatchIndexForParagraph locates the exact batch containing a tapped paragraph', () => {
  const script: ScriptSegment[] = [
    { id: 's0', paragraphIndex: 0, speakerId: 'narrator', speakerName: 'Người dẫn', emotionStyle: '', text: 'Một' },
    { id: 's1', paragraphIndex: 1, speakerId: 'narrator', speakerName: 'Người dẫn', emotionStyle: '', text: 'Hai' },
    { id: 's2', paragraphIndex: 2, speakerId: 'hero', speakerName: 'Hero', emotionStyle: '', text: 'Ba' },
  ];
  const batches = buildBatchedPlaybackUnits(script, 500);
  assert.equal(findBatchIndexForParagraph(batches, 0), 0);
  assert.equal(findBatchIndexForParagraph(batches, 1), 0);
  assert.equal(findBatchIndexForParagraph(batches, 2), 1);
});
