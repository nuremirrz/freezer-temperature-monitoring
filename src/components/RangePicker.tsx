"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { DayPicker, TZDate, type DateRange } from "react-day-picker";
import "react-day-picker/style.css";
import { MAX_SPAN_MS, MIN_SPAN_MS } from "@/lib/readings/window";
import { tzAbbrev, zonedParts, zonedToUtcMs } from "@/lib/tz";

/**
 * "Show me this stretch of time": two days on a calendar and a time on each, all on the
 * restaurant's clock. Loaded only when someone presses Custom — the calendar is the one piece
 * of the chart most visits never open.
 */

export interface RangePickerProps {
  timeZone: string;
  /** When the picker was opened: "today" and "the future" are judged against it */
  now: number;
  /** The window currently shown, if it is a custom one — the picker opens on it */
  initial?: { from: number; to: number };
  onApply: (from: number, to: number) => void;
  onClose: () => void;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The day as the calendar sees it: a TZDate at midnight in the restaurant's zone */
function dayOf(ms: number, tz: string): TZDate {
  const p = zonedParts(ms, tz);
  return new TZDate(p.y, p.m - 1, p.d, tz);
}

function instantOf(day: Date, time: string, tz: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) return null;
  // A TZDate reads its fields in its own zone; a plain Date would read them in the browser's
  return zonedToUtcMs({ y: day.getFullYear(), m: day.getMonth() + 1, d: day.getDate(), h: Number(m[1]), mi: Number(m[2]) }, tz);
}

const CALENDAR_STYLE = {
  "--rdp-accent-color": "#0e1b33",
  "--rdp-accent-background-color": "#eef2f8",
  "--rdp-range_start-color": "#ffffff",
  "--rdp-range_end-color": "#ffffff",
  "--rdp-range_middle-background-color": "#eef2f8",
  "--rdp-day-height": "2.25rem",
  "--rdp-day-width": "2.25rem",
  "--rdp-day_button-height": "2.1rem",
  "--rdp-day_button-width": "2.1rem",
  "--rdp-font-family": "inherit",
} as CSSProperties;

export default function RangePicker({ timeZone, now, initial, onApply, onClose }: RangePickerProps) {
  const today = useMemo(() => dayOf(now, timeZone), [now, timeZone]);
  const [range, setRange] = useState<DateRange | undefined>(() =>
    initial ? { from: dayOf(initial.from, timeZone), to: dayOf(initial.to, timeZone) } : undefined,
  );
  const [fromTime, setFromTime] = useState(() => {
    if (!initial) return "00:00";
    const p = zonedParts(initial.from, timeZone);
    return `${pad(p.h)}:${pad(p.mi)}`;
  });
  const [toTime, setToTime] = useState(() => {
    if (!initial) return "23:59";
    const p = zonedParts(initial.to, timeZone);
    return `${pad(p.h)}:${pad(p.mi)}`;
  });

  // What the choice adds up to, and why it cannot be applied yet, if it cannot
  const outcome = useMemo((): { from: number; to: number } | { problem: string } => {
    if (!range?.from) return { problem: "Pick a day on the calendar" };
    const from = instantOf(range.from, fromTime, timeZone);
    const to = instantOf(range.to ?? range.from, toTime, timeZone);
    if (from === null || to === null) return { problem: "Enter both times" };
    if (to <= from) return { problem: "The end must come after the start" };
    if (to - from < MIN_SPAN_MS) return { problem: "At least 15 minutes" };
    if (to - from > MAX_SPAN_MS) return { problem: "A year at most" };
    if (from > now) return { problem: "That is still in the future" };
    return { from, to: Math.min(to, now) };
  }, [range, fromTime, toTime, timeZone, now]);

  const zone = tzAbbrev(now, timeZone);
  const twoYearsAgo = useMemo(() => new TZDate(today.getFullYear() - 2, today.getMonth(), 1, timeZone), [today, timeZone]);

  // On the body, not inside the chart: the panel's own layers would put the phone's navigation
  // bar on top of the sheet. Only ever rendered in the browser (loaded without SSR).
  return createPortal(
    <>
      {/* A sheet from the bottom on a phone, a card in the middle of the screen on a desk — the
          unit panel is too narrow to hold a calendar beside its buttons */}
      <div className="fixed inset-0 z-40 bg-ink/30" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-label="Choose a period"
        className="fixed inset-x-0 bottom-0 z-50 max-h-[92vh] overflow-y-auto rounded-t-2xl border border-line bg-panel p-4 shadow-xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[21rem] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl"
      >
        <div className="mb-2 flex items-baseline justify-between">
          <div className="text-sm font-semibold">Choose a period</div>
          <div className="text-xs text-faint">Restaurant time · {zone}</div>
        </div>

        <div className="flex justify-center" style={CALENDAR_STYLE}>
          <DayPicker
            mode="range"
            selected={range}
            onSelect={setRange}
            timeZone={timeZone}
            today={today}
            disabled={{ after: today }}
            startMonth={twoYearsAgo}
            endMonth={today}
            defaultMonth={range?.from ?? today}
            numberOfMonths={1}
            showOutsideDays
          />
        </div>

        <div className="mt-2 grid grid-cols-2 gap-3">
          <label className="text-xs text-muted">
            From
            <input
              type="time"
              value={fromTime}
              onChange={(e) => setFromTime(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line bg-panel px-2.5 py-1.5 text-sm text-ink"
            />
          </label>
          <label className="text-xs text-muted">
            Until
            <input
              type="time"
              value={toTime}
              onChange={(e) => setToTime(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line bg-panel px-2.5 py-1.5 text-sm text-ink"
            />
          </label>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="min-h-4 text-xs text-faint">{"problem" in outcome ? outcome.problem : ""}</div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={"problem" in outcome}
              onClick={() => {
                if (!("problem" in outcome)) onApply(outcome.from, outcome.to);
              }}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
