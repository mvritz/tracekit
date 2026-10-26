// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { SpanEnvelope } from '@tracekit/protocol';
import { SpanInspector } from './SpanInspector';
import { SpanWaterfall } from './SpanWaterfall';
import { matchedSpans, treeRows } from '../lib/api';
const root: SpanEnvelope = {
  schema_version: 1,
  trace_id: '1'.repeat(32),
  span_id: '2'.repeat(16),
  parent_span_id: null,
  run_id: '11111111-1111-4111-8111-111111111111',
  name: 'agent',
  kind: 'agent',
  status: 'ok',
  start_time_unix_ms: 1,
  end_time_unix_ms: 2,
  duration_ns: 1e6,
  service_name: 'test',
  attributes: {},
  events: [],
  payload: null,
  error: null,
};
afterEach(cleanup);
it('distinguishes not captured from captured null', () => {
  const { rerender } = render(<SpanInspector span={root} />);
  fireEvent.click(screen.getByRole('tab', { name: 'Input' }));
  expect(screen.getByText('Not captured')).toBeVisible();
  rerender(<SpanInspector span={{ ...root, payload: { input: null } }} />);
  expect(screen.getByText('null')).toBeVisible();
});
it('selects spans with keyboard and keeps descendant failures visible when folded', () => {
  const onSelect = vi.fn();
  const child = {
    ...root,
    name: 'validate',
    span_id: '3'.repeat(16),
    parent_span_id: root.span_id,
    status: 'error' as const,
  };
  render(<SpanWaterfall spans={[root, child]} selected={root.span_id} onSelect={onSelect} />);
  const button = screen.getByRole('button', { name: 'agent Error' });
  fireEvent.keyDown(button, { key: 'ArrowDown' });
  expect(onSelect).toHaveBeenCalledWith(child.span_id);
  fireEvent.click(screen.getByRole('button', { name: 'Collapse agent' }));
  expect(screen.queryByRole('button', { name: 'validate Error' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'agent Error' })).toBeVisible();
});
it('renders unknown parents and treats script markup as plain text', () => {
  const orphan = { ...root, parent_span_id: '9'.repeat(16), name: '<script>alert(1)</script>' };
  render(<SpanWaterfall spans={[orphan]} selected={null} onSelect={() => {}} />);
  expect(screen.getByText('Some parent spans have not arrived yet.')).toBeVisible();
  expect(screen.getByText(orphan.name)).toBeVisible();
  expect(document.querySelector('script')).toBeNull();
});
it('matches repeated span names by hierarchy and occurrence', () => {
  const a = { ...root, name: 'step', parent_span_id: root.span_id, span_id: '3'.repeat(16) };
  const b = { ...a, span_id: '4'.repeat(16) };
  const rows = matchedSpans([root, a, b], [root, a]);
  expect(rows).toHaveLength(3);
  expect(rows[2]?.replay).toBeUndefined();
  expect(treeRows([root, a], new Set([root.span_id]))).toHaveLength(1);
});
it('explains undefined separately from a literal marker, null and disabled capture', () => {
  const { rerender } = render(
    <SpanInspector
      span={{ ...root, payload: { output: '[undefined]', output_state: 'undefined' } }}
    />,
  );
  fireEvent.click(screen.getByRole('tab', { name: 'Output' }));
  expect(screen.getByText('No return value')).toBeVisible();
  rerender(
    <SpanInspector span={{ ...root, payload: { output: '[undefined]', output_state: 'value' } }} />,
  );
  expect(screen.queryByText('No return value')).not.toBeInTheDocument();
  expect(screen.getByText('"[undefined]"')).toBeVisible();
  rerender(<SpanInspector span={{ ...root, payload: { output: '[undefined]' } }} />);
  expect(screen.getByText(/This older capture/)).toBeVisible();
  rerender(<SpanInspector span={{ ...root, payload: { output: null, output_state: 'value' } }} />);
  expect(screen.getByText('null')).toBeVisible();
  rerender(<SpanInspector span={root} />);
  expect(screen.getByText('Not captured')).toBeVisible();
});
it('windows ten thousand spans and supports keyboard jumps beyond the mounted rows', () => {
  const spans = [
    root,
    ...Array.from({ length: 9999 }, (_, i) => ({
      ...root,
      name: `child-${i}`,
      span_id: (i + 3).toString(16).padStart(16, '0'),
      start_time_unix_ms: i + 2,
      parent_span_id: root.span_id,
    })),
  ];
  const onSelect = vi.fn();
  render(<SpanWaterfall spans={spans} selected={root.span_id} onSelect={onSelect} />);
  expect(document.querySelectorAll('.span-row').length).toBeLessThan(30);
  fireEvent.keyDown(screen.getByRole('button', { name: 'agent' }), { key: 'End' });
  const last = screen.getByRole('button', { name: 'child-9998' });
  expect(last).toHaveFocus();
  expect(onSelect).toHaveBeenLastCalledWith(spans.at(-1)!.span_id);
  fireEvent.keyDown(last, { key: 'Home' });
  expect(screen.getByRole('button', { name: 'agent' })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Collapse agent' }));
  expect(document.querySelectorAll('.span-row')).toHaveLength(1);
});
it('retains very deep descendants and propagates errors without recursion', () => {
  const spans = [
    root,
    ...Array.from({ length: 9999 }, (_, i) => ({
      ...root,
      span_id: (i + 3).toString(16).padStart(16, '0'),
      parent_span_id: i === 0 ? root.span_id : (i + 2).toString(16).padStart(16, '0'),
      status: i === 9998 ? ('error' as const) : ('ok' as const),
    })),
  ];
  const rows = treeRows(spans);
  expect(rows).toHaveLength(10000);
  expect(rows[0]?.descendantsHaveErrors).toBe(true);
  expect(rows.at(-1)?.depth).toBe(32);
  expect(treeRows(spans, new Set([root.span_id]))).toHaveLength(1);
});
