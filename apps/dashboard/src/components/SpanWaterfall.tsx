import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { SpanEnvelope } from '@tracekit/protocol';
import { duration, treeRows } from '../lib/api';
export const SpanWaterfall = memo(function SpanWaterfall({
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
  const list = useRef<HTMLUListElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const rowHeight = 50;
  const viewportHeight = 500;
  const overscan = 4;
  const first = Math.min(
    Math.max(0, rows.length - 1),
    Math.max(0, Math.floor(scrollTop / rowHeight) - overscan),
  );
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan);
  const { start, total, orphaned } = useMemo(() => {
    let start = Infinity;
    let end = -Infinity;
    const ids = new Set(spans.map((span) => span.span_id));
    let orphaned = false;
    for (const span of spans) {
      start = Math.min(start, span.start_time_unix_ms);
      end = Math.max(end, span.start_time_unix_ms + span.duration_ns / 1e6);
      if (span.parent_span_id && !ids.has(span.parent_span_id)) orphaned = true;
    }
    return {
      start: spans.length ? start : 0,
      total: spans.length ? Math.max(0.001, end - start) : 0.001,
      orphaned,
    };
  }, [spans]);
  useLayoutEffect(() => {
    if (pendingFocus.current) {
      refs.current.get(pendingFocus.current)?.focus({ preventScroll: true });
      pendingFocus.current = null;
    }
  });
  function selectRow(index: number) {
    const id = rows[index]!.span.span_id;
    const top = index * rowHeight;
    const currentTop = list.current?.scrollTop ?? 0;
    const nextTop =
      top < currentTop
        ? top
        : top + rowHeight > currentTop + viewportHeight
          ? top + rowHeight - viewportHeight
          : currentTop;
    pendingFocus.current = id;
    if (list.current) list.current.scrollTop = nextTop;
    setScrollTop(nextTop);
    onSelect(id);
    refs.current.get(id)?.focus({ preventScroll: true });
  }
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
      <ul
        ref={list}
        className="span-list"
        aria-label="Execution spans"
        data-total-spans={rows.length}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        {first > 0 && (
          <li role="presentation" aria-hidden="true" style={{ height: first * rowHeight }} />
        )}
        {rows
          .slice(first, end)
          .map(({ span, depth, hasChildren, descendantsHaveErrors }, offset) => {
            const index = first + offset;
            const left = Math.min(
              99,
              Math.max(0, ((span.start_time_unix_ms - start) / total) * 100),
            );
            const width = Math.min(
              100 - left,
              Math.max(0.5, (span.duration_ns / 1e6 / total) * 100),
            );
            return (
              <li
                key={span.span_id}
                aria-posinset={index + 1}
                aria-setsize={rows.length}
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
                        selectRow(target);
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
        {end < rows.length && (
          <li
            role="presentation"
            aria-hidden="true"
            style={{ height: (rows.length - end) * rowHeight }}
          />
        )}
      </ul>
      {orphaned && <p className="notice">Some parent spans have not arrived yet.</p>}
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
});
