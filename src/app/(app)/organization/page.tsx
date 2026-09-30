"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, X, Pencil, Check, Power, UserPlus, MapPin } from "lucide-react";
import PageShell from "@/components/PageShell";
import { useMe } from "@/components/SessionProvider";
import { organizationApi, type OrganizationView, type LocationRow, type Person, type LocationInput } from "@/lib/team-client";
import { canManageLocations } from "@/lib/auth/permissions";
import { US_TIMEZONES, defaultTimezone } from "@/lib/geocode";
import { fullAddress } from "@/lib/api";

/**
 * The owner's table: one row per restaurant, who is on it, and the restaurant itself.
 *
 * Agreed with the client on 30 Sep 2026. The owner adds restaurants and assigns a manager and
 * technicians to each; Qimby adds the equipment and the sensors at installation. People are
 * invited on the Team page and then placed here. A restaurant is never deleted, only closed:
 * it drops off every list and raises nothing, and comes back from this page.
 */

const btn = {
  primary: "inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-60",
  secondary: "inline-flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-offline-soft disabled:opacity-60",
  icon: "flex size-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-offline-soft hover:text-ink disabled:opacity-40",
};
const input = "w-full rounded-lg border border-line bg-page px-3 py-2 text-sm outline-none focus:border-primary";

const label = (p: Person) => p.name ?? p.email;

/** Chips of who is here, plus a picker for who else could be. */
function PeopleCell({ chosen, pool, noun, onChange, disabled }: {
  chosen: Person[];
  pool: Person[];
  noun: string;
  onChange: (ids: string[]) => void;
  disabled: boolean;
}) {
  const ids = chosen.map((p) => p.id);
  const rest = pool.filter((p) => !ids.includes(p.id));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chosen.map((p) => (
        <span key={p.id} className={`inline-flex items-center gap-1 rounded-full border border-line bg-page px-2.5 py-0.5 text-xs ${p.status === "invited" ? "text-muted" : ""}`} title={p.status === "invited" ? `${p.email} — invited, not signed in yet` : p.email}>
          {label(p)}
          {!disabled && (
            <button title={`Remove ${label(p)}`} onClick={() => onChange(ids.filter((x) => x !== p.id))} className="text-muted hover:text-alert"><X size={11} /></button>
          )}
        </span>
      ))}
      {!disabled && rest.length > 0 && (
        <select value="" onChange={(e) => { if (e.target.value) onChange([...ids, e.target.value]); }} className="rounded-lg border border-dashed border-line bg-transparent px-2 py-0.5 text-xs text-muted outline-none focus:border-primary" title={`Add a ${noun}`}>
          <option value="">+ {noun}</option>
          {rest.map((p) => <option key={p.id} value={p.id}>{label(p)}</option>)}
        </select>
      )}
      {chosen.length === 0 && (disabled || rest.length === 0) && <span className="text-xs text-faint">—</span>}
    </div>
  );
}

