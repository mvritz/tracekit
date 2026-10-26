import { mkdir, writeFile } from 'node:fs/promises';
import { createTraceKit, loadReplayFixture } from '@tracekit/sdk';
import { research } from './workflow.js';
const mode = process.argv[2] ?? 'record';
if (!['record', 'replay', 'failure'].includes(mode))
  throw new Error('Use record, failure, or replay');
const failure = mode === 'failure' || process.env.DEMO_FAIL === '1';
const fixturePath =
  process.argv[3] ?? (failure ? '.tracekit/failure-fixture.json' : '.tracekit/demo-fixture.json');
const fixture = mode === 'replay' ? await loadReplayFixture(fixturePath) : undefined;
let liveCalls = 0;
const tk = createTraceKit({
  serviceName: 'research-demo',
  capture: { inputs: true, outputs: true, errors: true },
  replay: fixture ? { mode: 'replay', fixture } : { mode: 'record', capture: true },
});
try {
  const answer = await research(tk, {
    fail: failure,
    liveDisabled: mode === 'replay',
    onLiveCall: () => liveCalls++,
  });
  console.log(JSON.stringify({ status: 'ok', mode, liveCalls, answer }, null, 2));
} catch (error) {
  if (error instanceof Error && error.message === 'Answer must cite at least one retrieved source')
    console.log(
      JSON.stringify({ status: 'expected-demo-failure', mode, liveCalls, error: error.message }),
    );
  else throw error;
} finally {
  if (mode !== 'replay') {
    await mkdir('.tracekit', { recursive: true, mode: 0o700 });
    // Only synthetic demo fixtures are overwritten. User fixtures use saveReplayFixture's exclusive write.
    await writeFile(fixturePath, JSON.stringify(tk.getReplayFixture(), null, 2) + '\n', {
      mode: 0o600,
    });
    console.log(`Synthetic fixture: ${fixturePath}`);
  }
  await tk.shutdown();
  console.log(JSON.stringify({ diagnostics: tk.getDiagnostics() }));
  if (tk.getDiagnostics().dropped > 0)
    console.error(
      'Collector unavailable or telemetry rejected. Start bun run dev, then run the demo again.',
    );
}

if (mode === 'replay' && liveCalls !== 0) throw new Error('Replay invoked a live handler');
