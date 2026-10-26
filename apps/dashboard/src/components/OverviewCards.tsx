import { useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  GitBranch,
  Layers3,
  Radio,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import type { TraceSummary } from '@tracekit/protocol';
import { duration, time } from '../lib/api';

type OverviewProps = {
  items: TraceSummary[];
  mode: string;
  onModeChange: (mode: string) => void;
  onOpenTrace: (trace: string) => void;
};
export function OverviewCards({ items, mode, onModeChange, onOpenTrace }: OverviewProps) {
  const total = items.reduce((n, item) => n + item.duration_ns, 0);
  const records = items.filter((item) => item.mode === 'record').length;
  const replays = items.length - records;
  const errors = items.filter((item) => item.status === 'error').length;
  const spans = items.reduce((n, item) => n + item.span_count, 0);
  const services = new Set(items.map((item) => item.service_name)).size;
  const success = items.length
    ? Math.round((items.filter((item) => item.status === 'ok').length / items.length) * 100)
    : null;
  return (
    <section className="overview-cards" aria-label="Execution overview">
      <div className="time-card glass-card">
        <div className="card-title">
          <span>Total execution time</span>
          <span className="scope-tag">This page</span>
        </div>
        <div className="execution-total">{items.length ? duration(total) : '—'}</div>
        <div className="segmented-control" aria-label="Run mode">
          {[
            ['', 'All runs'],
            ['record', 'Recorded'],
            ['replay', 'Replays'],
          ].map(([value, label]) => (
            <button key={value} aria-pressed={mode === value} onClick={() => onModeChange(value!)}>
              {mode === value && <span className="segment-dot" />}
              {label}
            </button>
          ))}
        </div>
        <div className="summary-bottom">
          <div>
            <span>Spans</span>
            <strong>{spans.toLocaleString()}</strong>
          </div>
          <div>
            <span>Services</span>
            <strong>{services}</strong>
          </div>
          <div>
            <span>Success rate</span>
            <strong>{success === null ? '—' : `${success}%`}</strong>
          </div>
        </div>
      </div>
      <div className="stats-grid">
        <StatCard
          label="Traces"
          value={items.length}
          detail="Runs on this page"
          icon={<Layers3 size={16} />}
          mint
        />
        <StatCard
          label="Recorded"
          value={records}
          detail="Original executions"
          icon={<Radio size={16} />}
        />
        <StatCard
          label="Replays"
          value={replays}
          detail="Recorded tool outcomes"
          icon={<GitBranch size={16} />}
        />
        <StatCard
          label="Error runs"
          value={errors}
          detail="With failed spans"
          icon={<TriangleAlert size={16} />}
        />
      </div>
      <DurationChart items={items} onOpenTrace={onOpenTrace} />
    </section>
  );
}
function StatCard({
  label,
  value,
  detail,
  icon,
  mint = false,
}: {
  label: string;
  value: number;
  detail: string;
  icon: React.ReactNode;
  mint?: boolean;
}) {
  return (
    <div className={`stat-card glass-card ${mint ? 'mint-card' : ''}`}>
      <div className="stat-label">
        {label}
        <span className="stat-icon">{icon}</span>
      </div>
      <strong>{value.toLocaleString()}</strong>
      <span className="stat-detail">
        {mint ? <ArrowUpRight size={11} /> : <span className="stat-small-dot" />}
        {detail}
      </span>
    </div>
  );
}
function DurationChart({
  items,
  onOpenTrace,
}: {
  items: TraceSummary[];
  onOpenTrace: (id: string) => void;
}) {
  const [metric, setMetric] = useState('duration');
  const ordered = [...items].reverse();
  const values = ordered.map((item) =>
    metric === 'duration' ? item.duration_ns : item.span_count,
  );
  const maximum = Math.max(1, ...values);
  const format = (n: number) =>
    metric === 'duration' ? duration(n) : Math.round(n).toLocaleString();
  return (
    <div className="duration-card glass-card">
      <div className="chart-title">
        <div>
          <h2>{metric === 'duration' ? 'Run duration' : 'Spans per run'}</h2>
          <p>{items.length} executions on this page</p>
        </div>
        <label className="chart-select">
          <select
            aria-label="Chart metric"
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
          >
            <option value="duration">Duration</option>
            <option value="spans">Spans</option>
          </select>
          <ChevronDown size={11} />
        </label>
      </div>
      <div
        className="chart-content"
        role="group"
        aria-label={metric === 'duration' ? 'Run duration chart' : 'Spans per run chart'}
      >
        <div className="chart-axis">
          <span>{format(maximum)}</span>
          <span>{format(maximum / 2)}</span>
          <span>0</span>
        </div>
        <div className="bar-chart">
          <div className="chart-grid" />
          {ordered.length ? (
            ordered.map((item, index) => (
              <button
                key={item.trace_id}
                className={`chart-column ${item.mode === 'replay' ? 'replay-column' : ''} ${item.status === 'error' ? 'error-column' : ''}`}
                style={{ height: `${Math.max(3, (values[index]! / maximum) * 100)}%` }}
                aria-label={`Open run ${item.name} at ${time(item.start_time_unix_ms)}, ${format(values[index]!)}`}
                onClick={() => onOpenTrace(item.trace_id)}
              >
                <span className="bar-tooltip">
                  {item.name}
                  <strong>{format(values[index]!)}</strong>
                </span>
              </button>
            ))
          ) : (
            <span className="chart-empty">Your runs will appear here</span>
          )}
        </div>
      </div>
      <div className="chart-foot">
        <span>{ordered[0] ? time(ordered[0].start_time_unix_ms) : 'No runs yet'}</span>
        <div>
          <span>
            <i />
            Record
          </span>
          <span>
            <i />
            Replay
          </span>
        </div>
        <span>{ordered.at(-1) ? time(ordered.at(-1)!.start_time_unix_ms) : ''}</span>
      </div>
    </div>
  );
}
export function CollectionSummary({
  items,
  onRecords,
  onCompare,
}: {
  items: TraceSummary[];
  onRecords: () => void;
  onCompare: () => void;
}) {
  const complete = items.filter((item) => item.complete).length;
  const percent = items.length ? Math.round((complete / items.length) * 100) : 0;
  const records = items.filter((item) => item.mode === 'record').length,
    replays = items.length - records;
  return (
    <aside className="overview-side" aria-label="Collection summary">
      <div className="health-card glass-card">
        <div className="card-title">
          <h2>Trace completeness</h2>
          <span className="round-icon">
            <ShieldCheck size={16} />
          </span>
        </div>
        <div className="health-value">
          <strong>{items.length ? `${percent}%` : '—'}</strong>
          <span>root spans received</span>
        </div>
        <div
          className="health-progress"
          role="progressbar"
          aria-label="Root spans received"
          aria-valuemin={0}
          aria-valuemax={items.length || 1}
          aria-valuenow={complete}
        >
          <span style={{ width: `${percent}%` }} />
        </div>
        <p>
          {complete} of {items.length} runs on this page have a completed root.
        </p>
      </div>
      <div className="quick-cards">
        <button className="quick-card dark-card" onClick={onRecords}>
          <span className="quick-card-top">
            <Activity size={17} />
            <ArrowUpRight size={15} />
          </span>
          <strong>{records}</strong>
          <span>Recorded runs</span>
          <small>Inspect originals</small>
        </button>
        <button className="quick-card mint-card" onClick={onCompare}>
          <span className="quick-card-top">
            <GitBranch size={17} />
            <ArrowUpRight size={15} />
          </span>
          <strong>{replays}</strong>
          <span>Replay comparison</span>
          <small>Compare outcomes</small>
        </button>
      </div>
      <div className="local-data-note">
        <CheckCircle2 size={15} />
        <div>
          <strong>Your data stays local</strong>
          <p>
            SQLite on this machine.
            <br />
            Payload capture is opt-in.
          </p>
        </div>
      </div>
    </aside>
  );
}
