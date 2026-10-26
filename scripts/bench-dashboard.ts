import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
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
        (expected) => document.querySelectorAll('.span-row').length === expected,
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
    methodology:
      'Vite development server; browser navigation through data fetch and full DOM render; fresh documents with warm browser asset cache, one warmup then three measured navigations per trace size; no virtualization; collector on same machine as SDK benchmark',
    results,
  };
  await writeFile('docs/dashboard-benchmark-results.json', JSON.stringify(data, null, 2) + '\n');
  console.log(JSON.stringify(data, null, 2));
} finally {
  await browser.close();
}
