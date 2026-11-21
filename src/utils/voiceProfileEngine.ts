export type VoiceAgeGroup = 'child' | 'youth' | 'middle' | 'elder';
export type VoicePersonality = 'warm' | 'sharp' | 'cold' | 'bold';

export interface VoicePromptRuntimeParams {
  pitch: number; // 0.65 - 1.45
  speed: number; // 0.72 - 1.35
  energy: number; // 0.7 - 1.35
  pauseDurationMs: number; // 120 - 520
  emotionBias: string;
  warmthDb: number; // -4 to +6
  clarityDb: number; // -2 to +5
  recommendedBaseVoice: 'Kore' | 'Zephyr' | 'Puck' | 'Charon' | 'Fenrir';
  geminiStylePrompt: string;
  tags: string[];
}

export interface CompactVoiceProfile {
  voiceId: string;
  gender: 'male' | 'female';
  ageGroup: VoiceAgeGroup;
  personality: VoicePersonality;
  acousticPitchHz: number;
  acousticSpeedFactor: number;
  acousticWarmthDb: number;
  acousticClarityDb: number;
  fingerprintHash: number;
  promptParams: VoicePromptRuntimeParams;
}

export const VOICE_AGE_OPTIONS: Array<{ id: VoiceAgeGroup; label: string }> = [
  { id: 'child', label: 'Trẻ con' },
  { id: 'youth', label: 'Thanh niên' },
  { id: 'middle', label: 'Trung niên' },
  { id: 'elder', label: 'Lão giả' },
];

export const VOICE_PERSONALITY_OPTIONS: Array<{ id: VoicePersonality; label: string }> = [
  { id: 'warm', label: 'Trầm ấm' },
  { id: 'sharp', label: 'Đanh đá' },
  { id: 'cold', label: 'Lạnh lùng' },
  { id: 'bold', label: 'Hào sảng' },
];

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function hashVoiceSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

export function generateVoiceProfileId(name: string, sampleSignature?: string): string {
  const clean = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 10) || 'voice';
  const hash = hashVoiceSeed(`${name}|${sampleSignature || ''}|${Date.now()}`).toString(36).slice(0, 6);
  return `vprof-${clean}-${hash}`;
}

export function inferAgeAndPersonalityFromStyle(
  gender: 'male' | 'female',
  instruction?: string,
  styleText?: string,
  pitchHz?: number
): { ageGroup: VoiceAgeGroup; personality: VoicePersonality } {
  const combined = `${instruction || ''} ${styleText || ''}`.toLowerCase();

  let ageGroup: VoiceAgeGroup = 'youth';
  if (/trẻ con|nhỏ tuổi|thiếu nhi|em bé|ngây thơ|bé gái|bé trai/.test(combined)) {
    ageGroup = 'child';
  } else if (/lão|già|cụ|ông lão|bà lão|trưởng lão|cổ lão|khàn/.test(combined)) {
    ageGroup = 'elder';
  } else if (/trung niên|chững chạc|chín chắn|đĩnh đạc|trưởng thành|từng trải/.test(combined)) {
    ageGroup = 'middle';
  } else if (typeof pitchHz === 'number') {
    if (pitchHz >= 255) ageGroup = 'child';
    else if (gender === 'male' && pitchHz <= 122) ageGroup = 'elder';
    else if (gender === 'male' && pitchHz <= 145) ageGroup = 'middle';
  }

  let personality: VoicePersonality = 'warm';
  if (/đanh đá|chua ngoa|sắc sảo|gắt|nghiêm khắc|nhanh nhẹn/.test(combined)) {
    personality = 'sharp';
  } else if (/lạnh lùng|băng giá|vô cảm|điềm tĩnh|u tối|ma mị|kinh dị|trầm lặng/.test(combined)) {
    personality = 'cold';
  } else if (/hào sảng|mạnh mẽ|uy lực|hùng hồn|sôi nổi|kiếm hiệp|tiên hiệp|nhiệt huyết/.test(combined)) {
    personality = 'bold';
  } else if (/trầm ấm|ấm áp|dịu dàng|ngọt|truyền cảm|nhẹ nhàng|tình cảm|ngôn tình/.test(combined)) {
    personality = 'warm';
  }

  return { ageGroup, personality };
}

