import type { ScriptSegment } from '../types/book';

export interface BatchedSegmentSpan {
  segmentIndex: number;
  paragraphIndex: number;
  /** Character start index inside the source paragraph (crucial when a paragraph is split into narration + dialogue) */
  paragraphCharStart: number;
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
 * Preserves exact per-paragraph character offsets (`paragraphCharStart`) even when
 * one paragraph is split into multiple narration + dialogue segments, so live
 * word illumination and automatic page-flipping stay 100% locked across pages.
 */
export function buildBatchedPlaybackUnits(
  script: ScriptSegment[],
  maxChars = 260,
  sourceParagraphs?: string[]
): PlaybackBatchUnit[] {
  if (!Array.isArray(script) || script.length === 0) return [];

  const units: PlaybackBatchUnit[] = [];
  let current: PlaybackBatchUnit | null = null;
  const paraCursorMap = new Map<number, number>();

  const resolveParagraphCharStart = (paraIdx: number, segText: string): number => {
    const prevCursor = paraCursorMap.get(paraIdx) ?? 0;
    const rawPara = sourceParagraphs?.[paraIdx];
    if (rawPara) {
      const normalizedPara = rawPara.replace(/\s+/g, ' ').trim();
      const probe = segText.replace(/\s+/g, ' ').trim();
      if (probe) {
        const directIdx = normalizedPara.indexOf(probe, prevCursor);
        if (directIdx >= 0) {
          paraCursorMap.set(paraIdx, directIdx + probe.length);
          return directIdx;
        }
        const shortProbe = probe.slice(0, Math.min(24, probe.length));
        const shortIdx = normalizedPara.indexOf(shortProbe, prevCursor);
        if (shortIdx >= 0) {
          paraCursorMap.set(paraIdx, shortIdx + probe.length);
          return shortIdx;
        }
      }
    }
    paraCursorMap.set(paraIdx, prevCursor + segText.length + 1);
    return prevCursor;
  };

  for (let idx = 0; idx < script.length; idx++) {
    const seg = script[idx];
    const cleanText = (seg.text || '').trim();
    if (!cleanText) continue;

    const paragraphCharStart = resolveParagraphCharStart(seg.paragraphIndex, cleanText);

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
        paragraphCharStart,
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
            paragraphCharStart,
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
 * Computes a punctuation-weighted character index from a normalized playback time ratio (0..1).
 * Commas pause slightly (~4 char units) and sentence breaks/newlines pause longer (~9 char units)
 * so the word highlight stays locked onto the spoken word instead of racing through pauses.
 */
export function mapTimeRatioToWeightedCharIndex(text: string, timeRatio: number): number {
  const len = text.length;
  if (len <= 1) return 0;
  const clamped = Math.max(0, Math.min(1, timeRatio));
  if (clamped <= 0) return 0;
  if (clamped >= 1) return len;

  let totalWeight = 0;
  for (let i = 0; i < len; i++) {
    const ch = text[i];
    if (ch === '\n' || ch === '.' || ch === '!' || ch === '?' || ch === '…') {
      totalWeight += 9;
    } else if (ch === ',' || ch === ';' || ch === ':' || ch === '—' || ch === '–') {
      totalWeight += 4.5;
    } else if (ch === ' ') {
      totalWeight += 0.7;
    } else {
      totalWeight += 1;
    }
  }

  const targetWeight = clamped * Math.max(1, totalWeight);
  let acc = 0;
  for (let i = 0; i < len; i++) {
    const ch = text[i];
    const w =
      ch === '\n' || ch === '.' || ch === '!' || ch === '?' || ch === '…'
        ? 9
        : ch === ',' || ch === ';' || ch === ':' || ch === '—' || ch === '–'
          ? 4.5
          : ch === ' '
            ? 0.7
            : 1;
    acc += w;
    if (acc >= targetWeight) {
      return i;
    }
  }
  return len;
}

/**
 * Given a playback progress ratio (0..1) inside a batched multi-paragraph unit,
 * resolves the EXACT active paragraph index, word progress ratio (0..1), and
 * exact character offset inside that paragraph so multi-page paragraphs glow on
 * the right page and single word without jumping.
 */
export function resolveActiveHighlightInBatch(
  unit: PlaybackBatchUnit,
  playbackRatio: number,
  explicitCharIndex?: number
): {
  paragraphIndex: number;
  paragraphRatio: number;
  segmentIndex: number;
  charOffsetInParagraph: number;
} {
  const clamped = Math.max(0, Math.min(1, playbackRatio));
  const charPos =
    typeof explicitCharIndex === 'number' && Number.isFinite(explicitCharIndex)
      ? Math.max(0, Math.min(unit.combinedText.length, explicitCharIndex))
      : mapTimeRatioToWeightedCharIndex(unit.combinedText, clamped);

  for (const span of unit.spans) {
    if (charPos <= span.endChar || span === unit.spans[unit.spans.length - 1]) {
      const spanLen = Math.max(1, span.endChar - span.startChar);
      const localChar = Math.max(0, Math.min(spanLen, Math.floor(charPos - span.startChar)));
      const localRatio = Math.max(0, Math.min(1, localChar / spanLen));
      return {
        paragraphIndex: span.paragraphIndex,
        paragraphRatio: localRatio,
        segmentIndex: span.segmentIndex,
        charOffsetInParagraph: (span.paragraphCharStart || 0) + localChar,
      };
    }
  }

  const first = unit.spans[0];
  return {
    paragraphIndex: first?.paragraphIndex ?? unit.firstParagraphIndex,
    paragraphRatio: clamped,
    segmentIndex: first?.segmentIndex ?? unit.firstSegmentIndex,
    charOffsetInParagraph: first?.paragraphCharStart ?? 0,
  };
}

/**
 * Finds which batch unit contains a given paragraph index (and optional charOffset inside that paragraph).
 */
export function findBatchIndexForParagraph(
  units: PlaybackBatchUnit[],
  paragraphIndex: number,
  charOffset = 0
): number {
  if (charOffset > 0) {
    const exactOffsetIdx = units.findIndex((u) =>
      u.spans.some(
        (s) =>
          s.paragraphIndex === paragraphIndex &&
          charOffset >= s.paragraphCharStart &&
          charOffset <= s.paragraphCharStart + s.text.length + 2
      )
    );
    if (exactOffsetIdx >= 0) return exactOffsetIdx;
  }
  const exact = units.findIndex((u) =>
    u.spans.some((s) => s.paragraphIndex >= paragraphIndex)
  );
  return exact >= 0 ? exact : 0;
}
