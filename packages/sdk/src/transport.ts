import type { ReplayFixture, RunMetadata, SpanBatch, SpanEnvelope } from '@tracekit/protocol';
export type Batching = {
  maxBatchSize?: number;
  flushIntervalMs?: number;
  maxQueueSize?: number;
  requestTimeoutMs?: number;
  maxRetries?: number;
};
export type Diagnostics = {
  queued: number;
  dropped: number;
  delivered: number;
  failures: number;
  replayCaptureFailures: number;
  fixturesDelivered: number;
};
export class Transport {
  private queue: { span: SpanEnvelope; run: RunMetadata; bytes: number }[] = [];
  private fixtures: ReplayFixture[] = [];
  private bytes = 0;
  private worker?: Promise<void>;
  private timer: ReturnType<typeof setInterval>;
  private closed = false;
  readonly stats: Diagnostics = {
    queued: 0,
    dropped: 0,
    delivered: 0,
    failures: 0,
    replayCaptureFailures: 0,
    fixturesDelivered: 0,
  };
  private readonly batch: number;
  private readonly capacity: number;
  private readonly timeout: number;
  private readonly retries: number;
  constructor(
    private endpoint: string,
    options: Batching = {},
  ) {
    const bounded = (v: number | undefined, fallback: number, max: number) =>
      Number.isFinite(v) ? Math.max(1, Math.min(max, Math.floor(v!))) : fallback;
    this.batch = bounded(options.maxBatchSize, 50, 100);
    this.capacity = bounded(options.maxQueueSize, 2000, 10000);
    this.timeout = bounded(options.requestTimeoutMs, 1000, 5000);
    this.retries = Math.min(5, Math.max(0, Math.floor(options.maxRetries ?? 2)));
    this.timer = setInterval(
      () => {
        void this.flush();
      },
      bounded(options.flushIntervalMs, 500, 60000),
    );
    this.timer.unref();
  }
  enqueue(span: SpanEnvelope, run: RunMetadata) {
    const bytes = Buffer.byteLength(JSON.stringify(span));
    if (this.closed || this.queue.length >= this.capacity || this.bytes + bytes > 8 * 1024 * 1024) {
      this.stats.dropped++;
      return;
    }
    this.queue.push({ span, run, bytes });
    this.bytes += bytes;
    this.stats.queued = this.queue.length;
    if (this.queue.length >= this.batch) void this.flush();
  }
  fixture(fixture: ReplayFixture) {
    if (this.closed || this.fixtures.length >= 16) {
      this.stats.replayCaptureFailures++;
      return;
    }
    this.fixtures.push(fixture);
  }
  private async send(path: string, body: unknown, deadline: number): Promise<boolean> {
    for (let attempt = 0; attempt <= this.retries && Date.now() < deadline; attempt++) {
      try {
        const response = await fetch(`${this.endpoint}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(Math.max(1, Math.min(this.timeout, deadline - Date.now()))),
        });
        await response.body?.cancel();
        if (response.ok) return true;
        if (response.status !== 429 && response.status < 500) break;
      } catch {
        /* Delivery cannot change application behavior. */
      }
      if (attempt < this.retries)
        await new Promise((r) =>
          setTimeout(
            r,
            Math.min(100 * 2 ** attempt + Math.random() * 50, Math.max(0, deadline - Date.now())),
          ),
        );
    }
    this.stats.failures++;
    return false;
  }
  flush(): Promise<void> {
    if (this.worker) return this.worker;
    this.worker = this.drain().finally(() => {
      this.worker = undefined;
    });
    return this.worker;
  }
  private async drain() {
    const deadline = Date.now() + 5000;
    let remaining = this.capacity;
    while (this.queue.length > 0 && remaining > 0 && Date.now() < deadline) {
      const first = this.queue[0]!;
      const group = this.queue
        .slice(0, Math.min(this.batch, remaining))
        .filter(
          (v, i, arr) =>
            v.run.run_id === first.run.run_id &&
            arr.slice(0, i).every((x) => x.run.run_id === first.run.run_id),
        );
      const body: SpanBatch = {
        schema_version: 1,
        source: { sdk: 'tracekit-node', version: '0.1.0' },
        run: first.run,
        spans: group.map((v) => v.span),
      };
      const ok = await this.send('/v1/ingest/spans', body, deadline);
      this.queue.splice(0, group.length);
      this.bytes -= group.reduce((n, v) => n + v.bytes, 0);
      remaining -= group.length;
      if (ok) this.stats.delivered += group.length;
      else this.stats.dropped += group.length;
      this.stats.queued = this.queue.length;
    }
    if (this.queue.length === 0) {
      const fixtures = this.fixtures.splice(0);
      for (const fixture of fixtures) {
        if (await this.send(`/v1/runs/${fixture.source_run_id}/replay-fixture`, fixture, deadline))
          this.stats.fixturesDelivered++;
        else this.stats.replayCaptureFailures++;
      }
    }
  }
  async shutdown() {
    clearInterval(this.timer);
    await this.flush();
    this.closed = true;
    this.stats.dropped += this.queue.length;
    this.queue = [];
    this.fixtures = [];
    this.bytes = 0;
    this.stats.queued = 0;
  }
}
