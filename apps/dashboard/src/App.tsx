import { useEffect, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Columns2,
  Download,
  GitBranch,
  Layers3,
  RefreshCw,
  Search,
  Terminal,
  X,
  AlertCircle,
} from 'lucide-react';
import type { TraceSummary } from '@tracekit/protocol';
import {
  api,
  getTraces,
  getTrace,
  getSpans,
  duration,
  time,
  fullTime,
  exportFixture,
  matchedSpans,
} from './lib/api';
import { SpanWaterfall } from './components/SpanWaterfall';
import { CopyButton, SpanInspector } from './components/SpanInspector';
function readHash() {
  return new URLSearchParams(window.location.hash.slice(1)).get('trace');
}
export function App() {
  const metadata = useQuery({
    queryKey: ['meta'],
    queryFn: () => api<{ database_logical_bytes: number }>('/v1/meta'),
    refetchInterval: 30000,
    retry: 1,
  });
  const [trace, setTrace] = useState(readHash);
  const [view, setView] = useState<'traces' | 'compare' | 'setup'>('traces');
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [mode, setMode] = useState(''),
    [service, setService] = useState(''),
    [windowMs, setWindowMs] = useState('');
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const cursor = cursors.at(-1);
  const params = new URLSearchParams({ limit: '25' });
  if (search) params.set('q', search);
  if (status) params.set('status', status);
  if (mode) params.set('mode', mode);
  if (service) params.set('service_name', service);
  if (windowMs)
    params.set('from', String(Math.floor(Date.now() / 60000) * 60000 - Number(windowMs)));
  if (cursor) params.set('cursor', cursor);
  const query = useQuery({
    queryKey: ['traces', params.toString()],
    queryFn: () => getTraces(params),
    refetchInterval: 2000,
    placeholderData: keepPreviousData,
    retry: 1,
  });
  useEffect(() => {
    const listener = () => setTrace(readHash());
    window.addEventListener('hashchange', listener);
    return () => window.removeEventListener('hashchange', listener);
  }, []);
  function openTrace(id: string | null) {
    window.location.hash = id ? `trace=${id}` : '';
    setTrace(id);
    setView('traces');
  }
  function filter(setter: (s: string) => void, value: string) {
    setter(value);
    setCursors([undefined]);
  }
  const items = query.data?.items ?? [];
  return (
    <div className="app">
      <aside className="sidebar">
        <a href="#" className="brand" aria-label="TraceKit home" onClick={() => openTrace(null)}>
          <span className="brand-mark">
            <Activity size={22} />
          </span>
          <span>
            TraceKit<span className="brand-version">0.1</span>
          </span>
        </a>
        <div className="workspace-label">Workspace</div>
        <button
          className={`nav-item ${view === 'traces' ? 'active' : ''}`}
          onClick={() => {
            setView('traces');
            openTrace(null);
          }}
        >
          <Layers3 size={17} />
          Traces
          <ChevronRight size={14} />
        </button>
        <button
          className={`nav-item ${view === 'compare' ? 'active' : ''}`}
          onClick={() => setView('compare')}
        >
          <Columns2 size={17} />
          Replay comparison
        </button>
        <div className="sidebar-bottom">
          <div className="local-label">
            <span className={`connection-dot ${query.isError ? 'offline' : ''}`} />
            <span>{query.isError ? 'Collector offline' : 'Local collector'}</span>
          </div>
          <code>127.0.0.1:4319</code>
          <button
            className={`nav-item ${view === 'setup' ? 'active' : ''}`}
            onClick={() => setView('setup')}
          >
            <BookOpen size={16} />
            Local setup
          </button>
          <a
            className="source-link"
            href="https://github.com/mvritz/tracekit"
            target="_blank"
            rel="noreferrer"
          >
            Open source on GitHub
            <ArrowRight size={13} />
          </a>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <span>Local workspace</span>
            <ChevronRight size={12} />
            <strong>
              {view === 'compare' ? 'Replay comparison' : view === 'setup' ? 'Setup' : 'Traces'}
            </strong>
            {trace && view === 'traces' && (
              <>
                <ChevronRight size={12} />
                <span className="mono">{trace.slice(0, 8)}</span>
              </>
            )}
          </div>
          <span className="local-badge">
            <span className="connection-dot" />
            Local-first · SQLite
          </span>
        </header>
        {(metadata.data?.database_logical_bytes ?? 0) > 262144000 && (
          <div className="connection-banner" role="status">
            Local database exceeds 250 MiB. Retention is manual; stop the collector and back up or
            clear local data.
          </div>
        )}
        {query.isError && (
          <div className="connection-banner" role="alert">
            <AlertCircle size={16} />
            Collector unavailable. Showing the last retrieved data. Start it with{' '}
            <code>pnpm dev</code>.<button onClick={() => void query.refetch()}>Retry</button>
          </div>
        )}
        {view === 'setup' ? (
          <Setup />
        ) : view === 'compare' ? (
          <Comparison items={items} />
        ) : trace ? (
          <TraceDetail id={trace} onBack={() => openTrace(null)} />
        ) : (
          <div className="page">
            <div className="page-heading">
              <div>
                <div className="eyebrow">Execution history</div>
                <h1>
                  Trace explorer<span className="heading-dot">.</span>
                </h1>
                <p>Inspect local agent runs and recorded tool boundaries.</p>
              </div>
              <button className="button" onClick={() => void query.refetch()}>
                <RefreshCw size={14} className={query.isFetching ? 'spinning' : ''} />
                Refresh
              </button>
            </div>
            <div className="metrics">
              <Metric
                value={String(items.length).padStart(2, '0')}
                label="Runs on this page"
                icon={<Layers3 size={17} />}
              />
              <Metric
                value={String(items.filter((x) => x.mode === 'replay').length).padStart(2, '0')}
                label="Recorded replays"
                icon={<GitBranch size={17} />}
              />
              <Metric
                value={String(items.filter((x) => x.status === 'error').length).padStart(2, '0')}
                label="Runs with errors"
                icon={<AlertCircle size={17} />}
              />
            </div>
            <div className="section-heading">
              <h2>Recent traces</h2>
              <span>
                <span className={`connection-dot ${query.isError ? 'offline' : ''}`} />
                {query.isError ? 'Offline' : 'Updates every 2 seconds'}
              </span>
            </div>
            <div className="filters">
              <label className="search">
                <Search size={16} />
                <input
                  value={search}
                  onChange={(e) => filter(setSearch, e.target.value)}
                  placeholder="Search name or trace ID"
                  aria-label="Search traces"
                />
              </label>
              <label className="sr-only" htmlFor="service">
                Service
              </label>
              <input
                id="service"
                className="service-filter"
                value={service}
                placeholder="All services"
                onChange={(e) => filter(setService, e.target.value)}
              />
              <select
                aria-label="Status filter"
                value={status}
                onChange={(e) => filter(setStatus, e.target.value)}
              >
                <option value="">All statuses</option>
                <option value="ok">Success</option>
                <option value="error">Error</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <select
                aria-label="Mode filter"
                value={mode}
                onChange={(e) => filter(setMode, e.target.value)}
              >
                <option value="">All modes</option>
                <option value="record">Record</option>
                <option value="replay">Replay</option>
              </select>
              <select
                aria-label="Time window"
                value={windowMs}
                onChange={(e) => filter(setWindowMs, e.target.value)}
              >
                <option value="">All time</option>
                <option value="3600000">Last hour</option>
                <option value="86400000">Last 24 hours</option>
                <option value="604800000">Last 7 days</option>
              </select>
            </div>
            <div className="table-scroll">
              <table className="trace-table">
                <thead>
                  <tr>
                    <th>Trace name</th>
                    <th>Status</th>
                    <th>Duration</th>
                    <th>Spans</th>
                    <th>Mode</th>
                    <th>
                      Started <ArrowDown size={12} />
                    </th>
                    <th>
                      <span className="sr-only">Open trace</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.trace_id}>
                      <td>
                        <button className="trace-link" onClick={() => openTrace(item.trace_id)}>
                          <Activity size={17} />
                          <span>
                            <strong>{item.name}</strong>
                            <small>
                              {item.service_name}
                              <span className="mono">{item.trace_id.slice(0, 8)}</span>
                            </small>
                          </span>
                        </button>
                      </td>
                      <td>
                        <Status status={item.status} />
                      </td>
                      <td className="mono">{duration(item.duration_ns)}</td>
                      <td className="mono muted">{item.span_count}</td>
                      <td>
                        <Mode mode={item.mode} />
                      </td>
                      <td className="mono muted" title={fullTime(item.start_time_unix_ms)}>
                        {time(item.start_time_unix_ms)}
                      </td>
                      <td>
                        <button
                          className="icon-button"
                          aria-label={`Open ${item.name}`}
                          onClick={() => openTrace(item.trace_id)}
                        >
                          <ArrowRight size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {items.length === 0 && (
              <div className="empty-state">
                <Layers3 size={30} />
                <h2>
                  {query.isPending
                    ? 'Connecting to your collector…'
                    : search || status || mode || service
                      ? 'No matching traces'
                      : 'Your next run starts here'}
                </h2>
                <p>
                  {search || status || mode || service
                    ? 'Adjust the filters to find a run.'
                    : 'Run the offline research agent to inspect a real execution.'}
                </p>
                <code>pnpm demo:record</code>
                <button className="text-button" onClick={() => setView('setup')}>
                  View setup instructions
                  <ArrowRight size={14} />
                </button>
              </div>
            )}
            <footer className="table-footer">
              <span>{items.length} runs on this page · Newest first</span>
              <div>
                <button
                  className="button"
                  disabled={cursors.length === 1 || query.isPlaceholderData}
                  onClick={() => setCursors(cursors.slice(0, -1))}
                >
                  <ArrowLeft size={13} />
                  Previous
                </button>
                <span className="mono">{String(cursors.length).padStart(2, '0')}</span>
                <button
                  className="button"
                  disabled={!query.data?.next_cursor || query.isPlaceholderData}
                  onClick={() => setCursors([...cursors, query.data!.next_cursor!])}
                >
                  Next
                  <ArrowRight size={13} />
                </button>
              </div>
            </footer>
            <div className="page-note">
              <Terminal size={14} />
              <span>Traces stay on this machine. Payload capture is off by default.</span>
              <span>Schema v1</span>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
function Metric({ value, label, icon }: { value: string; label: string; icon: React.ReactNode }) {
  return (
    <div className="metric">
      <div>
        <span>{label}</span>
        {icon}
      </div>
      <strong>{value}</strong>
    </div>
  );
}
export function Status({ status }: { status: TraceSummary['status'] }) {
  return (
    <span className={`status ${status}`}>
      {status === 'ok' ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}{' '}
      {status === 'ok' ? 'Success' : status === 'error' ? 'Error' : 'Cancelled'}
    </span>
  );
}
function Mode({ mode }: { mode: string }) {
  return (
    <span className={`mode ${mode}`}>
      {mode === 'replay' ? <GitBranch size={12} /> : <span className="record-dot" />}
      {mode === 'replay' ? 'Replay' : 'Record'}
    </span>
  );
}
function TraceDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const summary = useQuery({
    queryKey: ['trace', id],
    queryFn: () => getTrace(id),
    refetchInterval: 2000,
    retry: 1,
  });
  const spans = useQuery({
    queryKey: ['spans', id],
    queryFn: () => getSpans(id),
    refetchInterval: 2000,
    retry: 1,
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const current =
    spans.data?.find((s) => s.span_id === selected) ??
    spans.data?.find((s) => !s.parent_span_id) ??
    spans.data?.[0];
  const t = summary.data;
  return (
    <div className="page detail-page">
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={14} />
        All traces
      </button>
      {!t ? (
        <div className="empty-state">
          <h1>{summary.isError ? 'Trace unavailable' : 'Loading execution…'}</h1>
        </div>
      ) : (
        <>
          <div className="page-heading">
            <div>
              <div className="eyebrow">{t.service_name} / execution</div>
              <h1>{t.name}</h1>
              <div className="detail-metadata">
                <Status status={t.status} />
                <Mode mode={t.mode} />
                <span className="mono">{duration(t.duration_ns)}</span>
                <span>{fullTime(t.start_time_unix_ms)}</span>
              </div>
            </div>
            <button
              className="button"
              onClick={() =>
                void exportFixture(t.run_id).then(
                  () =>
                    setMessage(
                      'Fixture exported. Contains sanitized tool outputs; review before sharing.',
                    ),
                  () =>
                    setMessage(
                      'No finalized fixture. Enable replay.capture and complete the run before exporting.',
                    ),
                )
              }
            >
              <Download size={14} />
              Export fixture
            </button>
          </div>
          <div className="trace-id-row">
            <span>Trace ID</span>
            <code>{id}</code>
            <CopyButton value={id} label="Copy trace ID" />
            {!t.complete && <span className="notice">Root span pending</span>}
          </div>
          {message && (
            <div role="status" className="notice export-notice">
              {message}
              <button
                className="icon-button"
                aria-label="Dismiss export message"
                onClick={() => setMessage('')}
              >
                <X size={14} />
              </button>
            </div>
          )}
          {t.replay_of_run_id && (
            <div className="replay-banner">
              <GitBranch size={16} />
              Replayed from <code>{t.replay_of_run_id}</code>. Tool timing reflects substituted
              responses.
            </div>
          )}
          <div className="execution-heading">
            <h2>Execution waterfall</h2>
            <span className="mono">
              {t.span_count} spans · {t.error_count} errors
            </span>
          </div>
          <div className="execution-grid">
            <section aria-label="Execution waterfall">
              {spans.data ? (
                <SpanWaterfall
                  spans={spans.data}
                  selected={current?.span_id ?? null}
                  onSelect={setSelected}
                />
              ) : (
                <p className="notice">
                  {spans.isError ? 'Unable to load spans. Retrying…' : 'Loading spans…'}
                </p>
              )}
            </section>
            <SpanInspector span={current} />
          </div>
          <div className="page-note">
            <span>Offsets use wall time. Durations use the SDK’s monotonic clock.</span>
            <span className="mono">{t.run_id}</span>
          </div>
        </>
      )}
    </div>
  );
}
function Comparison({ items }: { items: TraceSummary[] }) {
  const originals = items.filter((x) => x.mode === 'record');
  const [original, setOriginal] = useState('');
  const [replay, setReplay] = useState('');
  const oid = original || originals[0]?.trace_id || '';
  const run = items.find((x) => x.trace_id === oid)?.run_id;
  const replays = items.filter((x) => x.mode === 'replay' && x.replay_of_run_id === run);
  const rid = replays.some((x) => x.trace_id === replay) ? replay : replays[0]?.trace_id || '';
  const a = useQuery({ queryKey: ['spans', oid], queryFn: () => getSpans(oid), enabled: !!oid });
  const b = useQuery({ queryKey: ['spans', rid], queryFn: () => getSpans(rid), enabled: !!rid });
  const rows = a.data && b.data ? matchedSpans(a.data, b.data) : [];
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Controlled tool boundaries</div>
          <h1>
            Replay comparison<span className="heading-dot">.</span>
          </h1>
          <p>Compare recorded execution with substituted tool outcomes.</p>
        </div>
      </div>
      <div className="comparison-selectors">
        <label>
          Original run
          <select value={oid} onChange={(e) => setOriginal(e.target.value)}>
            <option value="" disabled>
              Select an original
            </option>
            {originals.map((x) => (
              <option value={x.trace_id} key={x.trace_id}>
                {x.name} · {time(x.start_time_unix_ms)}
              </option>
            ))}
          </select>
        </label>
        <ArrowRight size={22} />
        <label>
          Replay run
          <select value={rid} onChange={(e) => setReplay(e.target.value)}>
            <option value="" disabled>
              Select a linked replay
            </option>
            {replays.map((x) => (
              <option value={x.trace_id} key={x.trace_id}>
                {x.name} · {time(x.start_time_unix_ms)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="notice">
        Replay substitutes registered tool responses. Timing changes do not measure a performance
        improvement. This selector shows runs on the current trace page.
      </div>
      {rows.length ? (
        <div className="table-scroll">
          <table className="comparison-table">
            <thead>
              <tr>
                <th>Span path</th>
                <th>Original</th>
                <th>Replay</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <td>{row.path}</td>
                  <td>
                    {row.original ? (
                      <>
                        <Status status={row.original.status} />
                        <span className="mono"> {duration(row.original.duration_ns)}</span>
                      </>
                    ) : (
                      'Missing'
                    )}
                  </td>
                  <td>
                    {row.replay ? (
                      <>
                        <Status status={row.replay.status} />
                        <span className="mono"> {duration(row.replay.duration_ns)}</span>
                      </>
                    ) : (
                      'Missing'
                    )}
                  </td>
                  <td>
                    {!row.original
                      ? 'Extra'
                      : !row.replay
                        ? 'Missing'
                        : row.original.status !== row.replay.status
                          ? 'Changed'
                          : 'Matched'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">
          <GitBranch size={30} />
          <h2>
            {a.isError || b.isError
              ? 'Unable to load comparison'
              : 'Select a recorded run and its replay'}
          </h2>
          <p>Create the pair with the offline demo.</p>
          <pre>pnpm demo:record{'\n'}pnpm demo:replay</pre>
        </div>
      )}
      <div className="command-panel">
        <Terminal size={18} />
        <div>
          <strong>Replay in your local Node process</strong>
          <p>The collector never executes your application code.</p>
          <code>pnpm demo:replay</code>
        </div>
      </div>
    </div>
  );
}
function Setup() {
  return (
    <div className="page setup">
      <div className="eyebrow">Local development</div>
      <h1>
        Start collecting<span className="heading-dot">.</span>
      </h1>
      <p>Node 22.12+, pnpm 9.15.4, and Rust 1.92 are required. No API keys or hosted account.</p>
      {[
        ['01', 'Start the collector and dashboard', 'pnpm install --frozen-lockfile\npnpm dev'],
        ['02', 'Record a real, offline agent run', 'pnpm demo:record\npnpm demo:failure'],
        ['03', 'Replay with live tools disabled', 'pnpm demo:replay'],
      ].map(([number, title, command]) => (
        <div className="setup-step" key={number}>
          <span>{number}</span>
          <div>
            <h2>{title}</h2>
            <pre>{command}</pre>
          </div>
        </div>
      ))}
      <div className="notice">
        Demo fixtures contain synthetic, sanitized tool outputs. Replay capture is independently
        opt-in. Review fixtures before sharing.
      </div>
      <a
        className="text-button"
        href="https://github.com/mvritz/tracekit#quickstart"
        target="_blank"
        rel="noreferrer"
      >
        Read the documentation
        <ArrowRight size={14} />
      </a>
    </div>
  );
}
