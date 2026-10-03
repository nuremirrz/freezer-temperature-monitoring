"use client";

import { useState } from "react";
import { X, Pencil } from "lucide-react";
import { api, ApiError, type UnitDetail, type PassportPatch } from "@/lib/api";
import { useLiveStore } from "@/store/useLiveStore";
import { useMe } from "./SessionProvider";
import { canEditPassport } from "@/lib/auth/permissions";
import { REFRIGERANTS } from "@/lib/auth/validation";
import UnitPhotos from "./UnitPhotos";

/**
 * The unit's passport: the nameplate and, for an AC, the parts a technician would buy.
 *
 * Read on the unit screen, edited in a popup. Every field optional, empty ones shown as "—"
 * rather than hidden, so what is missing is visible. Any role edits it, the technician first
 * of all — this is their main screen at the unit. Last write wins, per the spec.
 */

const AC_ONLY = ["belts", "capacitor", "filter"] as const;

const LABEL: Record<keyof PassportPatch, string> = {
  model: "Model",
  serial: "S/N",
  year: "Year",
  refrigerant: "Refrigerant",
  belts: "Belts",
  capacitor: "Capacitor",
  filter: "Filters",
};
const HINT: Partial<Record<keyof PassportPatch, string>> = {
  model: "TRANE 4TTR3036",
  serial: "14124JK3F",
  year: "2014",
  belts: "A42, 2 pcs",
  capacitor: "45/5 µF, 370V",
  filter: "20x25x1, 2 pcs",
};

/** Which fields this unit's passport has: the parts belong to an AC only. */
export function passportFields(unit: Pick<UnitDetail, "type">): (keyof PassportPatch)[] {
  const base: (keyof PassportPatch)[] = ["model", "serial", "year", "refrigerant"];
  return unit.type === "ac" ? [...base, ...AC_ONLY] : base;
}

const btn = {
  primary: "inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-60",
  secondary: "inline-flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-offline-soft disabled:opacity-60",
};
const input = "w-full rounded-lg border border-line bg-page px-3 py-2 text-sm outline-none focus:border-primary";

/** The label a field is shown under, on the card and in the popup alike. */
export function passportLabel(f: keyof PassportPatch): string {
  return LABEL[f];
}

export function PassportEditButton({ unit, locationId }: { unit: UnitDetail; locationId: string }) {
  const me = useMe();
  const [open, setOpen] = useState(false);
  if (!canEditPassport(me)) return null;
  return (
    <>
      <button onClick={() => setOpen(true)} className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5 text-sm font-medium text-ink-soft shadow-sm transition-colors hover:bg-offline-soft">
        <Pencil size={14} /> Edit details
      </button>
      {open && <PassportModal unit={unit} locationId={locationId} onClose={() => setOpen(false)} />}
    </>
  );
}

function PassportModal({ unit, locationId, onClose }: { unit: UnitDetail; locationId: string; onClose: () => void }) {
  const loadLocation = useLiveStore((s) => s.loadLocation);
  const fields = passportFields(unit);
  const known = (REFRIGERANTS as readonly string[]).includes(unit.refrigerant ?? "");
  const [form, setForm] = useState<Record<keyof PassportPatch, string>>({
    model: unit.model ?? "",
    serial: unit.serial ?? "",
    year: unit.year?.toString() ?? "",
    refrigerant: unit.refrigerant ?? "",
    belts: unit.belts ?? "",
    capacitor: unit.capacitor ?? "",
    filter: unit.filter ?? "",
  });
  // "Other" opens a text field; a value the list does not know starts there
  const [other, setOther] = useState(Boolean(unit.refrigerant) && !known);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof PassportPatch, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    const year = form.year.trim();
    if (year && !/^\d{4}$/.test(year)) return setError("Year is four digits");
    const patch: PassportPatch = {};
    for (const f of fields) {
      if (f === "year") patch.year = year ? Number(year) : null;
      else patch[f] = form[f].trim() || null;
    }
    setBusy(true);
    setError(null);
    try {
      await api.updatePassport(unit.id, patch);
      await loadLocation(locationId);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-ink/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-panel p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <div className="text-lg font-semibold">Unit passport</div>
            <div className="text-xs text-muted">{unit.name} · as written on the nameplate and the parts</div>
          </div>
          <button onClick={onClose} title="Close" className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-offline-soft hover:text-ink"><X size={16} /></button>
        </div>
        <div className="mb-4">
          <UnitPhotos unitId={unit.id} editable />
        </div>
        <div className="space-y-3">
          {fields.map((f) =>
            f === "refrigerant" ? (
              <label key={f} className="block">
                <span className="mb-1 block text-xs font-medium text-muted">{LABEL[f]}</span>
                <select
                  value={other ? "__other" : form.refrigerant}
                  onChange={(e) => {
                    if (e.target.value === "__other") { setOther(true); set("refrigerant", known ? "" : form.refrigerant); }
                    else { setOther(false); set("refrigerant", e.target.value); }
                  }}
                  className={input}
                >
                  <option value="">—</option>
                  {REFRIGERANTS.map((r) => <option key={r} value={r}>{r}</option>)}
                  <option value="__other">Other…</option>
                </select>
                {other && <input value={form.refrigerant} onChange={(e) => set("refrigerant", e.target.value)} placeholder="e.g. R-407C" className={`${input} mt-2`} autoFocus />}
              </label>
            ) : (
              <label key={f} className="block">
                <span className="mb-1 block text-xs font-medium text-muted">{LABEL[f]}</span>
                <input value={form[f]} onChange={(e) => set(f, e.target.value)} placeholder={HINT[f]} inputMode={f === "year" ? "numeric" : undefined} className={input} />
              </label>
            ),
          )}
        </div>
        {error && <p className="mt-3 text-sm text-alert">{error}</p>}
        <div className="mt-5 flex justify-end gap-3">
          <button onClick={onClose} disabled={busy} className={btn.secondary}>Cancel</button>
          <button onClick={() => void save()} disabled={busy} className={btn.primary}>{busy ? "Saving…" : "Save changes"}</button>
        </div>
      </div>
    </div>
  );
}
