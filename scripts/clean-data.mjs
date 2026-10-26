import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
if (!process.argv.includes('--yes')) {
  console.error(
    'Stop TraceKit, then run pnpm clean:data --yes to permanently delete this checkout’s .tracekit directory.',
  );
  process.exit(1);
}
try {
  const response = await fetch('http://127.0.0.1:4319/healthz', {
    signal: AbortSignal.timeout(500),
  });
  if (response.ok) {
    console.error('Stop the collector before deleting local data.');
    process.exit(1);
  }
} catch {
  /* Collector is stopped. */
}
const path = resolve('.tracekit');
await rm(path, { recursive: true, force: false });
console.log(`Deleted ${path}`);
