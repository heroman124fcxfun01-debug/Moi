/**
 * Zero-Shot Neural Voice Cloning Bridge & Pure Vietnamese G2P / Sentence Chunker.
 *
 * Connects the React/Capacitor frontend directly to Android's native ONNX Runtime Mobile
 * 3-step Zero-Shot Voice Cloning pipeline (`window.BookhadNative`):
 *   1. AudioPreprocessor (Mono 16kHz/24kHz + C++ JNI Noise Gate, ZERO pitch shift)
 *   2. SpeakerEncoderEngine (1-time ONNX INT8 embedding cache ~1KB `.emb`)
 *   3. NeuralZeroShotTtsEngine (Vietnamese G2P + Acoustic Model -> Mel-Spectrogram -> HiFi-GAN Neural Vocoder)
 */

export interface NativeZeroShotBridge {
  startVoiceCloneRecording?: (voiceName: string) => void;
  stopAndCloneVoice?: () => void;
  listClonedVoicesJson?: () => string;
  deleteClonedVoice?: (voiceId: string) => boolean;
  speakBookChapter?: (
    paragraphsJson: string,
    voiceId: string,
    startParagraphIndex: number,
    speechRate: number
  ) => void;
  pauseBookAudio?: () => void;
  resumeBookAudio?: () => void;
  stopBookAudio?: () => void;
}

export interface NeuralSentenceChunk {
  paragraphIndex: number;
  charOffset: number;
  text: string;
  wordCount: number;
}

const VI_VOWEL_TONE_MAP: Record<string, [string, number]> = {
  à: ['a', 2], á: ['a', 3], ả: ['a', 4], ã: ['a', 5], ạ: ['a', 6],
  ằ: ['ă', 2], ắ: ['ă', 3], ẳ: ['ă', 4], ẵ: ['ă', 5], ặ: ['ă', 6],
  ầ: ['â', 2], ấ: ['â', 3], ẩ: ['â', 4], ẫ: ['â', 5], ậ: ['â', 6],
  è: ['e', 2], é: ['e', 3], ẻ: ['e', 4], ẽ: ['e', 5], ẹ: ['e', 6],
  ề: ['ê', 2], ế: ['ê', 3], ể: ['ê', 4], ễ: ['ê', 5], ệ: ['ê', 6],
  ì: ['i', 2], í: ['i', 3], ỉ: ['i', 4], ĩ: ['i', 5], ị: ['i', 6],
  ò: ['o', 2], ó: ['o', 3], ỏ: ['o', 4], õ: ['o', 5], ọ: ['o', 6],
  ồ: ['ô', 2], ố: ['ô', 3], ổ: ['ô', 4], ỗ: ['ô', 5], ộ: ['ô', 6],
  ờ: ['ơ', 2], ớ: ['ơ', 3], ở: ['ơ', 4], ỡ: ['ơ', 5], ợ: ['ơ', 6],
  ù: ['u', 2], ú: ['u', 3], ủ: ['u', 4], ũ: ['u', 5], ụ: ['u', 6],
  ừ: ['ư', 2], ứ: ['ư', 3], ử: ['ư', 4], ữ: ['ư', 5], ự: ['ư', 6],
  ỳ: ['y', 2], ý: ['y', 3], ỷ: ['y', 4], ỹ: ['y', 5], ỵ: ['y', 6],
};

const VI_ONSET_IPA: Array<[string, string]> = [
  ['ngh', 'ŋ'], ['ng', 'ŋ'], ['nh', 'ɲ'], ['ch', 'tɕ'], ['tr', 'ʈ'],
  ['th', 'tʰ'], ['ph', 'f'], ['kh', 'x'], ['gh', 'ɣ'], ['gi', 'z'],
  ['qu', 'kw'], ['đ', 'ɗ'], ['b', 'ɓ'], ['c', 'k'], ['k', 'k'],
  ['d', 'z'], ['g', 'ɣ'], ['h', 'h'], ['l', 'l'], ['m', 'm'],
  ['n', 'n'], ['p', 'p'], ['r', 'z'], ['s', 's'], ['t', 't'],
  ['v', 'v'], ['x', 's'],
];

const VI_VOWEL_IPA: Record<string, string> = {
  iê: 'iə', yê: 'iə', ia: 'iə', ya: 'iə',
  uô: 'uə', ua: 'uə', ươ: 'ɯə', ưa: 'ɯə',
  ă: 'a', â: 'ə', ê: 'e', ô: 'o', ơ: 'əː', ư: 'ɯ',
  a: 'aː', e: 'ɛ', i: 'i', y: 'i', o: 'ɔ', u: 'u',
};

const VI_CODA_IPA: Array<[string, string]> = [
  ['nh', 'ɲ'], ['ch', 'k'], ['ng', 'ŋ'], ['m', 'm'], ['n', 'n'],
  ['p', 'p'], ['t', 't'], ['c', 'k'], ['i', 'j'], ['y', 'j'], ['o', 'w'], ['u', 'w'],
];

const VI_TONE_IPA = ['', '˧˧', '˨˩', '˧˥', '˧˩˧', '˧ˀ˥', '˧ˀ˨'];