/**
 * Step 2: Prompt-to-Voice Controller
 * Translates natural-language "Chỉ dẫn AI" into concrete acoustic & TTS runtime parameters.
 */
export function parseAiVoiceInstruction(
  promptText: string,
  base: {
    gender?: 'male' | 'female';
    ageGroup?: VoiceAgeGroup;
    personality?: VoicePersonality;
    acousticPitchHz?: number;
    acousticSpeedFactor?: number;
    acousticWarmthDb?: number;
    acousticClarityDb?: number;
    voiceStyle?: string;
    name?: string;
  } = {}
): VoicePromptRuntimeParams {
  const rawPrompt = (promptText || '').trim();
  const text = `${rawPrompt} ${base.voiceStyle || ''}`.toLowerCase();

  let gender: 'male' | 'female' = base.gender || 'female';
  if (/\b(nam|đàn ông|con trai|lão giả|ông lão|thiếu niên|trầm nam)\b/.test(text)) {
    gender = 'male';
  } else if (/\b(nữ|phụ nữ|con gái|thiếu nữ|cô gái|ngọt ngào|mềm mại)\b/.test(text)) {
    gender = 'female';
  }

  const inferred = inferAgeAndPersonalityFromStyle(gender, rawPrompt, base.voiceStyle, base.acousticPitchHz);
  const ageGroup = base.ageGroup || inferred.ageGroup;
  const personality = base.personality || inferred.personality;

  let pitch = gender === 'male' ? 0.9 : 1.06;
  let speed = typeof base.acousticSpeedFactor === 'number' ? clamp(base.acousticSpeedFactor, 0.82, 1.18) : 1.0;
  let energy = 1.0;
  let pauseDurationMs = 240;
  let warmthDb = typeof base.acousticWarmthDb === 'number' ? clamp(base.acousticWarmthDb, -3, 5) : 1.2;
  let clarityDb = typeof base.acousticClarityDb === 'number' ? clamp(base.acousticClarityDb, -2, 4) : 1.2;
  let emotionBias = 'natural';
  const tags: string[] = [];

  // Map acoustic pitch from sample if provided
  if (typeof base.acousticPitchHz === 'number' && base.acousticPitchHz > 65) {
    const refHz = gender === 'male' ? 132 : 210;
    const ratio = clamp(base.acousticPitchHz / refHz, 0.78, 1.26);
    pitch = Number((pitch * 0.45 + ratio * 0.55).toFixed(2));
  }

  // Age modulation
  if (ageGroup === 'child') {
    pitch += 0.16;
    speed += 0.05;
    clarityDb += 1.4;
    warmthDb -= 1.0;
    tags.push('Trẻ con');
  } else if (ageGroup === 'middle') {
    pitch -= 0.05;
    speed -= 0.03;
    warmthDb += 1.2;
    tags.push('Trung niên');
  } else if (ageGroup === 'elder') {
    pitch -= 0.12;
    speed -= 0.1;
    warmthDb += 2.2;
    pauseDurationMs += 75;
    tags.push('Lão giả');
  } else {
    tags.push('Thanh niên');
  }

  // Personality modulation
  if (personality === 'warm') {
    warmthDb += 1.8;
    pitch -= 0.03;
    emotionBias = 'warm-narrative';
    tags.push('Trầm ấm');
  } else if (personality === 'sharp') {
    pitch += 0.07;
    speed += 0.06;
    clarityDb += 2.0;
    energy += 0.14;
    emotionBias = 'sharp-expressive';
    tags.push('Đanh đá');
  } else if (personality === 'cold') {
    pitch -= 0.04;
    speed -= 0.05;
    energy -= 0.12;
    clarityDb += 1.2;
    pauseDurationMs += 50;
    emotionBias = 'cold-restrained';
    tags.push('Lạnh lùng');
  } else if (personality === 'bold') {
    pitch -= 0.05;
    speed += 0.03;
    energy += 0.2;
    warmthDb += 1.2;
    clarityDb += 1.5;
    emotionBias = 'bold-heroic';
    tags.push('Hào sảng');
  }

  // Fine-grained prompt keywords (Prompt-to-Voice Controller)
  if (/trầm ấm|trầm bổng|ấm áp|dày giọng|trầm/.test(text)) {
    pitch -= 0.07;
    warmthDb += 2.0;
    if (!tags.includes('Trầm ấm')) tags.push('Trầm ấm');
  }
  if (/cao|trong trẻo|thanh thoát|nhẹ bẫng|ngọt/.test(text)) {
    pitch += 0.08;
    clarityDb += 1.5;
    tags.push('Trong trẻo');
  }
  if (/chậm rãi|khoan thai|từ tốn|thư thả|nhấn nhá|chậm/.test(text)) {
    speed -= 0.1;
    pauseDurationMs += 90;
    tags.push('Chậm rãi');
  }
  if (/nhanh|gấp gáp|dồn dập|kịch tính|hoạt bát/.test(text)) {
    speed += 0.1;
    pauseDurationMs -= 60;
    energy += 0.12;
    tags.push('Nhịp nhanh');
  }
  if (/nhấn mạnh cuối câu|nhấn cuối|dứt khoát|rõ ràng/.test(text)) {
    clarityDb += 1.6;
    energy += 0.1;
    pauseDurationMs += 40;
    tags.push('Nhấn cuối câu');
  }
  if (/thì thầm|nhỏ nhẹ|nội tâm|suy nghĩ|êm dịu/.test(text)) {
    energy -= 0.22;
    speed -= 0.05;
    warmthDb += 1.0;
    emotionBias = 'whisper-intimate';
    tags.push('Thì thầm');
  }
  if (/cổ trang|tiên hiệp|kiếm hiệp|huyền huyễn/.test(text)) {
    speed -= 0.04;
    pauseDurationMs += 55;
    warmthDb += 1.1;
    emotionBias = 'epic-classical';
    tags.push('Cổ trang');
  }
  if (/kinh dị|ma mị|rùng rợn|trinh thám|u ám/.test(text)) {
    pitch -= 0.08;
    speed -= 0.08;
    pauseDurationMs += 95;
    emotionBias = 'dark-suspense';
    tags.push('U tối');
  }
  if (/hài hước|vui tươi|tinh nghịch|nhí nhảnh/.test(text)) {
    pitch += 0.07;
    speed += 0.06;
    energy += 0.15;
    emotionBias = 'playful';
    tags.push('Vui tươi');
  }

  // Pick closest base Gemini voice matching gender + personality + age
  let recommendedBaseVoice: VoicePromptRuntimeParams['recommendedBaseVoice'];
  if (gender === 'male') {
    if (personality === 'bold' || ageGroup === 'elder') {
      recommendedBaseVoice = 'Fenrir';
    } else if (personality === 'cold' || personality === 'warm' || ageGroup === 'middle') {
      recommendedBaseVoice = 'Charon';
    } else {
      recommendedBaseVoice = 'Puck';
    }
  } else {
    if (personality === 'sharp' || ageGroup === 'child' || emotionBias === 'playful') {
      recommendedBaseVoice = 'Zephyr';
    } else {
      recommendedBaseVoice = 'Kore';
    }
  }

  const finalPitch = Number(clamp(pitch, 0.68, 1.4).toFixed(2));
  const finalSpeed = Number(clamp(speed, 0.74, 1.32).toFixed(2));
  const finalEnergy = Number(clamp(energy, 0.7, 1.35).toFixed(2));
  const finalPause = Math.round(clamp(pauseDurationMs, 120, 500));
  const finalWarmth = Number(clamp(warmthDb, -3.5, 6).toFixed(1));
  const finalClarity = Number(clamp(clarityDb, -2, 5).toFixed(1));

  const ageLabel = VOICE_AGE_OPTIONS.find((o) => o.id === ageGroup)?.label || 'Thanh niên';
  const persLabel = VOICE_PERSONALITY_OPTIONS.find((o) => o.id === personality)?.label || 'Trầm ấm';

  const directives: string[] = [
    `Giọng tiếng Việt tự nhiên (${gender === 'male' ? 'nam' : 'nữ'}, độ tuổi ${ageLabel}, tính cách ${persLabel})`,
  ];
  if (base.voiceStyle) directives.push(`văn phong ${base.voiceStyle}`);
  if (rawPrompt) directives.push(`chỉ dẫn diễn đạt: ${rawPrompt}`);
  directives.push(
    `nhịp tốc độ ${finalSpeed <= 0.92 ? 'chậm rãi khoan thai' : finalSpeed >= 1.08 ? 'linh hoạt dứt khoát' : 'vừa phải tự nhiên'}`,
    `âm sắc ${finalPitch <= 0.9 ? 'trầm sâu' : finalPitch >= 1.12 ? 'thanh sáng' : 'cân bằng'}`
  );

  return {
    pitch: finalPitch,
    speed: finalSpeed,
    energy: finalEnergy,
    pauseDurationMs: finalPause,
    emotionBias,
    warmthDb: finalWarmth,
    clarityDb: finalClarity,
    recommendedBaseVoice,
    geminiStylePrompt: directives.join('; '),
    tags: Array.from(new Set(tags)).slice(0, 5),
  };
}

