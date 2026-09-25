"use client";

import { useEffect, useState } from "react";
import { Plus, X, Trash2, Check, Pencil, AlertTriangle } from "lucide-react";
import PageShell from "@/components/PageShell";
import { useMe } from "@/components/SessionProvider";
import { districtsApi, type DistrictsView, type DistrictView } from "@/lib/team-client";
import { canManageDistricts } from "@/lib/auth/permissions";

const btn = {
  primary: "inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-60",
  secondary: "inline-flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-offline-soft disabled:opacity-60",
  danger: "inline-flex items-center gap-2 rounded-lg bg-alert px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-60",
  icon: "flex size-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-offline-soft hover:text-ink",
};
const input = "rounded-lg border border-line bg-page px-3 py-2 text-sm outline-none focus:border-primary";

function DistrictCard({ d, unassigned, onChanged, onDelete }: {
  d: DistrictView;
  unassigned: { id: string; name: string }[];
  onChanged: () => void;
  onDelete: (d: DistrictView) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(d.name);
  const [error, setError] = useState<string | null>(null);

  const patch = async (p: { name?: string; locationIds?: string[] }) => {
    setError(null);
    const r = await districtsApi.update(d.id, p);
    if (!r.ok) return setError(r.error.message);
    setRenaming(false);
    onChanged();
  };
  const ids = d.locations.map((l) => l.id);

  return (
    <section className="rounded-xl border border-line bg-panel p-5">
      <div className="flex items-center gap-2">
        {renaming ? (
          <>
            <input value={name} onChange={(e) => setName(e.target.value)} className={`${input} flex-1`} autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") void patch({ name }); if (e.key === "Escape") setRenaming(false); }} />
            <button title="Save" className={btn.icon} onClick={() => void patch({ name })}><Check size={15} /></button>
            <button title="Cancel" className={btn.icon} onClick={() => { setRenaming(false); setName(d.name); }}><X size={15} /></button>
          </>
        ) : (
          <>
            <h2 className="flex-1 text-base font-semibold">{d.name}</h2>
            <button title="Rename" className={btn.icon} onClick={() => setRenaming(true)}><Pencil size={14} /></button>
            <button title="Delete district" className={`${btn.icon} hover:text-alert`} onClick={() => onDelete(d)}><Trash2 size={14} /></button>
          </>
        )}
      </div>

      <div className="mt-1 text-xs text-muted">
        {d.managers.length
          ? `Managed by ${d.managers.map((m) => m.name ?? m.email).join(", ")}`
          : "No manager yet — assign one on the Team page"}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {d.locations.map((l) => (
          <span key={l.id} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-page px-3 py-1 text-sm">
            {l.name}
            <button title={`Remove ${l.name} from ${d.name}`} onClick={() => void patch({ locationIds: ids.filter((x) => x !== l.id) })} className="text-muted hover:text-alert">
              <X size={13} />
            </button>
          </span>
        ))}
        {d.locations.length === 0 && <span className="text-sm text-muted">No locations in this district.</span>}
      </div>

      {unassigned.length > 0 && (
        <div className="mt-3">
          <select
            className={input}
            value=""
            onChange={(e) => { if (e.target.value) void patch({ locationIds: [...ids, e.target.value] }); }}
          >
            <option value="">Add a location…</option>
            {unassigned.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-alert">{error}</p>}
    </section>
  );
}

export default function DistrictsPage() {
  const me = useMe();
  const [view, setView] = useState<DistrictsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<DistrictView | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Bumping the tick refetches; state is set in the callback, never in the effect body.
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);
  useEffect(() => {
    let alive = true;
    districtsApi.list().then((r) => {
      if (!alive) return;
      if (!r.ok) return setError(r.error.message);
      setView(r.data);
    });
    return () => { alive = false; };
  }, [tick]);

  const create = async () => {
    setCreateError(null);
    const r = await districtsApi.create(newName);
    if (!r.ok) return setCreateError(r.error.message);
    setNewName("");
    setCreating(false);
    reload();
  };

  if (!canManageDistricts(me)) {
    return <PageShell title="Districts"><p className="text-sm text-muted">Only an owner manages districts.</p></PageShell>;
  }

  return (
    <PageShell
      title="Districts"
      actions={<button onClick={() => setCreating(true)} className={btn.primary}><Plus size={16} /> New district</button>}
    >
      {error && <p className="text-sm text-alert">{error}</p>}
      {view === null && !error && <div className="h-24 animate-pulse rounded-xl bg-panel" />}

      {creating && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-line bg-panel p-4">
          <div className="flex-1">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="District name" className={`${input} w-full`} autoFocus
              onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) void create(); if (e.key === "Escape") setCreating(false); }} />
            {createError && <p className="mt-1.5 text-xs text-alert">{createError}</p>}
          </div>
          <button onClick={() => void create()} disabled={!newName.trim()} className={btn.primary}>Create</button>
          <button onClick={() => { setCreating(false); setNewName(""); }} className={btn.secondary}>Cancel</button>
        </div>
      )}

      {view && (
        <div className="space-y-4">
          {view.districts.map((d) => (
            <DistrictCard key={d.id} d={d} unassigned={view.unassigned} onChanged={() => reload()} onDelete={setToDelete} />
          ))}
          {view.districts.length === 0 && !creating && (
            <p className="rounded-xl border border-line bg-panel p-5 text-sm text-muted">
              No districts yet. A district groups locations so a manager can be given several at once.
            </p>
          )}

          <section className="rounded-xl border border-dashed border-line p-5">
            <h2 className="text-sm font-semibold text-ink-soft">Not in any district</h2>
            <p className="mt-0.5 text-xs text-muted">Visible to owners only, until placed in a district.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {view.unassigned.map((l) => (
                <span key={l.id} className="rounded-full border border-line bg-page px-3 py-1 text-sm">{l.name}</span>
              ))}
              {view.unassigned.length === 0 && <span className="text-sm text-muted">Every location is in a district.</span>}
            </div>
          </section>
        </div>
      )}

      {toDelete && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-ink/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-panel p-6 shadow-xl">
            <div className="mb-2 flex items-center gap-2 text-lg font-semibold text-alert"><AlertTriangle size={18} /> Delete district</div>
            <p className="text-sm text-muted">
              <b>{toDelete.name}</b> will be removed.{" "}
              {toDelete.locations.length
                ? `Its ${toDelete.locations.length} location${toDelete.locations.length === 1 ? "" : "s"} will have no district and be visible to owners only.`
                : "It has no locations."}
              {toDelete.managers.length ? " Its managers lose it from their scope." : ""}
            </p>
            {deleteError && <p className="mt-3 text-sm text-alert">{deleteError}</p>}
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => { setToDelete(null); setDeleteError(null); }} className={btn.secondary}>Cancel</button>
              <button
                onClick={async () => {
                  const r = await districtsApi.remove(toDelete.id);
                  if (!r.ok) return setDeleteError(r.error.message);
                  setToDelete(null);
                  reload();
                }}
                className={btn.danger}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
