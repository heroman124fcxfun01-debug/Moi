import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_COLOR_PALETTES,
  APP_WALLPAPER_PRESETS,
  resolveActiveWallpaperUrl,
  resolveAppThemeVars,
  shouldRenderAppWallpaper,
} from './appAppearance';

test('APP_COLOR_PALETTES provides 7 distinct color themes and resolves custom hex safely', () => {
  assert.equal(APP_COLOR_PALETTES.length, 7);
  const ocean = resolveAppThemeVars('ocean');
  assert.equal(ocean.accentLight, '#0369A1');
  assert.equal(ocean.isCustomOrAlternate, true);

  const custom = resolveAppThemeVars('custom', '#7C3AED');
  assert.equal(custom.accentLight.toLowerCase(), '#7c3aed');
  assert.equal(custom.accentRgb, '124, 58, 237');
  assert.equal(custom.isCustomOrAlternate, true);

  const defaultAmber = resolveAppThemeVars('amber');
  assert.equal(defaultAmber.isCustomOrAlternate, false);
});

test('shouldRenderAppWallpaper ALWAYS hides wallpaper during reading mode and shows on other tabs', () => {
  const inkPresets = APP_WALLPAPER_PRESETS.filter((p) => p.id.startsWith('ink-'));
  assert.equal(inkPresets.length, 4);
  for (const preset of inkPresets) {
    assert.ok(preset.dataUrl && preset.dataUrl.startsWith('/wallpapers/ink-'));
    assert.equal(resolveActiveWallpaperUrl(preset.id, null), preset.dataUrl);
    assert.equal(shouldRenderAppWallpaper('reader', preset.dataUrl), false);
    assert.equal(shouldRenderAppWallpaper('library', preset.dataUrl), true);
  }

  const sampleUrl = resolveActiveWallpaperUrl('misty-pine', null);
  assert.ok(sampleUrl && sampleUrl.startsWith('data:image/svg+xml'));

  // Reader tab MUST NEVER render the app wallpaper
  assert.equal(shouldRenderAppWallpaper('reader', sampleUrl), false);
  assert.equal(shouldRenderAppWallpaper('reader', 'data:image/jpeg;base64,abc'), false);

  // Non-reader tabs render the wallpaper when configured
  assert.equal(shouldRenderAppWallpaper('library', sampleUrl), true);
  assert.equal(shouldRenderAppWallpaper('settings', sampleUrl), true);
  assert.equal(shouldRenderAppWallpaper('studio', sampleUrl), true);
  assert.equal(shouldRenderAppWallpaper('web', sampleUrl), true);

  // Empty wallpaper never renders
  assert.equal(shouldRenderAppWallpaper('library', null), false);
  assert.equal(resolveActiveWallpaperUrl('none', 'data:image/jpeg;base64,abc'), null);
  assert.equal(
    resolveActiveWallpaperUrl('custom', 'data:image/jpeg;base64,abc'),
    'data:image/jpeg;base64,abc'
  );
});
