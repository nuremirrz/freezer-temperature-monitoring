import { EventEmitter } from "node:events";

/**
 * In-process event bus feeding the SSE endpoint (/api/stream).
 * Ingest publishes here after writing to the database.
 * Single-process by design — fine for the pilot; a multi-instance deploy would need Redis/pg NOTIFY.
 */

export interface ReadingEvent {
  type: "reading";
  data: {
    unitId: string;
    locationId: string;
    sensorId: string;
    channel: number;
    tempF: number;
    measuredAt: string;
  };
}

export interface AlertEvent {
  type: "alert";
  data: {
    id: string;
    unitId: string;
    locationId: string;
    alertType: "temp_out_of_range" | "offline";
    state: "opened" | "updated" | "resolved";
    peakTempF: number | null;
    openedAt: string;
    resolvedAt: string | null;
  };
}

export type StreamEvent = ReadingEvent | AlertEvent;

const g = globalThis as unknown as { __qimbyBus?: EventEmitter };
const bus = g.__qimbyBus ?? (g.__qimbyBus = new EventEmitter());
bus.setMaxListeners(200);

export function publish(event: StreamEvent): void {
  bus.emit("event", event);
}

export function subscribe(listener: (event: StreamEvent) => void): () => void {
  bus.on("event", listener);
  return () => bus.off("event", listener);
}
