"use client";

import { useState } from "react";
import { Pencil, Check, X } from "lucide-react";
import { api, UnitDetail, formatRange, ApiError } from "@/lib/api";
import { useLiveStore } from "@/store/useLiveStore";
import { useMe } from "./SessionProvider";
import { canEditRange } from "@/lib/auth/permissions";

/**
 * The normal range, editable in place.
 *
 * Per the BK6816 ТЗ each unit's range is set by hand: the right numbers depend on what the
 * equipment holds, and nobody can guess them from the unit type alone. Saving re-derives the
 * status server-side, so the panel reloads from the API rather than patching state here.
 */
export default function RangeEditor({ unit, locationId }: { unit: UnitDetail; locationId: string }) {
  const me = useMe();
  const loadLocation = useLiveStore((s) => s.loadLocation);
  const [editing, setEditing] = useState(false);
  const [min, setMin] = useState(String(unit.rangeMinF));
  const [max, setMax] = useState(String(unit.rangeMaxF));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A technician reads the range and never sets it — the same rule the server applies, drawn
  // rather than refused. No pencil, so nothing to click and be told "no" about.
  if (!canEditRange(me)) {
    return (
      <div className="mt-1.5 text-base font-semibold whitespace-nowrap tabular-nums @xs:text-lg @md:text-xl">
        {formatRange(unit)}
      </div>
    );
  }

  const open = () => {
    setMin(String(unit.rangeMinF));
    setMax(String(unit.rangeMaxF));
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    const lo = Number(min);
    const hi = Number(max);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      setError("Both ends must be numbers");
      return;
    }
    if (lo >= hi) {
      setError("The low end must be below the high end");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.updateUnit(unit.id, { rangeMinF: lo, rangeMaxF: hi });
      await loadLocation(locationId);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="flex items-start justify-between gap-2">
        <div className="mt-1.5 text-base font-semibold whitespace-nowrap tabular-nums @xs:text-lg @md:text-xl">
          {formatRange(unit)}
        </div>
        <button
          onClick={open}
          title="Edit normal range"
          aria-label="Edit normal range"
          className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-offline-soft hover:text-ink"
        >
          <Pencil size={13} />
        </button>
      </div>
    );
  }

  return (
    <div className="mt-1.5">
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          value={min}
          onChange={(e) => setMin(e.target.value)}
          disabled={saving}
          aria-label="Lowest normal temperature"
          className="w-full min-w-0 rounded-lg border border-line bg-page px-2 py-1 text-sm tabular-nums outline-none focus:border-primary"
        />
        <span className="text-xs text-muted">to</span>
        <input
          type="number"
          value={max}
          onChange={(e) => setMax(e.target.value)}
          disabled={saving}
          aria-label="Highest normal temperature"
          className="w-full min-w-0 rounded-lg border border-line bg-page px-2 py-1 text-sm tabular-nums outline-none focus:border-primary"
        />
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          <Check size={12} /> {saving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={() => setEditing(false)}
          disabled={saving}
          className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-ink-soft transition-colors hover:bg-offline-soft"
        >
          <X size={12} /> Cancel
        </button>
      </div>
      {error && <div className="mt-1.5 text-xs text-alert">{error}</div>}
    </div>
  );
}