/**
 * Step 1 + 2 combined: builds compact voice profile ready for preview & persistence.
 */
export function buildCompactVoiceProfile(input: {
  id?: string;
  name: string;
  gender: 'male' | 'female';
  ageGroup?: VoiceAgeGroup;
  personality?: VoicePersonality;
  instruction?: string;
  voiceStyle?: string;
  sampleSignature?: string;
  acousticPitchHz?: number;
  acousticSpeedFactor?: number;
  acousticWarmthDb?: number;
  acousticClarityDb?: number;
}): CompactVoiceProfile {
  const inferred = inferAgeAndPersonalityFromStyle(
    input.gender,
    input.instruction,
    input.voiceStyle,
    input.acousticPitchHz
  );
  const ageGroup = input.ageGroup || inferred.ageGroup;
  const personality = input.personality || inferred.personality;
  const voiceId = input.id || generateVoiceProfileId(input.name, input.sampleSignature);
  const fingerprintHash = hashVoiceSeed(
    `${voiceId}|${input.name}|${input.gender}|${ageGroup}|${personality}|${input.instruction || ''}`
  );

  const promptParams = parseAiVoiceInstruction(input.instruction || '', {
    gender: input.gender,
    ageGroup,
    personality,
    acousticPitchHz: input.acousticPitchHz,
    acousticSpeedFactor: input.acousticSpeedFactor,
    acousticWarmthDb: input.acousticWarmthDb,
    acousticClarityDb: input.acousticClarityDb,
    voiceStyle: input.voiceStyle,
    name: input.name,
  });

  // Add subtle deterministic timbre offset per unique voiceId so two different custom voices never sound identical
  const microPitch = ((fingerprintHash % 9) - 4) * 0.015;
  const microRate = (((fingerprintHash >> 4) % 7) - 3) * 0.012;
  promptParams.pitch = Number(clamp(promptParams.pitch + microPitch, 0.68, 1.4).toFixed(2));
  promptParams.speed = Number(clamp(promptParams.speed + microRate, 0.74, 1.32).toFixed(2));

  return {
    voiceId,
    gender: input.gender,
    ageGroup,
    personality,
    acousticPitchHz: input.acousticPitchHz || (input.gender === 'male' ? 130 : 210),
    acousticSpeedFactor: input.acousticSpeedFactor || 1.0,
    acousticWarmthDb: promptParams.warmthDb,
    acousticClarityDb: promptParams.clarityDb,
    fingerprintHash,
    promptParams,
  };
}
