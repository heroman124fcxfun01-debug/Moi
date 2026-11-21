export type SleepTimerResolvedMode = 'chapter' | 'countdown';

export interface SleepTimerConfig {
  mode: SleepTimerResolvedMode;
  hours: number;
  minutes: number;
  totalSeconds: number;
}

/**
 * Sanitizes a raw hours input string into a clean non-negative integer string (max 23h)
 * or empty string when cleared. Rejects negative numbers and non-digit characters.
 */
export function sanitizeSleepHoursInput(raw: string): string {
  const digits = String(raw || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  const parsed = Math.min(23, Math.max(0, parseInt(digits, 10)));
  return Number.isFinite(parsed) ? String(parsed) : '';
}

/**
 * Sanitizes a raw minutes input string into a clean integer strictly clamped to 0–59
 * or empty string when cleared. Rejects negative numbers and values > 59.
 */
export function sanitizeSleepMinutesInput(raw: string): string {
  const digits = String(raw || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  const parsed = Math.min(59, Math.max(0, parseInt(digits, 10)));
  return Number.isFinite(parsed) ? String(parsed) : '';
}

/**
 * Resolves the Sleep Timer mode from hours & minutes inputs:
 * - Both empty or 0 -> automatic 'chapter' mode (stop smoothly at end of current chapter).
 * - Any positive duration -> 'countdown' mode with exact totalSeconds = hours*3600 + minutes*60.
 */
export function resolveSleepTimerConfig(
  hoursInput: string,
  minutesInput: string
): SleepTimerConfig {
  const hSan = sanitizeSleepHoursInput(hoursInput);
  const mSan = sanitizeSleepMinutesInput(minutesInput);
  const hours = hSan ? parseInt(hSan, 10) : 0;
  const minutes = mSan ? parseInt(mSan, 10) : 0;
  const totalSeconds = hours * 3600 + minutes * 60;

  if (totalSeconds <= 0) {
    return {
      mode: 'chapter',
      hours: 0,
      minutes: 0,
      totalSeconds: 0,
    };
  }

  return {
    mode: 'countdown',
    hours,
    minutes,
    totalSeconds,
  };
}

/**
 * Formats remaining countdown seconds concisely as HH:MM:SS (when >= 1h) or MM:SS.
 */
export function formatSleepCountdown(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(clamped / 3600);
  const mins = Math.floor((clamped % 3600) / 60);
  const secs = clamped % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
