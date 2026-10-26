import { useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { SpanEnvelope } from '@tracekit/protocol';
import { duration, treeRows } from '../lib/api';
export function SpanWaterfall({
  spans,
  selected,
  onSelect,
}: {
  spans: SpanEnvelope[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const rows = useMemo(() => treeRows(spans, collapsed), [spans, collapsed]);
  const start = Math.min(...spans.map((s) => s.start_time_unix_ms));
  const total = Math.max(
    0.001,
    ...spans.map((s) => s.start_time_unix_ms - start + s.duration_ns / 1e6),
  );
  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  return (
    <div className="waterfall">
      <div className="timeline-heading">
        <span>Span / operation</span>
        <div className="ticks">
          {[0, 0.25, 0.5, 0.75, 1].map((n) => (
            <span key={n}>{duration(n * total * 1e6)}</span>
          ))}
        </div>
        <span>Duration</span>
      </div>
      <ul className="span-list" aria-label="Execution spans">
        {rows.map(({ span, depth, hasChildren, descendantsHaveErrors }, index) => {
          const left = Math.min(99, Math.max(0, ((span.start_time_unix_ms - start) / total) * 100));
          const width = Math.min(100 - left, Math.max(0.5, (span.duration_ns / 1e6 / total) * 100));
          return (
            <li
              key={span.span_id}
              className={`span-row ${selected === span.span_id ? 'selected' : ''} ${descendantsHaveErrors ? 'has-error' : ''}`}
            >
              <div className="span-label" style={{ paddingLeft: 12 + depth * 18 }}>
                {hasChildren ? (
                  <button
                    className="fold icon-button"
                    aria-label={`${collapsed.has(span.span_id) ? 'Expand' : 'Collapse'} ${span.name}`}
                    aria-expanded={!collapsed.has(span.span_id)}
                    onClick={() => toggle(span.span_id)}
                  >
                    {collapsed.has(span.span_id) ? (
                      <ChevronRight size={13} />
                    ) : (
                      <ChevronDown size={13} />
                    )}
                  </button>
                ) : (
                  <span className="fold-placeholder" />
                )}
                <button
                  ref={(node) => {
                    if (node) refs.current.set(span.span_id, node);
                    else refs.current.delete(span.span_id);
                  }}
                  className="select-span"
                  aria-label={`${span.name}${descendantsHaveErrors ? ' Error' : ''}`}
                  aria-pressed={selected === span.span_id}
                  onClick={() => onSelect(span.span_id)}
                  onKeyDown={(e) => {
                    let target: number | undefined;
                    if (e.key === 'ArrowDown') target = Math.min(rows.length - 1, index + 1);
                    if (e.key === 'ArrowUp') target = Math.max(0, index - 1);
                    if (e.key === 'Home') target = 0;
                    if (e.key === 'End') target = rows.length - 1;
                    if (e.key === 'ArrowLeft' && hasChildren) {
                      e.preventDefault();
                      if (!collapsed.has(span.span_id)) toggle(span.span_id);
                    }
                    if (e.key === 'ArrowRight' && hasChildren) {
                      e.preventDefault();
                      if (collapsed.has(span.span_id)) toggle(span.span_id);
                    }
                    if (target !== undefined) {
                      e.preventDefault();
                      const id = rows[target]!.span.span_id;
                      onSelect(id);
                      refs.current.get(id)?.focus();
                    }
                  }}
                  title={span.name}
                >
                  <span className={`kind-dot ${span.kind}`} />
                  <span className="span-name">{span.name}</span>
                  {descendantsHaveErrors && <span className="error-word">Error</span>}
                </button>
              </div>
              <button
                className="lane"
                aria-label={`Select ${span.name}, ${duration(span.duration_ns)}`}
                onClick={() => onSelect(span.span_id)}
              >
                <span
                  className={`bar ${span.kind} ${span.status === 'error' ? 'error' : ''}`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                />
              </button>
              <span className="span-duration mono">{duration(span.duration_ns)}</span>
            </li>
          );
        })}
      </ul>
      {spans.some(
        (s) => s.parent_span_id && !spans.some((p) => p.span_id === s.parent_span_id),
      ) && <p className="notice">Some parent spans have not arrived yet.</p>}
      <div className="timeline-legend">
        <span>
          <i className="kind-dot agent" />
          Agent
        </span>
        <span>
          <i className="kind-dot tool" />
          Tool
        </span>
        <span>
          <i className="kind-dot llm" />
          LLM / internal
        </span>
        <span>Measured with a monotonic clock</span>
      </div>
    </div>
  );
}
