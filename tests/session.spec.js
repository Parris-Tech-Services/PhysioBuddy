import { test, expect } from '@playwright/test';
import { defaultState, STORE_KEY } from '../js/store.js';

// 22 Oct 2026 4:25 pm Sydney (AEDT, UTC+11): day 1 of the acute programme.
const START = new Date('2026-10-22T05:25:00Z');
const APP = '/index.html#/home';

async function boot(page, settings = {}) {
  const state = defaultState();
  Object.assign(state.settings, { voiceOn: false, guidedCounting: false, sounds: false, ...settings });
  await page.clock.install({ time: START });
  await page.addInitScript(([key, value]) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem(key, value);
      sessionStorage.setItem('seeded', '1');
    }
  }, [STORE_KEY, JSON.stringify(state)]);
  await page.goto(APP);
}

const errors = [];
test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (e) => errors.push(e.message));
});
test.afterEach(() => expect(errors).toEqual([]));

async function counter(page) {
  return page.locator('.counter .big').textContent();
}

// Works through whatever the current screen asks for, one step at a time.
async function step(page) {
  for (const [name, after] of [["I'm ready", 0], ['Start 30-second hold', 31000], ['✓ Rep done', 0], ['✓ Done', 0], ['Next exercise →', 0]]) {
    const btn = page.getByRole('button', { name, exact: true });
    if (await btn.isVisible() && await btn.isEnabled()) {
      await btn.click();
      if (after) await page.clock.runFor(after);
      return name;
    }
  }
  return null;
}

