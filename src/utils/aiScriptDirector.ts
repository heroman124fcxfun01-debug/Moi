export type DirectedSegmentType = 'narration' | 'dialogue' | 'inner_thought';
export type SpatialAudioEffect = 'none' | 'inner_thought' | 'whisper' | 'shout';

export interface DirectedTextChunk {
  text: string;
  segmentType: DirectedSegmentType;
  speakerHint: string; // 'Narrator' or character name
  spatialEffect: SpatialAudioEffect;
  emotionStyle: string;
}

const THOUGHT_LEAD_REGEX =
  /^([^.!?:"“”«»]{2,80}?\b(?:thầm nghĩ|nghĩ thầm|tự nhủ|nghĩ bụng|lẩm bẩm trong lòng|thầm nhủ|trong lòng thầm nghĩ|trong lòng nghĩ|thầm nói|nghĩ trong lòng)\s*:)\s*(.+)$/i;

const SPOKEN_LEAD_REGEX =
  /^([^.!?:"“”«»]{2,80}?\b(?:nói|hỏi|đáp|trả lời|quát|gầm lên|hét lên|thì thầm|khẽ nói|lạnh giọng nói|cười nói|thở dài nói|trầm giọng|lên tiếng|bảo|nhắc|kêu lên|gọi|thốt lên)\s*:)\s*(.+)$/i;

const QUOTE_SPLIT_REGEX = /("[^"\n]{2,}"|“[^”\n]{2,}”|«[^»\n]{2,}»|『[^』\n]{2,}』)/g;

const NON_NAME_LEAD = new Set([
  'Hắn', 'Y', 'Gã', 'Nàng', 'Cô', 'Anh', 'Chị', 'Ông', 'Bà', 'Ta', 'Tôi', 'Ngươi', 'Cậu', 'Em', 'Lão',
  'Mọi', 'Người', 'Một', 'Nhưng', 'Rồi', 'Sau', 'Khi', 'Lúc', 'Thấy', 'Nghe', 'Nhìn',
]);

function extractSpeakerFromLead(leadText: string): string {
  // Prefer multi-word capitalized Vietnamese character name (e.g. "Sở Phong", "Tiêu Viêm")
  const matches = leadText.match(
    /\b([A-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯẠ-Ỹ][a-zàáâãèéêìíòóôõùúăđĩũơưạ-ỹ]{1,12}(?:\s+[A-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯẠ-Ỹ][a-zàáâãèéêìíòóôõùúăđĩũơưạ-ỹ]{1,12}){1,2})\b/g
  );
  if (matches && matches.length > 0) {
    for (let i = matches.length - 1; i >= 0; i--) {
      const candidate = matches[i].trim();
      const firstWord = candidate.split(/\s+/)[0];
      if (!NON_NAME_LEAD.has(firstWord)) {
        return candidate;
      }
    }
  }
  return 'Nhân vật';
}

export function detectSpatialEffect(
  segmentType: DirectedSegmentType,
  leadContext: string,
  text: string
): SpatialAudioEffect {
  if (segmentType === 'inner_thought') return 'inner_thought';

  const ctx = `${leadContext} ${text}`.toLowerCase();
  if (/thì thầm|khẽ nói|nói nhỏ|ghé tai|rỉ tai|lầm bầm nhỏ/.test(ctx)) {
    return 'whisper';
  }
  if (
    segmentType === 'dialogue' &&
    (/quát|gầm|hét|rống|gào|quát lớn|giận dữ|chiến đấu|giết|xông lên/.test(ctx) ||
      /!{1,3}$/.test(text.trim()) && text.trim().length <= 85)
  ) {
    return 'shout';
  }
  return 'none';
}

export function detectSegmentEmotion(
  segmentType: DirectedSegmentType,
  spatialEffect: SpatialAudioEffect,
  leadContext: string,
  text: string
): string {
  if (segmentType === 'inner_thought') return 'Nội tâm trầm lắng, suy tư';
  if (spatialEffect === 'whisper') return 'Thì thầm nhẹ nhàng, bí mật';
  if (spatialEffect === 'shout') return 'Quát mạnh mẽ, kịch tính, dứt khoát';
  const combined = `${leadContext} ${text}`.toLowerCase();
  if (/cười|vui|mừng|hào hứng/.test(combined)) return 'Vui tươi, linh hoạt';
  if (/buồn|khóc|nước mắt|đau đớn|thở dài/.test(combined)) return 'Trầm buồn, chậm rãi';
  if (/lạnh|băng|lạnh giọng|khinh miệt/.test(combined)) return 'Lạnh lùng, điềm tĩnh';
  return segmentType === 'dialogue' ? 'Đối thoại tự nhiên' : 'Dẫn truyện truyền cảm';
}

/**
 * AI 2 Director: Strictly separates narration, direct spoken dialogue, and inner thought.
 * Example:
 *   "Sở Phong thầm nghĩ: Ta nhất định phải mạnh hơn!"
 *   -> [narration / Narrator] "Sở Phong thầm nghĩ:"
 *   -> [inner_thought / Sở Phong] "Ta nhất định phải mạnh hơn!"
 */
export function splitNarrationDialogueAndThought(
  paragraph: string,
  lastKnownSpeaker = 'Nhân vật'
): DirectedTextChunk[] {
  const cleaned = paragraph.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];

  // 1. Explicit inner thought colon pattern without or with quotes
  const thoughtMatch = cleaned.match(THOUGHT_LEAD_REGEX);
  if (thoughtMatch) {
    const lead = thoughtMatch[1].trim();
    const rawBody = thoughtMatch[2].trim();
    const body = rawBody.replace(/^["“«『]+|["”»』]+$/g, '').trim();
    const speaker = extractSpeakerFromLead(lead);
    const resolvedSpeaker = speaker !== 'Nhân vật' ? speaker : lastKnownSpeaker;
    return [
      {
        text: lead,
        segmentType: 'narration',
        speakerHint: 'Narrator',
        spatialEffect: 'none',
        emotionStyle: 'Dẫn truyện chuyển nhịp',
      },
      ...(body
        ? [
            {
              text: body,
              segmentType: 'inner_thought' as const,
              speakerHint: resolvedSpeaker,
              spatialEffect: 'inner_thought' as const,
              emotionStyle: 'Nội tâm trầm lắng, suy tư',
            },
          ]
        : []),
    ];
  }

  // 2. Quoted segments mixed with narration (e.g. `Sở Phong nói: "Đi thôi!" rồi quay lưng bước đi.`)
  if (QUOTE_SPLIT_REGEX.test(cleaned)) {
    QUOTE_SPLIT_REGEX.lastIndex = 0;
    const parts = cleaned.split(QUOTE_SPLIT_REGEX).filter((p) => p && p.trim().length > 0);
    const chunks: DirectedTextChunk[] = [];
    let currentLead = '';
    let activeSpeaker = lastKnownSpeaker;

    for (const part of parts) {
      const trimmed = part.trim();
      const isQuoted =
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith('“') && trimmed.endsWith('”')) ||
        (trimmed.startsWith('«') && trimmed.endsWith('»')) ||
        (trimmed.startsWith('『') && trimmed.endsWith('』'));

      if (isQuoted) {
        const inner = trimmed.slice(1, -1).trim();
        if (!inner) continue;
        const isThought = /thầm nghĩ|nghĩ thầm|tự nhủ|nghĩ bụng|trong lòng|thầm nhủ/i.test(currentLead);
        const segType: DirectedSegmentType = isThought ? 'inner_thought' : 'dialogue';
        const spatial = detectSpatialEffect(segType, currentLead, inner);
        chunks.push({
          text: inner,
          segmentType: segType,
          speakerHint: activeSpeaker,
          spatialEffect: spatial,
          emotionStyle: detectSegmentEmotion(segType, spatial, currentLead, inner),
        });
      } else {
        currentLead = trimmed;
        const found = extractSpeakerFromLead(trimmed);
        if (found !== 'Nhân vật') activeSpeaker = found;
        chunks.push({
          text: trimmed,
          segmentType: 'narration',
          speakerHint: 'Narrator',
          spatialEffect: 'none',
          emotionStyle: 'Dẫn truyện truyền cảm',
        });
      }
    }

    if (chunks.length > 0) return chunks;
  }

  // 3. Colon-based spoken dialogue without quotes (e.g. `Lâm Động lạnh giọng nói: Ngươi bước ra đây!`)
  const spokenMatch = cleaned.match(SPOKEN_LEAD_REGEX);
  if (spokenMatch) {
    const lead = spokenMatch[1].trim();
    const body = spokenMatch[2].trim();
    const speaker = extractSpeakerFromLead(lead);
    const resolvedSpeaker = speaker !== 'Nhân vật' ? speaker : lastKnownSpeaker;
    const spatial = detectSpatialEffect('dialogue', lead, body);
    return [
      {
        text: lead,
        segmentType: 'narration',
        speakerHint: 'Narrator',
        spatialEffect: 'none',
        emotionStyle: 'Dẫn truyện chuyển nhịp',
      },
      ...(body
        ? [
            {
              text: body,
              segmentType: 'dialogue' as const,
              speakerHint: resolvedSpeaker,
              spatialEffect: spatial,
              emotionStyle: detectSegmentEmotion('dialogue', spatial, lead, body),
            },
          ]
        : []),
    ];
  }

  // 4. Dash-led Vietnamese dialogue (`- Ta đi đây!`)
  if (/^[-–—]\s+\S/.test(cleaned)) {
    const body = cleaned.replace(/^[-–—]\s+/, '').trim();
    const spatial = detectSpatialEffect('dialogue', '', body);
    return [
      {
        text: body,
        segmentType: 'dialogue',
        speakerHint: lastKnownSpeaker,
        spatialEffect: spatial,
        emotionStyle: detectSegmentEmotion('dialogue', spatial, '', body),
      },
    ];
  }

  // Default pure narration
  return [
    {
      text: cleaned,
      segmentType: 'narration',
      speakerHint: 'Narrator',
      spatialEffect: 'none',
      emotionStyle: 'Dẫn truyện truyền cảm',
    },
  ];
}

const CONJUNCTION_BREAK_REGEX =
  /\s+(nhưng mà|tuy nhiên|thế nhưng|bởi vì|cho nên|sau đó|vì vậy|mặc dù|thế là|do đó|ngay lập tức|đồng thời)\s+/gi;

/**
 * Smart Pauses & Breath Insertion:
 * - Preserves short comma pauses and medium sentence pauses
 * - Automatically inserts gentle commas before Vietnamese conjunctions inside overly long comma-less sentences
 * - Normalizes ellipsis & exclamation cadence for natural AI breathing
 */
export function applySmartBreathingPauses(text: string): string {
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/\.{3,}|…+/g, '... ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return '';

  // Split into sentence-like segments to inspect long comma-less clauses
  const sentences = normalized.split(/(?<=[.!?…])\s+/);
  const processed = sentences.map((sentence) => {
    const words = sentence.split(/\s+/);
    // Only insert gentle breathing commas if the sentence is long (> 15 words) and sparse in punctuation
    const commaCount = (sentence.match(/[,;:]/g) || []).length;
    if (words.length >= 16 && commaCount === 0) {
      let enhanced = sentence.replace(CONJUNCTION_BREAK_REGEX, ', $1 ');
      // If still very long (> 22 words) with no comma, add a soft breath pause near the middle
      if (!enhanced.includes(',') && words.length >= 22) {
        const mid = Math.floor(words.length / 2);
        const copy = [...words];
        copy[mid] = `${copy[mid]},`;
        enhanced = copy.join(' ');
      }
      return enhanced.replace(/,\s*,+/g, ',').trim();
    }
    return sentence;
  });

  return processed.join(' ').replace(/\s+([,.!?;:])/g, '$1').trim();
}
