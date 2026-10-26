import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import type { SpanEnvelope } from '@tracekit/protocol';
import { duration, fullTime } from '../lib/api';
export function CopyButton({ value, label = 'Copy ID' }: { value: string; label?: string }) {
  const [state, setState] = useState('');
  return (
    <button
      className="icon-button"
      aria-label={label}
      title={state || label}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(
          () => {
            setState('Copied');
            setTimeout(() => setState(''), 2000);
          },
          () => setState('Copy unavailable'),
        );
      }}
    >
      {state === 'Copied' ? <Check size={14} /> : <Copy size={14} />}
      <span className="sr-only" role="status">
        {state}
      </span>
    </button>
  );
}
const tabs = ['Overview', 'Attributes', 'Events', 'Input', 'Output', 'Error'] as const;
export function SpanInspector({ span }: { span: SpanEnvelope | undefined }) {
  const [tab, setTab] = useState<(typeof tabs)[number]>('Overview');
  if (!span)
    return (
      <aside className="inspector">
        <div className="empty-small">Select a span to inspect its details.</div>
      </aside>
    );
  const payloadKey = tab === 'Input' ? 'input' : 'output';
  const captureState = span.payload?.[`${payloadKey}_state`];
  const legacyUndefined = !captureState && span.payload?.[payloadKey] === '[undefined]';
  const hasPayload = span.payload !== null && Object.hasOwn(span.payload, payloadKey);
  return (
    <aside className="inspector" aria-label="Span inspector">
      <div className="inspector-title">
        <span className="eyebrow">Span inspector</span>
        <span className={`status ${span.status}`}>
          {span.status === 'ok' ? 'Success' : span.status === 'error' ? 'Error' : 'Cancelled'}
        </span>
        <h2>{span.name}</h2>
        <div className="id-line mono">
          {span.span_id}
          <CopyButton value={span.span_id} />
        </div>
      </div>
      <div className="inspector-tabs" role="tablist" aria-label="Span detail tabs">
        {tabs.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            aria-controls="inspector-panel"
            id={`tab-${t}`}
            onClick={() => setTab(t)}
          >
            {t}
            {t === 'Events' && span.events.length > 0 && (
              <span className="tab-count">{span.events.length}</span>
            )}
          </button>
        ))}
      </div>
      <div
        className="inspector-content"
        role="tabpanel"
        id="inspector-panel"
        aria-labelledby={`tab-${tab}`}
        tabIndex={0}
      >
        {tab === 'Overview' ? (
          <>
            <dl className="details">
              <dt>Operation</dt>
              <dd>{span.kind}</dd>
              <dt>Duration</dt>
              <dd className="mono">{duration(span.duration_ns)}</dd>
              <dt>Started</dt>
              <dd className="mono">{fullTime(span.start_time_unix_ms)}</dd>
              <dt>Service</dt>
              <dd>{span.service_name}</dd>
              <dt>Parent span</dt>
              <dd className="mono">{span.parent_span_id ?? 'Root span'}</dd>
            </dl>
            {span.status === 'error' && (
              <div className="error-detail">
                <strong>{span.error?.type ?? 'Error'}</strong>
                <p>{span.error?.message ?? 'Error details not captured'}</p>
                <button className="text-button" onClick={() => setTab('Error')}>
                  Inspect error
                </button>
              </div>
            )}
            <div className="privacy-note">
              Payload capture is opt-in. Only sanitized previews appear here.
            </div>
          </>
        ) : tab === 'Attributes' ? (
          <Json value={span.attributes} />
        ) : tab === 'Events' ? (
          span.events.length ? (
            <Json value={span.events} />
          ) : (
            <NotCaptured text="No events recorded" />
          )
        ) : tab === 'Error' ? (
          span.error ? (
            <Json value={span.error} />
          ) : (
            <NotCaptured text="No error recorded" />
          )
        ) : captureState === 'undefined' || legacyUndefined ? (
          <>
            <NotCaptured
              text={
                legacyUndefined
                  ? 'No return value'
                  : payloadKey === 'output'
                    ? 'No return value'
                    : 'Undefined input'
              }
              detail={
                legacyUndefined
                  ? 'This older capture used an undefined marker, usually because the callback returned no value. It cannot distinguish that from the literal string "[undefined]".'
                  : payloadKey === 'output'
                    ? 'The callback completed without returning a value. This is different from a captured null or disabled capture.'
                    : 'Capture was enabled, but the supplied input was undefined.'
              }
            />
            <details className="payload-raw">
              <summary>Raw captured preview</summary>
              <Json value={span.payload?.[payloadKey]} />
            </details>
          </>
        ) : hasPayload ? (
          <>
            {span.payload?.[`${payloadKey}_truncated`] && (
              <p className="notice">Preview exceeded its size limit.</p>
            )}
            <Json value={span.payload?.[payloadKey]} />
          </>
        ) : (
          <NotCaptured
            text="Not captured"
            detail="Enable payload capture explicitly in your SDK configuration."
          />
        )}
      </div>
    </aside>
  );
}
function NotCaptured({ text, detail }: { text: string; detail?: string }) {
  return (
    <div className="empty-small">
      <strong>{text}</strong>
      {detail && <p>{detail}</p>}
    </div>
  );
}
function Json({ value }: { value: unknown }) {
  return <pre className="json">{JSON.stringify(value, null, 2)}</pre>;
}
