import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createTraceKit } from '@tracekit/sdk';
import { replayFixtureSchema, type TracePage, type SpanEnvelope } from '@tracekit/protocol';
import { research } from '../examples/research-agent/src/workflow.js';
const endpoint = process.env.TRACEKIT_ENDPOINT ?? 'http://127.0.0.1:4319';
const recorded = createTraceKit({
  endpoint,
  serviceName: 'research-demo',
  replay: { mode: 'record', capture: true },
  capture: { inputs: true, outputs: true, errors: true },
});
let live = 0;
await research(recorded, { onLiveCall: () => live++ });
assert.equal(live, 2);
const fixture = recorded.getReplayFixture();
await recorded.shutdown();
assert.equal(recorded.getDiagnostics().dropped, 0);
assert.equal(recorded.getDiagnostics().fixturesDelivered, 1);
const exported = replayFixtureSchema.parse(
  await fetch(`${endpoint}/v1/runs/${fixture.source_run_id}/replay-fixture`).then((r) => r.json()),
);
assert.deepEqual(exported, fixture);
const replay = createTraceKit({
  endpoint,
  serviceName: 'research-demo',
  replay: { mode: 'replay', fixture: exported },
  capture: { errors: true },
});
live = 0;
await research(replay, { liveDisabled: true, onLiveCall: () => live++ });
await replay.shutdown();
assert.equal(live, 0);
const failed = createTraceKit({
  endpoint,
  serviceName: 'research-demo',
  replay: { mode: 'record', capture: true },
  capture: { inputs: true, outputs: true, errors: true },
});
await assert.rejects(research(failed, { fail: true }), /cite at least one/);
await failed.shutdown();
const page = (await fetch(`${endpoint}/v1/traces?service_name=research-demo&limit=100`).then((r) =>
  r.json(),
)) as TracePage;
assert(page.items.some((x) => x.mode === 'replay' && x.replay_of_run_id === fixture.source_run_id));
assert(page.items.some((x) => x.status === 'error'));
const spans = (await fetch(`${endpoint}/v1/traces/${fixture.source_trace_id}/spans`).then((r) =>
  r.json(),
)) as { items: SpanEnvelope[] };
assert.equal(spans.items.length, 8);
assert(spans.items.some((s) => s.name === 'validate-citations'));
const load = createTraceKit({ endpoint, serviceName: 'throughput-regression' });
await load.trace('sdk-throughput', () =>
  Promise.all(Array.from({ length: 1000 }, (_, i) => load.span(`operation-${i}`, () => i))),
);
await load.shutdown();
assert.equal(load.getDiagnostics().dropped, 0);
assert.equal(load.getDiagnostics().delivered, 1001);
const marker = `tracekit-sensitive-${randomUUID()}`;
const requests: string[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
  if (typeof args[1]?.body === 'string') requests.push(args[1].body);
  return originalFetch(...args);
};
const privacy = createTraceKit({
  endpoint,
  serviceName: 'privacy-regression',
  capture: { inputs: true, outputs: true, errors: true },
  redaction: { keys: ['email'], patterns: [new RegExp(marker, 'g')] },
  replay: { mode: 'record', capture: true },
});
try {
  await privacy.trace('privacy-check', async () => {
    const input = {
      token: marker,
      email: marker + '@example.invalid',
      nested: { accessToken: marker },
    };
    const value = await privacy.recordTool('safe-values', (v) => v, input);
    assert.equal(value.token, marker);
    await privacy
      .recordTool(
        'safe-error',
        () => {
          throw new Error('Bearer ' + marker);
        },
        {},
      )
      .catch(() => {});
  });
  await privacy.shutdown();
} finally {
  globalThis.fetch = originalFetch;
}
assert.equal(privacy.getDiagnostics().dropped, 0);
assert.equal(privacy.getDiagnostics().fixturesDelivered, 1);
assert(!requests.join('').includes(marker));
const privacyFixture = privacy.getReplayFixture();
const privacyExport = await originalFetch(
  `${endpoint}/v1/runs/${privacyFixture.source_run_id}/replay-fixture`,
).then((r) => r.text());
assert(!privacyExport.includes(marker));
const db = process.env.TRACEKIT_DB_PATH ?? '.tracekit/tracekit.db';
for (const file of [db, db + '-wal']) {
  try {
    assert(
      !(await readFile(file)).includes(Buffer.from(marker)),
      'Sensitive marker reached SQLite',
    );
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
}
console.log(
  JSON.stringify({
    status: 'passed',
    recorded: fixture.source_trace_id,
    spans: spans.items.length,
    replayLiveCalls: live,
    privacyCheck: 'passed',
    failedTrace: failed.getReplayFixture().source_trace_id,
  }),
);
