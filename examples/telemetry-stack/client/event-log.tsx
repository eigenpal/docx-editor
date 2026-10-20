// A live list of the telemetry events this page sent, so you can see what reaches your
// backends while you edit. Each row is exactly what an exporter receives.
import { useSyncExternalStore } from 'react';
import {
  callbackExporter,
  isFailure,
  type TelemetryEvent,
  type TelemetryExporter,
} from '@docx-editor.dev/telemetry';

const LIMIT = 50;

export interface EventLog {
  /** Add this to `createTelemetry({ exporters })`. */
  readonly exporter: TelemetryExporter;
  subscribe(listener: () => void): () => void;
  events(): readonly TelemetryEvent[];
}

export function createEventLog(): EventLog {
  let events: readonly TelemetryEvent[] = [];
  const listeners = new Set<() => void>();
  return {
    exporter: callbackExporter((event) => {
      events = [event, ...events].slice(0, LIMIT);
      for (const listener of listeners) listener();
    }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    events: () => events,
  };
}

/** The headline of an event: its code, or its kind. */
function headline(event: TelemetryEvent): string {
  return 'code' in event && event.code ? event.code : event.kind;
}

export function EventLogPanel({ log }: { log: EventLog }) {
  const events = useSyncExternalStore(log.subscribe, log.events);
  return (
    <aside className="event-log" aria-label="Telemetry events">
      <h2>Telemetry events</h2>
      {events.length === 0 ? (
        <p className="event-log-empty">
          Open a file or type. A performance summary arrives once a minute, or when you switch tabs.
        </p>
      ) : (
        <ol>
          {events.map((event) => (
            <li
              key={`${event.time}-${event.kind}-${headline(event)}`}
              data-failure={isFailure(event)}
            >
              <strong>{headline(event)}</strong>
              <span>{new Date(event.time).toLocaleTimeString()}</span>
              {event.hint ? <p>{event.hint}</p> : null}
              <details>
                <summary>Payload</summary>
                <pre>{JSON.stringify(event, null, 2)}</pre>
              </details>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
