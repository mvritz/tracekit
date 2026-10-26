import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { cpus, platform, arch } from 'node:os';
import { syntheticBatch } from './synthetic.js';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const results: Record<string, unknown> = {};
try {
  for (const count of [100, 1000, 10000]) {
    const batch = syntheticBatch(count);
    for (let i = 0; i < count; i += 100) {
      const r = await fetch('http://127.0.0.1:4319/v1/ingest/spans', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...batch, spans: batch.spans.slice(i, i + 100) }),
      });
      if (!r.ok) throw new Error('Start the collector before benchmarking');
      await r.json();
    }
    const samples: number[] = [];
    for (let n = 0; n < 4; n++) {
      await page.goto('about:blank');
      const start = performance.now();
      await page.goto(`http://127.0.0.1:3000/#trace=${batch.run.trace_id}`);
      await page.waitForFunction(
        (expected) =>
          document.querySelector('.span-list')?.getAttribute('data-total-spans') ===
            String(expected) && document.querySelectorAll('.span-row').length > 0,
        count,
        { timeout: 60000 },
      );
      await page.evaluate(() => new Promise(requestAnimationFrame));
      if (n > 0) samples.push(performance.now() - start);
    }
    const sorted = [...samples].sort((a, b) => a - b);
    results[String(count)] = {
      median_ms: sorted[1],
      p95_ms: sorted[2],
      samples_ms: samples,
      rendered_rows: await page.locator('.span-row').count(),
    };
  }
  const data = {
    recorded_at: new Date().toISOString(),
    browser: browser.version(),
    viewport: '1440x1000',
    machine: { cpu: cpus()[0]?.model, platform: platform(), arch: arch() },
    baseline_revision: 'ca806aa3f99dacae781ed80349adf3f9bdacf469',
    baseline_file: 'dashboard-before-results.json',
    methodology:
      'Vite development server; browser navigation through full trace data fetch, tree construction, visible-row DOM render; fresh documents with warm browser asset cache, one warmup then three measured navigations per trace size; 50px windowed rows, 500px viewport and 4-row overscan; collector on same machine; baseline file uses identical data and navigation method but renders every row',
    results,
  };
  await writeFile('docs/dashboard-benchmark-results.json', JSON.stringify(data, null, 2) + '\n');
  console.log(JSON.stringify(data, null, 2));
} finally {
  await browser.close();
}
