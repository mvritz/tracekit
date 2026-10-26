import { z } from 'zod';

export const MAX_DURATION_NS = Number.MAX_SAFE_INTEGER;
export const MAX_FIXTURE_BYTES = 786_432;
export const traceIdSchema = z
  .string()
  .regex(/^[a-f0-9]{32}$/)
  .refine((s) => !/^0+$/.test(s));
export const spanIdSchema = z
  .string()
  .regex(/^[a-f0-9]{16}$/)
  .refine((s) => !/^0+$/.test(s));
const limitedString = (max: number) => z.string().refine((s) => s.length <= max);
const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((s) => s.length <= max)
    .refine((s) =>
      [...s].every(
        (c) => c.charCodeAt(0) > 31 && !(c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159),
      ),
    );
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
function boundedJson(value: unknown, depth = 0): value is Json {
  if (depth > 8) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= 32768;
  if (Array.isArray(value))
    return value.length <= 1024 && value.every((v) => boundedJson(v, depth + 1));
  if (typeof value === 'object' && value) {
    const entries = Object.entries(value);
    return (
      entries.length <= 128 &&
      entries.every(([k, v]) => k.length <= 200 && boundedJson(v, depth + 1))
    );
  }
  return false;
}
export const jsonSchema = z.custom<Json>((v) => boundedJson(v));
export const attributesSchema = z
  .record(
    limitedString(200),
    z.union([limitedString(4096), z.number().finite(), z.boolean(), z.null()]),
  )
  .refine((v) => Object.keys(v).length <= 64);
export const errorSchema = z.object({ type: text(200), message: limitedString(4096) }).strict();
export const spanSchema = z
  .object({
    schema_version: z.literal(1),
    trace_id: traceIdSchema,
    span_id: spanIdSchema,
    parent_span_id: spanIdSchema.nullable(),
    run_id: z.uuid(),
    name: text(200),
    kind: z.enum(['agent', 'llm', 'tool', 'retrieval', 'internal']),
    status: z.enum(['ok', 'error', 'cancelled']),
    start_time_unix_ms: integer,
    end_time_unix_ms: integer,
    duration_ns: integer,
    service_name: text(100),
    attributes: attributesSchema,
    events: z
      .array(
        z.object({ name: text(200), time_unix_ms: integer, attributes: attributesSchema }).strict(),
      )
      .max(64),
    payload: z
      .object({
        input: jsonSchema.optional(),
        output: jsonSchema.optional(),
        input_truncated: z.boolean().optional(),
        output_truncated: z.boolean().optional(),
        redacted_paths: z.array(limitedString(512)).max(128).optional(),
      })
      .strict()
      .nullable(),
    error: errorSchema.nullable(),
  })
  .strict()
  .refine((s) => s.end_time_unix_ms >= s.start_time_unix_ms && s.parent_span_id !== s.span_id)
  .refine((s) => new TextEncoder().encode(JSON.stringify(s.payload)).length <= 32768);
export const runSchema = z
  .object({
    run_id: z.uuid(),
    trace_id: traceIdSchema,
    service_name: text(100),
    mode: z.enum(['record', 'replay']),
    replay_of_run_id: z.uuid().nullable(),
  })
  .strict()
  .refine(
    (r) =>
      (r.mode === 'replay') === (r.replay_of_run_id !== null) && r.run_id !== r.replay_of_run_id,
  );
export const batchSchema = z
  .object({
    schema_version: z.literal(1),
    source: z.object({ sdk: z.literal('tracekit-node'), version: z.literal('0.1.0') }).strict(),
    run: runSchema,
    spans: z.array(spanSchema).min(1).max(100),
  })
  .strict()
  .refine((b) =>
    b.spans.every(
      (s) =>
        s.run_id === b.run.run_id &&
        s.trace_id === b.run.trace_id &&
        s.service_name === b.run.service_name,
    ),
  );
export const replayCallSchema = z
  .object({
    sequence: integer,
    boundary_name: text(200),
    boundary_key: text(230),
    input_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    outcome: z.discriminatedUnion('type', [
      z.object({ type: z.literal('return'), value: jsonSchema }).strict(),
      z.object({ type: z.literal('throw'), error: errorSchema }).strict(),
    ]),
  })
  .strict();
export const replayFixtureSchema = z
  .object({
    fixture_version: z.literal(1),
    source_run_id: z.uuid(),
    source_trace_id: traceIdSchema,
    service_name: text(100),
    created_at_unix_ms: integer,
    capture_policy: z.literal('explicit-opt-in-sanitized'),
    finalized: z.literal(true),
    calls: z.array(replayCallSchema).max(1000),
  })
  .strict()
  .refine((f) =>
    f.calls.every((c, i) => c.sequence === i && c.boundary_key === `${c.boundary_name}#${i}`),
  )
  .refine((f) => new TextEncoder().encode(JSON.stringify(f)).length <= MAX_FIXTURE_BYTES);
export type SpanEnvelope = z.infer<typeof spanSchema>;
export type SpanKind = SpanEnvelope['kind'];
export type RunMetadata = z.infer<typeof runSchema>;
export type SpanBatch = z.infer<typeof batchSchema>;
export type ReplayCall = z.infer<typeof replayCallSchema>;
export type ReplayFixture = z.infer<typeof replayFixtureSchema>;
export type TraceSummary = RunMetadata & {
  name: string;
  status: SpanEnvelope['status'];
  start_time_unix_ms: number;
  end_time_unix_ms: number;
  duration_ns: number;
  span_count: number;
  error_count: number;
  complete: boolean;
};
export type TracePage = { items: TraceSummary[]; next_cursor: string | null };
export function canonicalize(value: Json): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalize(value[k]!)}`)
    .join(',')}}`;
}

/** Reject obvious unsafe imports; configured PII patterns remain the producer's responsibility. */
export function assertSafeFixture(fixture: ReplayFixture): ReplayFixture {
  const denied = new Set([
    'authorization',
    'cookie',
    'setcookie',
    'token',
    'apikey',
    'secret',
    'password',
    'privatekey',
    'accesskey',
    'accesstoken',
    'refreshtoken',
    'sessiontoken',
    'clientsecret',
  ]);
  function safe(value: unknown): boolean {
    if (typeof value === 'string')
      return (
        !/Bearer\s+(?!\[REDACTED\])[^\s]+/i.test(value) &&
        !/\b(?:password|token|api[_-]?key|secret)\s*[:=]\s*(?!\[REDACTED\])[^\s,;]+/i.test(value)
      );
    if (Array.isArray(value)) return value.every(safe);
    if (value && typeof value === 'object')
      return Object.entries(value).every(([key, v]) =>
        denied.has(key.toLowerCase().replace(/[^a-z0-9]/g, '')) ? v === '[REDACTED]' : safe(v),
      );
    return true;
  }
  if (!safe(fixture)) throw new Error('Replay fixture contains unsanitized sensitive fields');
  return fixture;
}
