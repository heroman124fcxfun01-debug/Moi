import test from 'node:test';
import assert from 'node:assert/strict';
import { RamLruCache } from './ramCache';

test('RamLruCache stores, promotes recently used items, and evicts oldest beyond capacity', () => {
  const cache = new RamLruCache<number>(8);
  for (let i = 1; i <= 8; i += 1) {
    cache.set(`k${i}`, i);
  }
  // Touch k1 so k2 becomes the oldest entry
  assert.equal(cache.get('k1'), 1);
  cache.set('k9', 9);

  assert.equal(cache.size, 8);
  assert.equal(cache.has('k1'), true);
  assert.equal(cache.has('k2'), false);
  assert.equal(cache.get('k9'), 9);
});

test('RamLruCache supports prefix invalidation and background trimTo', () => {
  const cache = new RamLruCache<string>(16);
  cache.set('book:a:ch0', 'p0');
  cache.set('book:a:ch1', 'p1');
  cache.set('book:b:ch0', 'p2');
  cache.set('book:c:ch0', 'p3');

  const removed = cache.deleteByPrefix('book:a:');
  assert.equal(removed, 2);
  assert.equal(cache.has('book:a:ch0'), false);
  assert.equal(cache.has('book:b:ch0'), true);

  cache.trimTo(1);
  assert.equal(cache.size, 1);
  assert.equal(cache.get('book:c:ch0'), 'p3');
});
