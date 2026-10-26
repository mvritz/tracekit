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
