import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
let recorded = '';
let failed = '';
test.beforeAll(() => {
  const output = execFileSync('pnpm', ['smoke'], { encoding: 'utf8' });
  const line = output.trim().split('\n').at(-1)!;
  const result = JSON.parse(line) as { recorded: string; failedTrace: string };
  recorded = result.recorded;
  failed = result.failedTrace;
});
test('real API traces appear and filters work', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Trace explorer.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'research-agent' }).first()).toBeVisible();
  await page.getByRole('combobox', { name: 'Status filter' }).selectOption('error');
  await expect(page.locator('.trace-table tbody tr').first().locator('.status')).toHaveText(
    'Error',
  );
  await page.getByRole('combobox', { name: 'Status filter' }).selectOption('');
  await page.getByRole('textbox', { name: 'Search traces' }).fill('definitely-no-matching-trace');
  await expect(page.getByRole('heading', { name: 'No matching traces' })).toBeVisible();
});
test('waterfall, keyboard selection, payload absence and safe export', async ({ page }) => {
  await page.goto(`/#trace=${recorded}`);
  await expect(page.getByRole('heading', { name: 'Execution waterfall' })).toBeVisible();
  const root = page.getByRole('button', { name: 'research-agent', exact: true });
  await root.focus();
  await root.press('ArrowDown');
  await expect(page.getByRole('heading', { name: 'plan-query', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'search-documents', exact: true }).click();
  await page.getByRole('tab', { name: 'Input', exact: true }).click();
  await expect(page.locator('.json')).toContainText('How should an agent');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export fixture' }).click();
  expect((await download).suggestedFilename()).toMatch(/^tracekit-.*\.json$/);
});
test('failure inspector identifies the actual validation error', async ({ page }) => {
  await page.goto(`/#trace=${failed}`);
  await page.getByRole('button', { name: 'validate-citations Error', exact: true }).click();
  await page.getByRole('tab', { name: 'Error', exact: true }).click();
  await expect(page.locator('.json')).toContainText(
    'Answer must cite at least one retrieved source',
  );
  await page.getByRole('button', { name: 'Collapse research-agent' }).click();
  await expect(
    page.getByRole('button', { name: 'research-agent Error', exact: true }),
  ).toBeVisible();
});
test('comparison shows linked runs and timing caveat', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Replay comparison', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Replay comparison.' })).toBeVisible();
  await page.getByLabel('Original run').selectOption(recorded);
  await expect(page.locator('.comparison-table')).toBeVisible();
  await expect(page.getByText('Timing changes do not measure', { exact: false })).toBeVisible();
  await expect(
    page.locator('.comparison-table td').filter({ hasText: 'Matched' }).first(),
  ).toBeVisible();
});
test('renders untrusted names as text and retains data offline', async ({ page, request }) => {
  const batch = JSON.parse(readFileSync('packages/protocol/src/fixtures/valid-batch.json', 'utf8'));
  const trace = randomBytes(16).toString('hex'),
    run = randomUUID();
  batch.run.trace_id = trace;
  batch.run.run_id = run;
  batch.spans[0].trace_id = trace;
  batch.spans[0].run_id = run;
  batch.spans[0].name = '<img src=x onerror=alert(1)>';
  expect((await request.post('http://127.0.0.1:4319/v1/ingest/spans', { data: batch })).ok()).toBe(
    true,
  );
  await page.goto(`/#trace=${trace}`);
  await expect(
    page.getByRole('heading', { name: '<img src=x onerror=alert(1)>', exact: true }).first(),
  ).toBeVisible();
  expect(await page.locator('img').count()).toBe(0);
  await page.route('http://127.0.0.1:4319/**', (r) => r.abort());
  await expect(page.getByRole('alert')).toContainText('Collector unavailable', { timeout: 12000 });
  await expect(page.getByRole('heading', { name: 'Execution waterfall' })).toBeVisible();
});
test('desktop and mobile layouts stay within the viewport', async ({ page }) => {
  await page.goto(`/#trace=${failed}`);
  await expect(page.getByRole('heading', { name: 'Execution waterfall' })).toBeVisible();
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
});
test('core screens have no automated WCAG A/AA violations', async ({ page }) => {
  const { AxeBuilder } = await import('@axe-core/playwright');
  for (const path of ['/', `/#trace=${failed}`]) {
    await page.goto(path);
    await expect(page.locator('h1').first()).toBeVisible();
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(result.violations).toEqual([]);
  }
});
test('overview chart, mode controls and mobile header remain usable', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Chart metric' }).selectOption('spans');
  await expect(page.getByRole('heading', { name: 'Spans per run', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Replays', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Mode filter' })).toHaveValue('replay');
  await expect(page.locator('.trace-table tbody tr').first().locator('.mode')).toHaveText('Replay');
  await page.getByRole('button', { name: 'All runs', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Mode filter' })).toHaveValue('');
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    // Resizing retains the focused control's scroll anchor; inspect each layout from its top.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.getByRole('link', { name: 'TraceKit home', exact: true })).toBeVisible();
    const header = await page.locator('.topbar').boundingBox();
    expect(header?.y).toBeGreaterThanOrEqual(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await page.locator('.chart-column').first().click();
  await expect(page.getByRole('heading', { name: 'Execution waterfall' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});
