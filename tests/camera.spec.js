import { test, expect } from '@playwright/test';
import { defaultState, STORE_KEY } from '../js/store.js';

// Chromium's fake camera produces a test pattern (no face), so this proves
// the on-device pipeline loads and runs — camera permission, MediaPipe wasm
// and model, frame analysis — and reports "no face" rather than inventing
// reps. Counting real head movements needs a real device.
test.use({
  permissions: ['camera'],
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
  },
});

test('camera rep counter is opt-in, loads on-device and says when it cannot see a face', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const state = defaultState();
  Object.assign(state.settings, { voiceOn: false, guidedCounting: false, sounds: false });
  await page.addInitScript(([key, value]) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem(key, value);
      sessionStorage.setItem('seeded', '1');
    }
  }, [STORE_KEY, JSON.stringify(state)]);
  await page.goto('/index.html#/home');
  await page.getByRole('button', { name: '▶ Start My Exercises' }).click();
  await page.getByRole('button', { name: '▶ Start' }).click();
  await page.getByRole('button', { name: "I'm ready" }).click();
  // Off by default: no camera button until enabled in Settings.
  await expect(page.getByRole('button', { name: '📷 Count with camera (beta)' })).toHaveCount(0);
  await page.evaluate(([key]) => {
    const s = JSON.parse(localStorage.getItem(key));
    s.settings.cameraBeta = true;
    localStorage.setItem(key, JSON.stringify(s));
  }, [STORE_KEY]);
  await page.reload();
  await page.getByRole('button', { name: '▶ Resume' }).click();
  await page.getByRole('button', { name: '📷 Count with camera (beta)' }).click();
  await expect(page.locator('#cam-status')).toHaveText("I can't see your face. Prop the phone up facing you.", { timeout: 60000 });
  expect(await page.locator('.cam-video').evaluate((v) => v.videoWidth > 0)).toBe(true);
  expect(await page.locator('.counter .big').textContent()).toBe('1');
  await page.getByRole('button', { name: 'Turn camera off' }).click();
  await expect(page.locator('.cam-video')).toHaveCount(0);
  expect(errors).toEqual([]);
});