export function getAndroidZeroShotBridge(): NativeZeroShotBridge | null {
  if (typeof window === 'undefined') return null;
  const native = (window as unknown as { BookhadNative?: NativeZeroShotBridge }).BookhadNative;
  if (!native || typeof native.speakBookChapter !== 'function') return null;
  return native;
}

export function isAndroidZeroShotBridgeAvailable(): boolean {
  return getAndroidZeroShotBridge() !== null;
}

/**
 * Splits long Vietnamese/book text into short natural sentences (<= 20-30 words)
 * matching Android's VietnameseG2P.chunkParagraphs so neural tensor RAM stays bounded.
 */
export function chunkVietnameseTextForNeuralTts(
  paragraphs: string[],
  startParagraphIndex = 0,
  maxWordsPerChunk = 28
): NeuralSentenceChunk[] {
  const clampedMax = Math.max(12, Math.min(30, Math.floor(maxWordsPerChunk)));
  const softTarget = Math.min(22, clampedMax);
  const chunks: NeuralSentenceChunk[] = [];
  const safeStart = Math.max(0, Math.min(Math.max(0, paragraphs.length - 1), startParagraphIndex));

  for (let pIdx = safeStart; pIdx < paragraphs.length; pIdx++) {
    const para = paragraphs[pIdx] || '';
    if (!para.trim()) continue;
    const matches = Array.from(para.matchAll(/\S+/g));
    if (matches.length === 0) continue;

    let cursor = 0;
    while (cursor < matches.length) {
      const hardEnd = Math.min(cursor + clampedMax, matches.length);
      let splitEnd = hardEnd;

      if (hardEnd < matches.length) {
        let sentenceBreak = -1;
        let clauseBreak = -1;
        const minBreak = Math.min(cursor + 8, hardEnd - 1);
        for (let i = hardEnd - 1; i >= minBreak; i--) {
          const val = matches[i][0];
          const last = val[val.length - 1];
          if (last === '.' || last === '!' || last === '?' || last === '…') {
            sentenceBreak = i + 1;
            break;
          }
          if (
            clauseBreak === -1 &&
            i >= cursor + softTarget - 8 &&
            (last === ',' || last === ';' || last === ':' || last === '—')
          ) {
            clauseBreak = i + 1;
          }
        }
        splitEnd =
          sentenceBreak > cursor
            ? sentenceBreak
            : clauseBreak > cursor
            ? clauseBreak
            : Math.min(cursor + softTarget, matches.length);
      }

      const startChar = matches[cursor].index ?? 0;
      const lastMatch = matches[splitEnd - 1];
      const endChar = (lastMatch.index ?? 0) + lastMatch[0].length;
      const slice = para.slice(startChar, endChar).trim();
      if (slice) {
        chunks.push({
          paragraphIndex: pIdx,
          charOffset: startChar,
          text: slice,
          wordCount: splitEnd - cursor,
        });
      }
      cursor = splitEnd;
    }
  }
  return chunks;
}

/**
 * Pure Vietnamese 6-tone Grapheme-to-Phoneme (G2P) converter producing IPA phoneme tokens.
 */
export function vietnameseToPhonemes(sentence: string): string[] {
  const nfc = sentence.toLowerCase().normalize('NFC');
  const out: string[] = [];
  const tokens = nfc.match(/[\p{L}]+|[.,!?;:…—-]/gu) || [];

  for (const tok of tokens) {
    if (tok.length === 1 && !/\p{L}/u.test(tok)) {
      out.push(tok, ' ');
      continue;
    }

    let tone = 1;
    let rest = '';
    for (const ch of tok) {
      const mapped = VI_VOWEL_TONE_MAP[ch];
      if (mapped) {
        rest += mapped[0];
        tone = mapped[1];
      } else {
        rest += ch;
      }
    }

    for (const [g, ipa] of VI_ONSET_IPA) {
      if (rest.startsWith(g)) {
        out.push(ipa);
        rest = rest.slice(g.length);
        break;
      }
    }

    let codaIpa: string | null = null;
    if (rest.length >= 2) {
      for (const [g, ipa] of VI_CODA_IPA) {
        if (rest.endsWith(g) && rest.length > g.length) {
          codaIpa = ipa;
          rest = rest.slice(0, rest.length - g.length);
          break;
        }
      }
    }

    let idx = 0;
    while (idx < rest.length) {
      if (idx + 1 < rest.length) {
        const pair = rest.slice(idx, idx + 2);
        if (VI_VOWEL_IPA[pair]) {
          out.push(VI_VOWEL_IPA[pair]);
          idx += 2;
          continue;
        }
      }
      const single = rest[idx];
      out.push(VI_VOWEL_IPA[single] || single);
      idx += 1;
    }

    if (codaIpa) out.push(codaIpa);
    if (VI_TONE_IPA[tone]) out.push(VI_TONE_IPA[tone]);
    out.push(' ');
  }

  if (out.length > 0 && out[out.length - 1] === ' ') out.pop();
  return out;
}
