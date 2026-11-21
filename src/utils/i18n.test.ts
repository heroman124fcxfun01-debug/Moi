import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getAppStrings } from './i18n.ts';

describe('i18n', () => {
  it('returns complete strings for vi, en, and zh', () => {
    const vi = getAppStrings('vi');
    const en = getAppStrings('en');
    const zh = getAppStrings('zh');

    assert.equal(vi.navLibrary, 'Thư viện');
    assert.equal(en.navLibrary, 'Library');
    assert.equal(zh.navLibrary, '书库');
    assert.equal(vi.sleepTimer, 'Hẹn giờ tắt');
    assert.equal(en.sleepTimer, 'Sleep Timer');
    assert.equal(zh.sleepTimer, '定时关闭');
  });
});
