import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTraceKit,
  createSanitizer,
  ReplayMismatchError,
  RecordedToolError,
} from '../src/index.js';
import { batchSchema, type SpanBatch } from '@tracekit/protocol';
let batches: SpanBatch[] = [];
const clients: ReturnType<typeof createTraceKit>[] = [];
const client = (options: Partial<Parameters<typeof createTraceKit>[0]> = {}) => {
  const tk = createTraceKit({ serviceName: 'test', ...options });
  clients.push(tk);
  return tk;
};
const spans = () => batches.flatMap((b) => b.spans);
beforeEach(() => {
  batches = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.spans) batches.push(batchSchema.parse(body));
      return new Response('{}', { status: 200 });
    }),
  );
});
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.shutdown()));
  vi.unstubAllGlobals();
});
describe('context and lifecycle', () => {
  it('preserves nested and 100 concurrent sibling relationships', async () => {
    const tk = client();
    const value = await tk.trace('root', async () =>
      Promise.all(
        Array.from({ length: 100 }, (_, i) =>
          tk.span(`child-${i}`, async () => {
            await Promise.resolve();
            return tk.span(`grand-${i}`, () => i);
          }),
        ),
      ),
    );
    expect(value).toEqual(Array.from({ length: 100 }, (_, i) => i));
    await tk.flush();
    const all = spans();
    expect(all).toHaveLength(201);
    const root = all.find((s) => s.name === 'root')!;
    for (const span of all.filter((s) => s.name.startsWith('child')))
      expect(span.parent_span_id).toBe(root.span_id);
    for (let i = 0; i < 100; i++)
      expect(all.find((s) => s.name === `grand-${i}`)?.parent_span_id).toBe(
        all.find((s) => s.name === `child-${i}`)?.span_id,
      );
    expect(new Set(all.map((s) => s.span_id)).size).toBe(201);
    expect(all.every((s) => s.duration_ns >= 0)).toBe(true);
  });
  it('preserves the exact thrown error and sync return value', async () => {
    const tk = client();
    const error = new Error('original');
    await expect(
      tk.trace('throw', () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(await tk.trace('return', () => 42)).toBe(42);
    await tk.flush();
    expect(spans().find((s) => s.name === 'throw')?.status).toBe('error');
  });
  it('makes nested traces independent and implicit spans roots', async () => {
    const tk = client();
    await tk.trace('a', () => tk.trace('b', () => true));
    await tk.span('implicit', () => 1);
    await tk.flush();
    expect(spans().every((s) => s.parent_span_id === null)).toBe(true);
    expect(new Set(spans().map((s) => s.run_id)).size).toBe(3);
  });
  it('does not capture payloads or error details by default', async () => {
    const tk = client();
    await tk.trace('a', () =>
      tk.recordTool('tool', () => ({ password: 'sensitive' }), { query: 'private' }),
    );
    await tk
      .trace('b', () => {
        throw new Error('private');
      })
      .catch(() => {});
    await tk.flush();
    expect(spans().every((s) => s.payload === null)).toBe(true);
    expect(JSON.stringify(spans())).not.toContain('private');
  });
  it('sanitizes before enqueue without mutating application values', async () => {
    const tk = client({
      capture: { inputs: true, outputs: true, errors: true },
      redaction: { patterns: [/person@example.com/g] },
    });
    const value = {
      Token: 'secret-value',
      email: 'person@example.com',
      nested: { 'api-key': 'other-secret' },
    };
    expect(await tk.trace('a', () => tk.recordTool('tool', () => value, value))).toBe(value);
    await tk.flush();
    const encoded = JSON.stringify(spans());
    expect(encoded).not.toContain('secret-value');
    expect(encoded).not.toContain('other-secret');
    expect(encoded).not.toContain('person@example.com');
    expect(value.Token).toBe('secret-value');
  });
  it('never lets a broken custom sanitizer replace application behavior', async () => {
    const tk = client({
      capture: { outputs: true },
      redaction: {
        custom: () => {
          throw new Error('broken');
        },
      },
    });
    expect(await tk.trace('a', () => 55)).toBe(55);
    expect(tk.getDiagnostics().dropped).toBeGreaterThan(0);
  });
});
describe('safe serialization', () => {
  it('handles cycles, bigint, dates, errors, buffers and accessors without executing getters', () => {
    const getter = vi.fn(() => {
      throw new Error('getter');
    });
    const value: Record<string, unknown> = {
      big: 1n,
      date: new Date('2026-01-01'),
      error: new Error('Bearer abc'),
      buffer: Buffer.from('private'),
    };
    value.self = value;
    Object.defineProperty(value, 'get', { get: getter, enumerable: true });
    const result = JSON.stringify(createSanitizer().serialize(value));
    expect(result).toContain('[Circular]');
    expect(result).not.toContain('private');
    expect(result).not.toContain('Bearer abc');
    expect(getter).not.toHaveBeenCalled();
  });
  it('rejects lossy replay values and limits preview sizes', () => {
    const s = createSanitizer();
    expect(() => s.serialize({ a: undefined }, true)).toThrow();
    expect(() => s.serialize(new Date(), true)).toThrow();
    expect(s.preview({ large: 'a'.repeat(20000) }).truncated).toBe(true);
  });
});
describe('strict replay', () => {
  async function recording(handler: () => unknown = () => ({ answer: 42 })) {
    const tk = client({ replay: { mode: 'record', capture: true } });
    await tk.trace('agent', () => tk.recordTool('lookup', handler, { id: 1 })).catch(() => {});
    return tk.getReplayFixture();
  }
  it('substitutes a complete independent fixture and makes zero live calls', async () => {
    const fixture = await recording();
    const live = vi.fn(() => {
      throw new Error('live');
    });
    const tk = client({ replay: { mode: 'replay', fixture } });
    expect(await tk.trace('agent', () => tk.recordTool('lookup', live, { id: 1 }))).toEqual({
      answer: 42,
    });
    expect(live).not.toHaveBeenCalled();
    await tk.flush();
    expect(
      batches.some(
        (b) => b.run.mode === 'replay' && b.run.replay_of_run_id === fixture.source_run_id,
      ),
    ).toBe(true);
  });
  it('reenacts sanitized exceptions as typed errors', async () => {
    const fixture = await recording(() => {
      throw new TypeError('token=super-secret');
    });
    const tk = client({ replay: { mode: 'replay', fixture } });
    await expect(
      tk.trace('a', () => tk.recordTool('lookup', () => 0, { id: 1 })),
    ).rejects.toBeInstanceOf(RecordedToolError);
    expect(JSON.stringify(fixture)).not.toContain('super-secret');
  });
  it.each(['wrong input', 'wrong name', 'extra call', 'missing call', 'caught mismatch'])(
    'fails closed for %s',
    async (which) => {
      const fixture = await recording();
      const live = vi.fn(() => 1);
      const tk = client({ replay: { mode: 'replay', fixture } });
      await expect(
        tk.trace('a', async () => {
          if (which === 'missing call') return;
          const p = tk.recordTool(which === 'wrong name' ? 'different' : 'lookup', live, {
            id: which === 'wrong input' || which === 'caught mismatch' ? 2 : 1,
          });
          if (which === 'caught mismatch') await p.catch(() => {});
          else await p;
          if (which === 'extra call') await tk.recordTool('lookup', live, { id: 1 });
        }),
      ).rejects.toBeInstanceOf(ReplayMismatchError);
      expect(live).not.toHaveBeenCalled();
    },
  );
  it('requires independent opt-in and refuses incomplete/lossy/concurrent capture', async () => {
    const tk = client({ capture: { outputs: true } });
    await tk.trace('a', () => tk.recordTool('t', () => 1, {}));
    expect(() => tk.getReplayFixture()).toThrow();
    const lossy = client({ replay: { mode: 'record', capture: true } });
    await lossy.trace('a', () => lossy.recordTool('t', () => undefined, {}));
    expect(() => lossy.getReplayFixture()).toThrow();
    await lossy.trace('concurrent', () =>
      Promise.all([
        lossy.recordTool(
          't',
          async () => {
            await new Promise((r) => setTimeout(r, 2));
            return 1;
          },
          {},
        ),
        lossy.recordTool('u', () => 2, {}),
      ]),
    );
    expect(() => lossy.getReplayFixture()).toThrow();
  });
  it('rejects invalid versions and unsafe fixture metadata', async () => {
    const fixture = await recording();
    expect(() =>
      client({
        replay: {
          mode: 'replay',
          fixture: { ...fixture, fixture_version: 2 } as unknown as typeof fixture,
        },
      }),
    ).toThrow();
  });
});
describe('transport', () => {
  it('keeps results and original errors during collector outages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const tk = client({ batching: { maxRetries: 0 } });
    expect(await tk.trace('a', () => 42)).toBe(42);
    const e = new Error('app');
    await expect(
      tk.trace('b', () => {
        throw e;
      }),
    ).rejects.toBe(e);
    await tk.flush();
    expect(tk.getDiagnostics()).toMatchObject({ dropped: 2, failures: 2 });
  });
  it('retries identical batches and serializes simultaneous flushes', async () => {
    const calls: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init: RequestInit) => {
        calls.push(JSON.parse(String(init.body)));
        return new Response('{}', { status: calls.length === 1 ? 503 : 200 });
      }),
    );
    const tk = client({ batching: { maxRetries: 1 } });
    await tk.trace('a', () => 1);
    await Promise.all([tk.flush(), tk.flush()]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
    expect(tk.getDiagnostics().delivered).toBe(1);
  });
  it('does not retry invalid batches and drops newest on overflow', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 400 })),
    );
    const tk = client({ batching: { maxQueueSize: 1, maxBatchSize: 100 } });
    await tk.trace('a', () => 1);
    await tk.trace('b', () => 2);
    expect(tk.getDiagnostics().dropped).toBe(1);
    await tk.flush();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('bounds a hanging collector request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: unknown, init: RequestInit) =>
          new Promise((_r, reject) =>
            init.signal?.addEventListener('abort', () => reject(new Error('timeout'))),
          ),
      ),
    );
    const tk = client({ batching: { requestTimeoutMs: 10, maxRetries: 0 } });
    await tk.trace('a', () => 1);
    await tk.flush();
    expect(tk.getDiagnostics().failures).toBe(1);
  });
});
it('supports destructured tools outside an active trace', async () => {
  const tk = client();
  const { recordTool } = tk;
  expect(await recordTool('implicit-tool', (v: number) => v + 1, 1)).toBe(2);
  await tk.flush();
  expect(spans().filter((s) => s.kind === 'tool')).toHaveLength(1);
});
it('flags unused fixture calls even when local control flow throws early', async () => {
  const recorded = client({ replay: { mode: 'record', capture: true } });
  await recorded.trace('a', () => recorded.recordTool('t', () => 1, {}));
  const replay = client({ replay: { mode: 'replay', fixture: recorded.getReplayFixture() } });
  await expect(
    replay.trace('a', () => {
      throw new Error('changed branch');
    }),
  ).rejects.toBeInstanceOf(ReplayMismatchError);
});
it('rejects fixtures with obvious raw credential values', async () => {
  const recorded = client({ replay: { mode: 'record', capture: true } });
  await recorded.trace('a', () => recorded.recordTool('t', () => 1, {}));
  const fixture = recorded.getReplayFixture();
  fixture.calls[0]!.outcome = { type: 'return', value: { token: 'synthetic-unredacted-secret' } };
  expect(() => client({ replay: { mode: 'replay', fixture } })).toThrow('unsanitized');
});
