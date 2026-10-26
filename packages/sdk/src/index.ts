import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import {
  assertSafeFixture,
  canonicalize,
  replayFixtureSchema,
  spanSchema,
  type ReplayCall,
  type ReplayFixture,
  type RunMetadata,
  type SpanEnvelope,
  type SpanKind,
} from '@tracekit/protocol';
import { createSanitizer, type Redaction } from './sanitizer.js';
import { Transport, type Batching } from './transport.js';
export { createSanitizer } from './sanitizer.js';
export type { ReplayFixture, SpanEnvelope } from '@tracekit/protocol';
export type TraceOptions = {
  attributes?: Record<string, string | number | boolean | null>;
  captureInput?: boolean;
  captureOutput?: boolean;
};
export type SpanOptions = TraceOptions & { kind?: SpanKind };
export type TraceKitOptions = {
  endpoint?: string;
  serviceName: string;
  capture?: { inputs?: boolean; outputs?: boolean; errors?: boolean };
  redaction?: Redaction;
  batching?: Batching;
  replay?: { mode: 'record' | 'replay'; fixture?: ReplayFixture; capture?: boolean };
};
export class ReplayMismatchError extends Error {
  constructor(message = 'Tool boundary does not match the recorded sequence') {
    super(message);
    this.name = 'ReplayMismatchError';
  }
}
export class RecordedToolError extends Error {
  constructor(
    readonly recordedType: string,
    message: string,
  ) {
    super(message);
    this.name = 'RecordedToolError';
  }
}
export async function loadReplayFixture(path: string): Promise<ReplayFixture> {
  const file = await readFile(path);
  if (file.length > 786432) throw new Error('Fixture exceeds 768 KiB');
  try {
    return assertSafeFixture(replayFixtureSchema.parse(JSON.parse(file.toString())));
  } catch {
    throw new Error('Invalid or unsupported replay fixture (expected finalized version 1)');
  }
}
export async function saveReplayFixture(path: string, fixture: ReplayFixture) {
  const validated = assertSafeFixture(replayFixtureSchema.parse(fixture));
  await writeFile(path, JSON.stringify(validated, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
}
type Run = {
  metadata: RunMetadata;
  calls: ReplayCall[];
  sequence: number;
  activeTools: number;
  incomplete: boolean;
  mismatch: boolean;
  fixture?: ReplayFixture;
};
type Context = { run: Run; spanId: string };
export function createTraceKit(options: TraceKitOptions) {
  if (
    !options.serviceName ||
    options.serviceName.length > 100 ||
    [...options.serviceName].some(
      (c) => c.charCodeAt(0) <= 31 || (c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159),
    )
  )
    throw new Error('serviceName must be 1–100 printable characters');
  const endpoint = options.endpoint ?? 'http://127.0.0.1:4319';
  const url = new URL(endpoint);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Invalid collector endpoint');
  const sanitize = createSanitizer(options.redaction);
  const storage = new AsyncLocalStorage<Context>();
  const fixture =
    options.replay?.mode === 'replay'
      ? assertSafeFixture(replayFixtureSchema.parse(options.replay.fixture))
      : undefined;
  if (fixture && fixture.service_name !== options.serviceName)
    throw new ReplayMismatchError('Fixture service does not match client service');
  const transport = new Transport(endpoint.replace(/\/$/, ''), options.batching);
  let lastFixture: ReplayFixture | undefined;
  const hash = (v: unknown) =>
    'sha256:' +
    createHash('sha256')
      .update(canonicalize(sanitize.serialize(v, true)))
      .digest('hex');
  const safeError = (error: unknown) => {
    const e = error instanceof Error ? error : new Error('Non-Error value thrown');
    return {
      type:
        sanitize
          .scrub(e.name)
          .split('')
          .map((c) =>
            c.charCodeAt(0) <= 31 || (c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159) ? ' ' : c,
          )
          .join('')
          .slice(0, 200) || 'Error',
      message: sanitize.scrub(e.message).slice(0, 4096),
    };
  };
  async function execute<T>(
    name: string,
    callback: () => Promise<T> | T,
    spanOptions: SpanOptions = {},
    input?: unknown,
    hasInput = false,
    root = false,
  ): Promise<T> {
    let parent = root ? undefined : storage.getStore();
    if (!parent) {
      const metadata: RunMetadata = {
        run_id: randomUUID(),
        trace_id: randomBytes(16).toString('hex'),
        service_name: options.serviceName,
        mode: fixture ? 'replay' : 'record',
        replay_of_run_id: fixture?.source_run_id ?? null,
      };
      parent = {
        run: {
          metadata,
          calls: [],
          sequence: 0,
          activeTools: 0,
          incomplete: false,
          mismatch: false,
          fixture,
        },
        spanId: '',
      };
      root = true;
    }
    const run = parent.run;
    const spanId = randomBytes(8).toString('hex');
    const started = Date.now(),
      mono = process.hrtime.bigint();
    let result: T | undefined;
    let failure: unknown;
    let failed = false;
    let payload: SpanEnvelope['payload'] = null;
    try {
      if (hasInput && (spanOptions.captureInput ?? options.capture?.inputs)) {
        const p = sanitize.preview(input);
        payload = {
          input: p.value,
          input_truncated: p.truncated,
          input_state: input === undefined ? 'undefined' : 'value',
        };
      }
    } catch {
      transport.stats.dropped++;
    }
    try {
      result = await storage.run({ run, spanId }, callback);
      if (root && run.fixture && (run.mismatch || run.sequence !== run.fixture.calls.length))
        throw new ReplayMismatchError('Replay completed with missing or mismatched tool calls');
      return result;
    } catch (error) {
      failed = true;
      failure =
        root && run.fixture && (run.mismatch || run.sequence !== run.fixture.calls.length)
          ? new ReplayMismatchError('Replay stopped with missing or mismatched tool calls')
          : error;
      throw failure;
    } finally {
      try {
        if (!failed && (spanOptions.captureOutput ?? options.capture?.outputs)) {
          const p = sanitize.preview(result);
          payload = {
            ...payload,
            output: p.value,
            output_truncated: p.truncated,
            output_state: result === undefined ? 'undefined' : 'value',
          };
        }
        const rawAttrs = sanitize.serialize(spanOptions.attributes ?? {});
        const attrs =
          rawAttrs && !Array.isArray(rawAttrs) && typeof rawAttrs === 'object' ? rawAttrs : {};
        const span: SpanEnvelope = spanSchema.parse({
          schema_version: 1,
          trace_id: run.metadata.trace_id,
          run_id: run.metadata.run_id,
          service_name: run.metadata.service_name,
          span_id: spanId,
          parent_span_id: parent.spanId || null,
          name: sanitize.scrub(name),
          kind: spanOptions.kind ?? (root ? 'agent' : 'internal'),
          status: failed ? 'error' : 'ok',
          start_time_unix_ms: started,
          end_time_unix_ms: Math.max(started, Date.now()),
          duration_ns: Math.min(Number.MAX_SAFE_INTEGER, Number(process.hrtime.bigint() - mono)),
          attributes: attrs,
          events: failed ? [{ name: 'exception', time_unix_ms: Date.now(), attributes: {} }] : [],
          payload,
          error: failed
            ? options.capture?.errors
              ? safeError(failure)
              : { type: 'Error', message: 'Error details not captured' }
            : null,
        });
        transport.enqueue(span, run.metadata);
      } catch {
        transport.stats.dropped++;
      }
      if (root && options.replay?.capture && !fixture) {
        lastFixture = undefined;
        if (!run.incomplete && run.activeTools === 0) {
          try {
            const f = replayFixtureSchema.parse({
              fixture_version: 1,
              source_run_id: run.metadata.run_id,
              source_trace_id: run.metadata.trace_id,
              service_name: options.serviceName,
              created_at_unix_ms: Date.now(),
              capture_policy: 'explicit-opt-in-sanitized',
              finalized: true,
              calls: run.calls,
            });
            lastFixture = f;
            transport.fixture(f);
          } catch {
            transport.stats.replayCaptureFailures++;
          }
        } else transport.stats.replayCaptureFailures++;
      }
    }
  }
  async function recordTool<I, O>(
    name: string,
    handler: (input: I) => Promise<O> | O,
    input: I,
    toolOptions: TraceOptions = {},
  ): Promise<O> {
    if (!storage.getStore())
      return execute(name, () => recordTool(name, handler, input, toolOptions), {
        kind: 'agent',
      });
    const run = storage.getStore()!.run;
    const sequence = run.sequence++;
    if (sequence >= 1000) run.incomplete = true;
    const key = `${name}#${sequence}`;
    if (run.activeTools > 0 && options.replay?.capture) run.incomplete = true;
    run.activeTools++;
    return execute(
      name,
      async () => {
        try {
          if (run.fixture) {
            let inputHash: string;
            try {
              inputHash = hash(input);
            } catch {
              run.mismatch = true;
              throw new ReplayMismatchError('Replay input cannot be represented safely');
            }
            const call = run.fixture.calls[sequence];
            if (
              !call ||
              call.boundary_name !== name ||
              call.boundary_key !== key ||
              call.input_hash !== inputHash
            ) {
              run.mismatch = true;
              throw new ReplayMismatchError();
            }
            if (call.outcome.type === 'throw')
              throw new RecordedToolError(call.outcome.error.type, call.outcome.error.message);
            return structuredClone(call.outcome.value) as O;
          }
          let inputHash: string | undefined;
          if (options.replay?.capture && sequence < 1000)
            try {
              inputHash = hash(input);
            } catch {
              run.incomplete = true;
            }
          try {
            const value = await handler(input);
            if (options.replay?.capture && inputHash)
              try {
                run.calls[sequence] = {
                  sequence,
                  boundary_name: name,
                  boundary_key: key,
                  input_hash: inputHash,
                  outcome: { type: 'return', value: sanitize.serialize(value, true) },
                };
              } catch {
                run.incomplete = true;
              }
            return value;
          } catch (error) {
            if (options.replay?.capture && inputHash)
              try {
                run.calls[sequence] = {
                  sequence,
                  boundary_name: name,
                  boundary_key: key,
                  input_hash: inputHash,
                  outcome: { type: 'throw', error: safeError(error) },
                };
              } catch {
                run.incomplete = true;
              }
            throw error;
          }
        } finally {
          run.activeTools--;
        }
      },
      { ...toolOptions, kind: 'tool' },
      input,
      true,
    );
  }
  return {
    trace<T>(name: string, callback: () => Promise<T> | T, traceOptions: TraceOptions = {}) {
      return execute(name, callback, traceOptions, undefined, false, true);
    },
    span<T>(name: string, callback: () => Promise<T> | T, spanOptions: SpanOptions = {}) {
      return execute(name, callback, spanOptions);
    },
    recordTool,
    flush: () => transport.flush(),
    shutdown: () => transport.shutdown(),
    getDiagnostics: () => ({ ...transport.stats }),
    getReplayFixture(): ReplayFixture {
      if (!lastFixture)
        throw new Error(
          'No complete replay fixture available; enable replay.capture and await all JSON tool calls',
        );
      return structuredClone(lastFixture);
    },
  };
}
export type TraceKitClient = ReturnType<typeof createTraceKit>;
