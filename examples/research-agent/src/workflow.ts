import type { TraceKitClient } from '@tracekit/sdk';
export const query = 'How should an agent cache retrieval results?';
const docs = [
  {
    id: 'doc-1',
    title: 'Cache invalidation',
    text: 'Expire retrieved results with a time-to-live and invalidate when source data changes.',
  },
  {
    id: 'doc-2',
    title: 'Stable cache keys',
    text: 'Hash normalized queries and include the corpus version in the cache key.',
  },
  {
    id: 'doc-3',
    title: 'Boundary tracing',
    text: 'Record cache hits and retrieval latency at explicit tool boundaries.',
  },
];
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export type DemoOptions = { fail?: boolean; liveDisabled?: boolean; onLiveCall?: () => void };
export async function research(tk: TraceKitClient, options: DemoOptions = {}) {
  const live = () => {
    options.onLiveCall?.();
    if (options.liveDisabled)
      throw new Error('Live tools are disabled; replay must substitute this boundary');
  };
  return tk.trace(
    'research-agent',
    async () => {
      const plan = await tk.span(
        'plan-query',
        async () => {
          await delay(12);
          return { query, limit: 3 };
        },
        { attributes: { 'workflow.version': 'demo-v1' } },
      );
      const retrieved = await tk.span(
        'retrieve-context',
        () =>
          tk.recordTool(
            'search-documents',
            async () => {
              live();
              await delay(85);
              return docs;
            },
            plan,
          ),
        { kind: 'retrieval' },
      );
      const ranked = await tk.span(
        'rank-sources',
        async () => {
          await delay(24);
          return [...retrieved].sort((a, b) => a.id.localeCompare(b.id));
        },
        { kind: 'internal', attributes: { 'documents.count': retrieved.length } },
      );
      const answer = await tk.span(
        'compose-answer',
        () =>
          tk.recordTool(
            'summarize-documents',
            async () => {
              live();
              await delay(140);
              return {
                summary:
                  'Cache retrieval results using normalized query keys, corpus versions, and explicit expiration.',
                citations: options.fail ? [] : ranked.map((d) => d.id),
              };
            },
            { documents: ranked, query },
          ),
        { kind: 'llm', attributes: { 'model.provider': 'offline-stub' } },
      );
      await tk.span(
        'validate-citations',
        async () => {
          await delay(3);
          if (answer.citations.length === 0)
            throw new Error('Answer must cite at least one retrieved source');
          return true;
        },
        { attributes: { 'validation.rule': 'citations-required' } },
      );
      return answer;
    },
    { attributes: { 'workflow.version': 'demo-v1', 'data.source': 'synthetic-offline-demo' } },
  );
}