function LocationModal({ existing, onClose, onSaved }: { existing: LocationRow | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<LocationInput>({
    name: existing?.name ?? "",
    address: existing?.address ?? "",
    city: existing?.city ?? "",
    state: existing?.state ?? "",
    zip: existing?.zip ?? "",
    timezone: existing?.timezone ?? "America/New_York",
  });
  const [zoneTouched, setZoneTouched] = useState(Boolean(existing));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof LocationInput, v: string) => {
    setForm((f) => {
      const next = { ...f, [k]: v };
      // The state decides the zone until the owner picks one themselves.
      if (k === "state" && !zoneTouched && v.length === 2) next.timezone = defaultTimezone(v);
      return next;
    });
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    const r = existing ? await organizationApi.updateLocation(existing.id, form) : await organizationApi.addLocation(form);
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    onSaved();
  };

  const field = (k: keyof LocationInput, title: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{title}</span>
      <input value={form[k] ?? ""} onChange={(e) => set(k, e.target.value)} className={input} {...extra} />
    </label>
  );

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-ink/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-panel p-6 shadow-xl">
        <div className="mb-1 text-lg font-semibold">{existing ? "Edit restaurant" : "Add a restaurant"}</div>
        <p className="mb-4 text-xs text-muted">The address places it on the map. Equipment and sensors are added by Qimby at installation.</p>
        <div className="space-y-3">
          {field("name", "Name", { placeholder: "Burger King #6816", autoFocus: true })}
          {field("address", "Street address", { placeholder: "1234 Hamner Ave" })}
          <div className="grid grid-cols-[1fr_4.5rem_6rem] gap-2">
            {field("city", "City")}
            {field("state", "State", { placeholder: "CA", maxLength: 2 })}
            {field("zip", "ZIP", { placeholder: "92860", inputMode: "numeric" })}
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Time zone</span>
            <select value={form.timezone} onChange={(e) => { setZoneTouched(true); set("timezone", e.target.value); }} className={input}>
              {US_TIMEZONES.map((z) => <option key={z} value={z}>{z.replace("_", " ").replace("America/", "").replace("Pacific/", "")}</option>)}
            </select>
          </label>
        </div>
        {error && <p className="mt-3 text-sm text-alert">{error}</p>}
        <div className="mt-5 flex justify-end gap-3">
          <button onClick={onClose} disabled={busy} className={btn.secondary}>Cancel</button>
          <button onClick={() => void save()} disabled={busy || !form.name.trim() || !form.address.trim() || !form.city.trim() || form.state.length !== 2 || !form.zip.trim()} className={btn.primary}>
            {busy ? "Placing on the map…" : existing ? "Save" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ l, view, onChanged, onEdit, onError }: {
  l: LocationRow;
  view: OrganizationView;
  onChanged: () => void;
  onEdit: (l: LocationRow) => void;
  onError: (m: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(l.name);
  const [busy, setBusy] = useState(false);

  const patch = async (p: Parameters<typeof organizationApi.updateLocation>[1]) => {
    setBusy(true);
    const r = await organizationApi.updateLocation(l.id, p);
    setBusy(false);
    if (!r.ok) return onError(r.error.message);
    setRenaming(false);
    onChanged();
  };
  const closed = !l.active;

  return (
    <tr className={`border-b border-line-soft last:border-0 ${closed ? "text-muted" : ""}`}>
      <td className="px-4 py-3 align-top">
        {renaming ? (
          <div className="flex items-center gap-1">
            <input value={name} onChange={(e) => setName(e.target.value)} className={`${input} py-1`} autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") void patch({ name }); if (e.key === "Escape") setRenaming(false); }} />
            <button title="Save" className={btn.icon} onClick={() => void patch({ name })}><Check size={14} /></button>
            <button title="Cancel" className={btn.icon} onClick={() => { setRenaming(false); setName(l.name); }}><X size={14} /></button>
          </div>
        ) : (
          <div className="flex items-start gap-1">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-ink">{l.name}</span>
                {closed && <span className="rounded-full bg-offline-soft px-2 py-0.5 text-[11px] font-medium text-offline">Closed</span>}
              </div>
              <div className="text-xs text-muted">{fullAddress(l)}</div>
              <div className="text-xs text-faint">{l.unitsTotal ? `${l.unitsTotal} units` : "No equipment yet"}</div>
            </div>
            {!closed && <button title="Rename" className={btn.icon} onClick={() => setRenaming(true)}><Pencil size={13} /></button>}
          </div>
        )}
      </td>
      <td className="px-3 py-3 align-top text-sm">{view.owners.map(label).join(", ") || <span className="text-faint">—</span>}</td>
      <td className="px-3 py-3 align-top">
        <PeopleCell chosen={l.managers} pool={view.managers} noun="manager" disabled={closed || busy} onChange={(ids) => void patch({ managerIds: ids })} />
      </td>
      <td className="px-3 py-3 align-top">
        <PeopleCell chosen={l.technicians} pool={view.technicians} noun="technician" disabled={closed || busy} onChange={(ids) => void patch({ technicianIds: ids })} />
      </td>
      <td className="px-2 py-3 align-top">
        <div className="flex items-center justify-end gap-0.5">
          {!closed && <button title="Edit address" className={btn.icon} onClick={() => onEdit(l)}><MapPin size={14} /></button>}
          <button
            title={closed ? "Reopen restaurant" : "Close restaurant"}
            className={`${btn.icon} ${closed ? "hover:text-ok" : "hover:text-alert"}`}
            disabled={busy}
            onClick={() => {
              if (closed || window.confirm(`Close ${l.name}? It disappears from every list and raises no alerts until reopened. Nothing recorded is lost.`)) {
                void patch({ active: closed });
              }
            }}
          >
            <Power size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function OrganizationPage() {
  const me = useMe();
  const [view, setView] = useState<OrganizationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ kind: "add" } | { kind: "edit"; l: LocationRow } | null>(null);

  // Bumping the tick refetches; state is set in the callback, never in the effect body.
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);
  useEffect(() => {
    let alive = true;
    organizationApi.view().then((r) => {
      if (!alive) return;
      if (!r.ok) return setError(r.error.message);
      setView(r.data);
      setError(null);
    });
    return () => { alive = false; };
  }, [tick]);

  const nobody = useMemo(() => view && view.managers.length + view.technicians.length === 0, [view]);

  if (!canManageLocations(me)) {
    return <PageShell title="Restaurants & people"><p className="text-sm text-muted">Only an owner manages restaurants.</p></PageShell>;
  }

  return (
    <PageShell
      title={view ? `${view.organization.name}` : "Restaurants & people"}
      actions={
        <div className="flex items-center gap-2">
          <Link href="/team" className={btn.secondary}><UserPlus size={16} /> Invite people</Link>
          <button onClick={() => setModal({ kind: "add" })} className={btn.primary}><Plus size={16} /> Add restaurant</button>
        </div>
      }
    >
      {error && <p className="text-sm text-alert">{error}</p>}
      {rowError && (
        <div className="mb-4 rounded-lg border border-alert/30 bg-alert-soft px-4 py-2.5 text-sm text-alert">
          {rowError} <button onClick={() => setRowError(null)} className="ml-2 opacity-70 hover:opacity-100">✕</button>
        </div>
      )}
      {view === null && !error && <div className="h-24 animate-pulse rounded-xl bg-panel" />}

      {view && nobody && (
        <p className="mb-4 rounded-xl border border-line bg-panel px-4 py-3 text-sm text-muted">
          Nobody to assign yet. <Link href="/team" className="text-accent hover:underline">Invite a manager or a technician</Link>, then place them on a restaurant here.
        </p>
      )}

      {view && (
        <div className="overflow-x-auto rounded-xl border border-line bg-panel">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-4 py-2.5 font-medium">Restaurant</th>
                <th className="px-3 py-2.5 font-medium">Owner</th>
                <th className="px-3 py-2.5 font-medium">District manager</th>
                <th className="px-3 py-2.5 font-medium">Technician</th>
                <th className="w-20 px-2 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {view.locations.map((l) => (
                <Row key={l.id} l={l} view={view} onChanged={reload} onEdit={(l) => setModal({ kind: "edit", l })} onError={setRowError} />
              ))}
              {view.locations.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-muted">No restaurants yet. Add the first one.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {modal?.kind === "add" && <LocationModal existing={null} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
      {modal?.kind === "edit" && <LocationModal existing={modal.l} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
    </PageShell>
  );
}
