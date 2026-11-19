import type { ScriptSegment } from '../types/book';

export interface BatchedSegmentSpan {
  segmentIndex: number;
  paragraphIndex: number;
  startChar: number;
  endChar: number;
  text: string;
}

export interface PlaybackBatchUnit {
  id: string;
  speakerId: string;
  speakerName: string;
  emotionStyle: string;
  combinedText: string;
  spans: BatchedSegmentSpan[];
  firstSegmentIndex: number;
  lastSegmentIndex: number;
  firstParagraphIndex: number;
}

/**
 * Merges consecutive script segments from the SAME speaker up to `maxChars`
 * into a single continuous audio synthesis unit.
 *
 * Benefits:
 * 1. Loads multiple paragraphs / a full page in 1 single TTS request (5x-8x fewer API calls).
 * 2. Eliminates awkward loading gaps between adjacent paragraphs.
 * 3. Preserves exact per-paragraph character ranges so live word-by-word illumination
 *    tracks directly onto the right paragraph and word on the reading page.
 */
export function buildBatchedPlaybackUnits(
  script: ScriptSegment[],
  maxChars = 650
): PlaybackBatchUnit[] {
  if (!Array.isArray(script) || script.length === 0) return [];

  const units: PlaybackBatchUnit[] = [];
  let current: PlaybackBatchUnit | null = null;

  for (let idx = 0; idx < script.length; idx++) {
    const seg = script[idx];
    const cleanText = (seg.text || '').trim();
    if (!cleanText) continue;

    const canAppend =
      current !== null &&
      current.speakerId === seg.speakerId &&
      current.combinedText.length + cleanText.length + 2 <= maxChars;

    if (canAppend && current) {
      const separator = '\n';
      const startChar = current.combinedText.length + separator.length;
      const endChar = startChar + cleanText.length;
      current.combinedText = `${current.combinedText}${separator}${cleanText}`;
      current.spans.push({
        segmentIndex: idx,
        paragraphIndex: seg.paragraphIndex,
        startChar,
        endChar,
        text: cleanText,
      });
      current.lastSegmentIndex = idx;
    } else {
      current = {
        id: `batch-${units.length}-${seg.id}`,
        speakerId: seg.speakerId,
        speakerName: seg.speakerName,
        emotionStyle: seg.emotionStyle,
        combinedText: cleanText,
        spans: [
          {
            segmentIndex: idx,
            paragraphIndex: seg.paragraphIndex,
            startChar: 0,
            endChar: cleanText.length,
            text: cleanText,
          },
        ],
        firstSegmentIndex: idx,
        lastSegmentIndex: idx,
        firstParagraphIndex: seg.paragraphIndex,
      };
      units.push(current);
    }
  }

  return units;
}

/**
 * Given a playback progress ratio (0..1) inside a batched multi-paragraph unit,
 * resolves the EXACT active paragraph index and word progress ratio (0..1) inside
 * that paragraph so the reading page illuminates word-by-word accurately.
 */
export function resolveActiveHighlightInBatch(
  unit: PlaybackBatchUnit,
  playbackRatio: number
): { paragraphIndex: number; paragraphRatio: number; segmentIndex: number } {
  const clamped = Math.max(0, Math.min(1, playbackRatio));
  const totalLen = Math.max(1, unit.combinedText.length);
  const charPos = clamped * totalLen;

  for (const span of unit.spans) {
    if (charPos <= span.endChar || span === unit.spans[unit.spans.length - 1]) {
      const spanLen = Math.max(1, span.endChar - span.startChar);
      const localRatio = Math.max(0.02, Math.min(1, (charPos - span.startChar) / spanLen));
      return {
        paragraphIndex: span.paragraphIndex,
        paragraphRatio: localRatio,
        segmentIndex: span.segmentIndex,
      };
    }
  }

  const first = unit.spans[0];
  return {
    paragraphIndex: first?.paragraphIndex ?? unit.firstParagraphIndex,
    paragraphRatio: clamped,
    segmentIndex: first?.segmentIndex ?? unit.firstSegmentIndex,
  };
}

/**
 * Finds which batch unit contains a given paragraph index (used for "Nghe từ đây").
 */
export function findBatchIndexForParagraph(
  units: PlaybackBatchUnit[],
  paragraphIndex: number
): number {
  const exact = units.findIndex((u) =>
    u.spans.some((s) => s.paragraphIndex >= paragraphIndex)
  );
  return exact >= 0 ? exact : 0;
}
