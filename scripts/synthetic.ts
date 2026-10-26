import { randomBytes, randomUUID } from 'node:crypto';
import type { SpanBatch, SpanEnvelope } from '@tracekit/protocol';
export function syntheticBatch(count: number): SpanBatch {
  const trace = randomBytes(16).toString('hex'),
    run = randomUUID(),
    root = randomBytes(8).toString('hex'),
    start = Date.now();
  const spans: SpanEnvelope[] = Array.from({ length: count }, (_, i) => ({
    schema_version: 1,
    trace_id: trace,
    span_id: i === 0 ? root : randomBytes(8).toString('hex'),
    parent_span_id: i === 0 ? null : root,
    run_id: run,
    name: i === 0 ? `synthetic-benchmark-${count}` : `operation-${i}`,
    kind: i === 0 ? 'agent' : 'internal',
    status: 'ok',
    start_time_unix_ms: start,
    end_time_unix_ms: start + 1,
    duration_ns: 1000000,
    service_name: 'synthetic-benchmark',
    attributes: {},
    events: [],
    payload: null,
    error: null,
  }));
  return {
    schema_version: 1,
    source: { sdk: 'tracekit-node', version: '0.1.0' },
    run: {
      run_id: run,
      trace_id: trace,
      service_name: 'synthetic-benchmark',
      mode: 'record',
      replay_of_run_id: null,
    },
    spans,
  };
}
