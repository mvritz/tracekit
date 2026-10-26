import { AsyncLocalStorage } from 'node:async_hooks';
import { cpus, totalmem, platform, arch, release } from 'node:os';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createTraceKit, createSanitizer } from '@tracekit/sdk';
import { syntheticBatch } from './synthetic.js';
const samples = 7;
function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)]!,
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!,
    samples: values,
  };
}
async function measure(operation: () => Promise<unknown> | unknown, iterations: number) {
  await operation();
  const values: number[] = [];
  for (let n = 0; n < samples; n++) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) await operation();
    values.push((performance.now() - start) / iterations);
  }
  return distribution(values);
}
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => new Response('{}', { status: 200 });
const tk = createTraceKit({
  serviceName: 'benchmark',
  batching: { maxQueueSize: 10000, maxBatchSize: 100 },
});
const sdk: Record<string, unknown> = {};
for (const concurrency of [1, 10, 100]) {
  sdk[`baseline_${concurrency}`] = await measure(async () => {
    await Promise.all(Array.from({ length: concurrency }, async () => 1));
  }, 100);
  sdk[`traced_${concurrency}`] = await measure(async () => {
    await Promise.all(Array.from({ length: concurrency }, () => tk.trace('noop', () => 1)));
  }, 100);
  await tk.flush();
}
const als = new AsyncLocalStorage<number>();
sdk.asyncLocalStorage = await measure(() => als.run(1, () => als.getStore()), 10000);
const sanitizer = createSanitizer();
for (const [label, size] of [
  ['small', 10],
  ['medium', 1000],
  ['large', 20000],
] as const) {
  sdk[`sanitize_${label}`] = await measure(() => {
    sanitizer.preview({ token: 'synthetic-secret', content: 'x'.repeat(size), items: [1, 2, 3] });
  }, 100);
}
await tk.shutdown();
globalThis.fetch = originalFetch;
const collector: Record<string, unknown> = {};
for (const batchSize of [1, 25, 100]) {
  const latencies: number[] = [];
  const throughput: number[] = [];
  for (let n = 0; n < 3; n++) {
    const data = syntheticBatch(1000),
      start = performance.now();
    for (let i = 0; i < data.spans.length; i += batchSize) {
      const t = performance.now();
      const response = await fetch('http://127.0.0.1:4319/v1/ingest/spans', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...data, spans: data.spans.slice(i, i + batchSize) }),
      });
      if (!response.ok) throw new Error('Collector must be running for benchmark');
      await response.json();
      latencies.push(performance.now() - t);
    }
    throughput.push(1000 / ((performance.now() - start) / 1000));
  }
  collector[`batch_${batchSize}`] = {
    request_latency_ms: distribution(latencies),
    spans_per_second: distribution(throughput),
  };
}
const result = {
  recorded_at: new Date().toISOString(),
  machine: {
    cpu: cpus()[0]?.model,
    cores: cpus().length,
    memory_gib: Math.round(totalmem() / 1024 ** 3),
    os: platform(),
    arch: arch(),
    release: release(),
    node: process.version,
    rust: execFileSync('rustc', ['--version'], { encoding: 'utf8' }).trim(),
  },
  methodology: {
    sdk_units: 'milliseconds per operation (a Promise.all group for concurrency cases)',
    warmup: 'one operation before each series',
    samples,
    collector_profile:
      'cargo run (debug), SQLite WAL, HTTP loopback; 3 x 1000 spans per batch size',
    transport:
      'SDK microbenchmarks use an in-process acknowledged fetch stub. Collector timings use real HTTP and SQLite.',
    caution:
      'Microbenchmark results vary with warmup, scheduling, tracing buffer pressure, and machine load. No production throughput guarantee.',
  },
  sdk,
  collector,
};
await writeFile('docs/benchmark-results.json', JSON.stringify(result, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      saved: 'docs/benchmark-results.json',
      sdk: Object.fromEntries(
        Object.entries(sdk).map(([k, v]) => [k, (v as { median: number }).median]),
      ),
      collector: Object.fromEntries(
        Object.entries(collector).map(([k, v]) => [
          k,
          (v as { spans_per_second: { median: number } }).spans_per_second.median,
        ]),
      ),
    },
    null,
    2,
  ),
);