test('a full October neck session: holds, reload mid-hold, pause, resume, completion and saved history', async ({ page }) => {
  await boot(page);
  await expect(page.getByRole('heading', { name: 'Acute neck recovery' })).toBeVisible();
  await page.getByRole('button', { name: '▶ Start My Exercises' }).click();
  await page.getByRole('button', { name: '5 out of 10' }).click();
  await page.getByRole('button', { name: '▶ Start' }).click();

  // Exercise 1: 10 reps each side, alternating, no hold.
  await expect(page.getByRole('heading', { name: 'Active neck rotation' })).toBeVisible();
  await expect(page.getByText('Turn only to about 4–5 out of 10 discomfort.').first()).toBeVisible();
  await page.getByRole('button', { name: "I'm ready" }).click();
  await expect(page.locator('.side-label')).toHaveText('Left side');
  await page.getByRole('button', { name: '✓ Rep done' }).click();
  await expect(page.locator('.side-label')).toHaveText('Right side');
  for (let i = 0; i < 19; i++) await page.getByRole('button', { name: '✓ Rep done' }).click();
  await page.getByRole('button', { name: 'Next exercise →' }).click();

  // Exercise 2: 30-second hold, 5 each side. Reload the page part-way through a hold.
  await expect(page.getByRole('heading', { name: 'Rotation hold' })).toBeVisible();
  await page.getByRole('button', { name: "I'm ready" }).click();
  await expect(page.getByRole('button', { name: '✓ Rep done' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start 30-second hold' }).click();
  await page.clock.runFor(12000);
  await expect(page.locator('#timer .num')).toHaveText('18');
  await page.reload();
  await expect(page.getByText('Paused.', { exact: true })).toBeVisible();
  await page.clock.runFor(60000);
  // The hold kept its remaining time while paused (the reload itself takes a
  // few real seconds, which correctly count towards the hold).
  const remaining = Number(await page.locator('#timer .num').textContent());
  expect(remaining).toBeGreaterThan(10);
  expect(remaining).toBeLessThanOrEqual(18);
  await page.getByRole('button', { name: '▶ Resume' }).click();
  await page.clock.runFor(remaining * 1000 + 500);
  await expect(page.locator('.side-label')).toHaveText('Right side');

  // Pause and resume via buttons.
  await page.getByRole('button', { name: '❚❚ Pause' }).click();
  await expect(page.getByRole('button', { name: 'Start 30-second hold' })).toBeDisabled();
  await page.getByRole('button', { name: '▶ Resume' }).click();

  for (let guard = 0; guard < 120; guard++) {
    if (await page.getByRole('heading', { name: 'Session complete' }).isVisible()) break;
    await step(page);
  }
  await expect(page.getByRole('heading', { name: 'Session complete' })).toBeVisible();
  await expect(page.getByText('5 completed, 0 partly done, 0 skipped.')).toBeVisible();
  await expect(page.getByText('50 movements counted · 330 seconds of holds.')).toBeVisible();
  await expect(page.getByText('🌱 New milestone: First session done')).toBeVisible();
  await page.getByRole('button', { name: '2 out of 10' }).click();
  await page.getByRole('button', { name: 'Back to Today' }).click();

  await expect(page.locator('.slot.done')).toHaveText('✓ 4:30 pm');
  await page.reload();
  await page.getByRole('link', { name: /Progress/ }).click();
  await expect(page.getByText('1 session', { exact: true })).toBeVisible();
  await expect(page.getByText(/100% complete · discomfort 5 → 2/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Milestones' })).toBeVisible();
});

test('“That hurts” pauses, records the symptom and can stop the session', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '▶ Start My Exercises' }).click();
  await page.getByRole('button', { name: '▶ Start' }).click();
  await page.getByRole('button', { name: "I'm ready" }).click();
  await page.getByRole('button', { name: 'That hurts' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Stop the session' }).click();
  await expect(page.getByRole('heading', { name: 'Session stopped' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to Today' }).click();
  await page.getByRole('link', { name: /Progress/ }).click();
  await expect(page.getByText('Reported: pain')).toBeVisible();
});

test('guided counting counts reps on its own and “done” never finishes an exercise without asking', async ({ page }) => {
  await boot(page, { guidedCounting: true, repSeconds: 4 });
  await page.getByRole('button', { name: '▶ Start My Exercises' }).click();
  await page.getByRole('button', { name: '▶ Start' }).click();
  await page.getByRole('button', { name: "I'm ready" }).click();
  await page.clock.runFor(4100);
  await expect(page.locator('.side-label')).toHaveText('Right side');
  await page.clock.runFor(4000);
  expect(await counter(page)).toBe('2');
  await page.getByRole('button', { name: 'Finish exercise' }).click();
  await expect(page.getByText('You have 18 left. Finish this exercise now?', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'No, keep going' }).click();
  await expect(page.getByRole('heading', { name: 'Active neck rotation' })).toBeVisible();
});

test('older prescriptions stay in the Library and the review prompt appears after day 4', async ({ page }) => {
  await boot(page);
  await page.getByRole('link', { name: /Library/ }).click();
  await expect(page.getByRole('link', { name: 'Neck and headache rehabilitation' })).toBeVisible();
  await page.getByRole('link', { name: 'Neck and headache rehabilitation' }).click();
  await expect(page.getByText('Stop and let John know if an exercise triggers a headache.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add to Today' })).toBeVisible();
  await page.clock.setSystemTime(new Date('2026-10-26T00:00:00Z'));
  await page.goto(APP);
  await expect(page.getByText('Time to review this programme with John.')).toBeVisible();
});

test('optional per-exercise ratings are saved and shown on Progress', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '▶ Start My Exercises' }).click();
  await page.getByRole('button', { name: '▶ Start' }).click();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Supported look up' })).toBeVisible();
  await page.getByRole('button', { name: "I'm ready" }).click();
  for (let i = 0; i < 10; i++) await page.getByRole('button', { name: '✓ Rep done' }).click();
  await expect(page.getByText('How did that feel?')).toBeVisible();
  await page.getByRole('button', { name: 'More than usual' }).click();
  await expect(page.getByText('If this triggered a headache or significant pain, stop and contact John.')).toBeVisible();
  await page.getByRole('button', { name: 'Hard' }).click();
  await expect(page.getByRole('button', { name: 'Hard' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Next exercise →' }).click();
  await page.getByRole('button', { name: "I'm ready" }).click();
  await page.getByRole('button', { name: '✓ Done' }).click();
  await page.getByRole('button', { name: 'Next exercise →' }).click();
  await page.getByRole('button', { name: 'Back to Today' }).click();
  await page.getByRole('link', { name: /Progress/ }).click();
  await expect(page.getByText('1× more discomfort than usual · 1× hard')).toBeVisible();
});

test('report for John includes questions, unclear items and copies to the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await boot(page);
  await page.getByRole('link', { name: /Progress/ }).click();
  await page.getByRole('link', { name: 'Report for John' }).click();
  await page.getByLabel('New question').fill('Can I keep going after day 4?');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const report = page.locator('#report-text');
  await expect(report).toContainText('Home exercise report for John Robins');
  await expect(report).toContainText('- Can I keep going after day 4?');
  await expect(report).toContainText('Mirror posture check (Acute neck recovery): No repetition count specified.');
  await page.getByRole('button', { name: 'Last 14 days' }).click();
  await expect(report).toContainText('Period: 9 Oct 2026 – 22 Oct 2026');
  await page.getByRole('button', { name: 'Copy' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Can I keep going after day 4?');
  await page.getByRole('button', { name: 'Answered' }).click();
  await expect(report).not.toContainText('Can I keep going after day 4?');
});

test('daily check-in is saved, summarised on Today and appears in the report', async ({ page }) => {
  await boot(page);
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Quick check-in' }) });
  await card.getByRole('button', { name: '6 out of 10' }).click();
  await card.getByRole('button', { name: 'Yes' }).click();
  await card.getByRole('button', { name: 'Poorly' }).click();
  await expect(page.getByText('✓ Checked in today: neck 6/10 · headache · slept poor')).toBeVisible();
  await page.reload();
  await expect(page.getByText('✓ Checked in today: neck 6/10 · headache · slept poor')).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('button', { name: '4 out of 10' }).click();
  await page.getByRole('link', { name: /Progress/ }).click();
  await expect(page.getByRole('img', { name: /Daily neck discomfort and headache days/ })).toBeVisible();
  await page.getByRole('link', { name: 'Report for John' }).click();
  await expect(page.locator('#report-text')).toContainText('- 1 check-in. Average neck discomfort 4/10 (first 4, latest 4)');
  await expect(page.locator('#report-text')).toContainText('- Headache days: 22 Oct 2026');
});

test('weekly activity check: set up, rate, see progress and report', async ({ page }) => {
  await boot(page);
  await page.getByRole('link', { name: /Progress/ }).click();
  await page.getByRole('link', { name: 'Set up activities' }).click();
  await page.getByLabel(/Add an activity/).fill('Checking traffic when driving');
  await page.getByRole('button', { name: 'Add activity' }).click();
  await page.getByRole('link', { name: /Today/ }).click();
  await expect(page.getByText('Your weekly activity check is due')).toBeVisible();
  await page.getByRole('link', { name: 'Rate now' }).click();
  await page.getByRole('group', { name: 'Checking traffic when driving, 0 to 10' }).getByRole('button', { name: '3 out of 10' }).click();
  await page.getByRole('button', { name: "Save today's ratings" }).click();
  await expect(page.getByRole('heading', { name: 'Everyday activities' })).toBeVisible();
  await expect(page.getByText('3/10', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: /Today/ }).click();
  await expect(page.getByText('Your weekly activity check is due')).toHaveCount(0);
  await page.getByRole('link', { name: /Progress/ }).click();
  await page.getByRole('link', { name: 'Report for John' }).click();
  await expect(page.locator('#report-text')).toContainText('- Checking traffic when driving: 3/10 on 22 Oct 2026');
});
