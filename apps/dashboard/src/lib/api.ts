import {
  spanSchema,
  type SpanEnvelope,
  type TracePage,
  type TraceSummary,
  type ReplayFixture,
  replayFixtureSchema,
} from '@tracekit/protocol';
export const API = 'http://127.0.0.1:4319';
export async function api<T>(path: string): Promise<T> {
  const response = await fetch(API + path, { signal: AbortSignal.timeout(4000) });
  if (!response.ok)
    throw new Error(
      response.status === 404 ? 'This resource is not available.' : 'Collector request failed.',
    );
  return response.json() as Promise<T>;
}
export const getTraces = (params: URLSearchParams) => api<TracePage>(`/v1/traces?${params}`);
export const getTrace = (id: string) => api<TraceSummary>(`/v1/traces/${id}`);
export async function getSpans(id: string): Promise<SpanEnvelope[]> {
  const data = await api<{ items: unknown[] }>(`/v1/traces/${id}/spans`);
  return data.items.map((s) => spanSchema.parse(s));
}
export async function exportFixture(runId: string) {
  const data = await api<ReplayFixture>(`/v1/runs/${runId}/replay-fixture`);
  const fixture = replayFixtureSchema.parse(data);
  const blob = new Blob([JSON.stringify(fixture, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tracekit-${runId}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
export const duration = (ns: number) =>
  ns < 1e6
    ? `${(ns / 1e3).toFixed(1)} µs`
    : ns < 1e9
      ? `${(ns / 1e6).toFixed(1)} ms`
      : `${(ns / 1e9).toFixed(2)} s`;
export const time = (ms: number) =>
  new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(ms);
export const fullTime = (ms: number) => new Date(ms).toLocaleString();
export type TreeRow = {
  span: SpanEnvelope;
  depth: number;
  descendantsHaveErrors: boolean;
  hasChildren: boolean;
};
export function treeRows(spans: SpanEnvelope[], collapsed: Set<string> = new Set()): TreeRow[] {
  const byId = new Map(spans.map((s) => [s.span_id, s]));
  const children = new Map<string, SpanEnvelope[]>();
  for (const s of spans) {
    const parent = s.parent_span_id && byId.has(s.parent_span_id) ? s.parent_span_id : '';
    children.set(parent, [...(children.get(parent) ?? []), s]);
  }
  for (const list of children.values())
    list.sort(
      (a, b) => a.start_time_unix_ms - b.start_time_unix_ms || a.span_id.localeCompare(b.span_id),
    );
  const rows: TreeRow[] = [];
  const visited = new Set<string>();
  const hasError = (s: SpanEnvelope, seen = new Set<string>()): boolean => {
    if (seen.has(s.span_id)) return false;
    seen.add(s.span_id);
    return s.status === 'error' || (children.get(s.span_id) ?? []).some((c) => hasError(c, seen));
  };
  const walk = (list: SpanEnvelope[], depth: number) => {
    for (const span of list) {
      if (visited.has(span.span_id)) continue;
      visited.add(span.span_id);
      const child = children.get(span.span_id) ?? [];
      rows.push({
        span,
        depth,
        descendantsHaveErrors: hasError(span),
        hasChildren: child.length > 0,
      });
      if (!collapsed.has(span.span_id) && depth < 32) walk(child, depth + 1);
    }
  };
  walk(children.get('') ?? [], 0);
  return rows;
}
export function matchedSpans(original: SpanEnvelope[], replay: SpanEnvelope[]) {
  const paths = (spans: SpanEnvelope[]) => {
    const byId = new Map(spans.map((s) => [s.span_id, s]));
    const counts = new Map<string, number>();
    return treeRows(spans).map(({ span }) => {
      const names = [span.name];
      let p = span.parent_span_id;
      const visited = new Set([span.span_id]);
      while (p && byId.has(p) && !visited.has(p)) {
        visited.add(p);
        const parent = byId.get(p)!;
        names.unshift(parent.name);
        p = parent.parent_span_id;
      }
      const base = names.join(' / ');
      const n = counts.get(base) ?? 0;
      counts.set(base, n + 1);
      return { key: `${base}#${n}`, span, path: base };
    });
  };
  const left = paths(original),
    right = paths(replay);
  const index = new Map(right.map((x) => [x.key, x]));
  const result = left.map((x) => ({
    path: x.path,
    original: x.span,
    replay: index.get(x.key)?.span,
  }));
  const leftKeys = new Set(left.map((x) => x.key));
  return [
    ...result,
    ...right
      .filter((x) => !leftKeys.has(x.key))
      .map((x) => ({ path: x.path, original: undefined, replay: x.span })),
  ];
}
