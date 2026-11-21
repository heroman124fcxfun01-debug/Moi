import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatSleepCountdown,
  resolveSleepTimerConfig,
  sanitizeSleepHoursInput,
  sanitizeSleepMinutesInput,
} from './sleepTimer';

test('sanitizeSleepMinutesInput strictly enforces non-negative integers clamped to 0-59', () => {
  assert.equal(sanitizeSleepMinutesInput(''), '');
  assert.equal(sanitizeSleepMinutesInput('0'), '0');
  assert.equal(sanitizeSleepMinutesInput('45'), '45');
  assert.equal(sanitizeSleepMinutesInput('59'), '59');
  assert.equal(sanitizeSleepMinutesInput('60'), '59');
  assert.equal(sanitizeSleepMinutesInput('999'), '59');
  assert.equal(sanitizeSleepMinutesInput('-15'), '15'); // strips minus sign
  assert.equal(sanitizeSleepMinutesInput('abc'), '');
});

test('sanitizeSleepHoursInput enforces non-negative integers clamped to 0-23', () => {
  assert.equal(sanitizeSleepHoursInput(''), '');
  assert.equal(sanitizeSleepHoursInput('2'), '2');
  assert.equal(sanitizeSleepHoursInput('25'), '23');
  assert.equal(sanitizeSleepHoursInput('-3'), '3');
});

test('resolveSleepTimerConfig defaults to end-of-chapter mode when both fields are empty or zero', () => {
  assert.deepEqual(resolveSleepTimerConfig('', ''), {
    mode: 'chapter',
    hours: 0,
    minutes: 0,
    totalSeconds: 0,
  });
  assert.deepEqual(resolveSleepTimerConfig('0', '0'), {
    mode: 'chapter',
    hours: 0,
    minutes: 0,
    totalSeconds: 0,
  });
});

test('resolveSleepTimerConfig converts valid hours & minutes into exact countdown seconds', () => {
  assert.deepEqual(resolveSleepTimerConfig('', '30'), {
    mode: 'countdown',
    hours: 0,
    minutes: 30,
    totalSeconds: 1800,
  });
  assert.deepEqual(resolveSleepTimerConfig('1', '15'), {
    mode: 'countdown',
    hours: 1,
    minutes: 15,
    totalSeconds: 4500,
  });
  // Clamps minutes > 59
  assert.deepEqual(resolveSleepTimerConfig('0', '85'), {
    mode: 'countdown',
    hours: 0,
    minutes: 59,
    totalSeconds: 3540,
  });
});

test('formatSleepCountdown formats MM:SS and HH:MM:SS accurately', () => {
  assert.equal(formatSleepCountdown(0), '00:00');
  assert.equal(formatSleepCountdown(65), '01:05');
  assert.equal(formatSleepCountdown(3661), '01:01:01');
});
