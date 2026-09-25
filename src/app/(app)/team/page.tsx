"use client";

import { useEffect, useMemo, useState } from "react";
import { UserPlus, Mail, MailX, UserX, Pencil, AlertTriangle } from "lucide-react";
import PageShell from "@/components/PageShell";
import { useMe } from "@/components/SessionProvider";
import { teamApi, districtsApi, type Member, type DistrictView } from "@/lib/team-client";
import { api, type LocationSummary } from "@/lib/api";
import { canManageTeam, canManageDistricts, invitableRoles } from "@/lib/auth/permissions";
import type { UserRole } from "@/generated/prisma/client";

const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Qimby",
  owner: "Owner",
  district_manager: "District manager",
  technician: "Technician",
};

const btn = {
  primary: "inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-60",
  secondary: "inline-flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-offline-soft disabled:opacity-60",
  danger: "inline-flex items-center gap-2 rounded-lg bg-alert px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-60",
  icon: "flex size-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-offline-soft hover:text-ink disabled:opacity-40",
};
const input = "w-full rounded-lg border border-line bg-page px-3 py-2 text-sm outline-none focus:border-primary";

function StatusBadge({ m }: { m: Member }) {
  if (m.status === "active") return <span className="rounded-full bg-ok-soft px-2 py-0.5 text-xs font-medium text-ok">Active</span>;
  if (m.status === "deactivated") return <span className="rounded-full bg-offline-soft px-2 py-0.5 text-xs font-medium text-offline">Deactivated</span>;
  return (
    <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">
      {m.invite?.expired ? "Invite expired" : "Invited"}
    </span>
  );
}

function scopeSummary(m: Member): string {
  if (m.role === "owner") return "Whole organization";
  if (m.role === "district_manager") return m.districts.length ? m.districts.map((d) => d.name).join(", ") : "No districts yet";
  return m.locations.length ? m.locations.map((l) => l.name).join(", ") : "No locations yet";
}

/** Pick which districts (for a manager) or locations (for a technician) an account may reach. */
function ScopePicker({
  role,
  districts,
  locations,
  districtIds,
  locationIds,
  onChange,
}: {
  role: UserRole;
  districts: DistrictView[];
  locations: LocationSummary[];
  districtIds: string[];
  locationIds: string[];
  onChange: (next: { districtIds: string[]; locationIds: string[] }) => void;
}) {
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  if (role === "district_manager") {
    return (
      <fieldset>
        <legend className="mb-1.5 text-xs font-medium text-muted">Districts</legend>
        {districts.length === 0 && <p className="text-xs text-muted">No districts exist yet — create some first.</p>}
        <div className="grid gap-1.5 sm:grid-cols-2">
          {districts.map((d) => (
            <label key={d.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
              <input type="checkbox" checked={districtIds.includes(d.id)} onChange={() => onChange({ districtIds: toggle(districtIds, d.id), locationIds: [] })} />
              <span className="truncate">{d.name}</span>
              <span className="ml-auto text-xs text-muted">{d.locations.length}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  if (role === "technician") {
    return (
      <fieldset>
        <legend className="mb-1.5 text-xs font-medium text-muted">Locations</legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {locations.map((l) => (
            <label key={l.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
              <input type="checkbox" checked={locationIds.includes(l.id)} onChange={() => onChange({ districtIds: [], locationIds: toggle(locationIds, l.id) })} />
              <span className="truncate">{l.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  return <p className="text-xs text-muted">An owner sees the whole organization.</p>;
}

function MemberModal({
  existing,
  districts,
  locations,
  roles,
  onClose,
  onSaved,
}: {
  existing: Member | null;
  districts: DistrictView[];
  locations: LocationSummary[];
  roles: readonly UserRole[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [email, setEmail] = useState(existing?.email ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [role, setRole] = useState<UserRole>(existing?.role ?? roles[0]);
  const [scope, setScope] = useState({
    districtIds: existing?.districts.map((d) => d.id) ?? [],
    locationIds: existing?.locations.map((l) => l.id) ?? [],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    const res = existing
      ? await teamApi.update(existing.id, { name, role, ...scope })
      : await teamApi.invite({ email, name: name || undefined, role, ...scope });
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-ink/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-panel p-6 shadow-xl">
        <div className="mb-4 text-lg font-semibold">{existing ? "Edit member" : "Invite someone"}</div>
        <div className="space-y-3">
          {!existing && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">Work e-mail</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} autoFocus />
            </label>
          )}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className={input} placeholder="Optional" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Role</span>
            <select
              value={role}
              onChange={(e) => {
                setRole(e.target.value as UserRole);
                // A new role starts with a clean scope — the same rule the server applies.
                setScope({ districtIds: [], locationIds: [] });
              }}
              className={input}
              disabled={roles.length === 1}
            >
              {roles.map((r) => (
                <option key={r} value={r}>{ROLE_LABEL[r]}</option>
              ))}
            </select>
          </label>
          <ScopePicker role={role} districts={districts} locations={locations} {...scope} onChange={setScope} />
        </div>
        {error && <p className="mt-3 text-sm text-alert">{error}</p>}
        <div className="mt-5 flex justify-end gap-3">
          <button onClick={onClose} disabled={busy} className={btn.secondary}>Cancel</button>
          <button onClick={save} disabled={busy || (!existing && !email)} className={btn.primary}>
            {busy ? "Saving…" : existing ? "Save" : "Send invitation"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Confirm({ title, body, action, danger, onClose, onConfirm }: {
  title: string; body: string; action: string; danger?: boolean; onClose: () => void; onConfirm: () => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-ink/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-panel p-6 shadow-xl">
        <div className={`mb-2 flex items-center gap-2 text-lg font-semibold ${danger ? "text-alert" : ""}`}>
          {danger && <AlertTriangle size={18} />} {title}
        </div>
        <p className="text-sm text-muted">{body}</p>
        {error && <p className="mt-3 text-sm text-alert">{error}</p>}
        <div className="mt-5 flex justify-end gap-3">
          <button onClick={onClose} disabled={busy} className={btn.secondary}>Cancel</button>
          <button
            onClick={async () => { setBusy(true); const e = await onConfirm(); setBusy(false); if (e) setError(e); }}
            disabled={busy}
            className={danger ? btn.danger : btn.primary}
          >
            {busy ? "…" : action}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TeamPage() {
  const me = useMe();
  const roles = useMemo(() => invitableRoles(me), [me]);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [districts, setDistricts] = useState<DistrictView[]>([]);
  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ kind: "invite" } | { kind: "edit"; m: Member } | { kind: "deactivate"; m: Member } | { kind: "revoke"; m: Member } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Bumping the tick refetches; state is set in the callback, never in the effect body.
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);

  useEffect(() => {
    let alive = true;
    Promise.all([
      teamApi.list(),
      api.locations().then((r) => r.locations).catch(() => [] as LocationSummary[]),
      canManageDistricts(me) ? districtsApi.list() : Promise.resolve(null),
    ]).then(([team, locs, dist]) => {
      if (!alive) return;
      if (!team.ok) return setError(team.error.message);
      setMembers(team.data.members);
      setLocations(locs);
      if (dist?.ok) setDistricts(dist.data.districts);
    });
    return () => { alive = false; };
  }, [me, tick]);

  const done = (msg?: string) => { setModal(null); if (msg) setNotice(msg); reload(); };

  if (!canManageTeam(me) && roles.length === 0) {
    return (
      <PageShell title="Team">
        <p className="text-sm text-muted">Technicians do not manage the team.</p>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Team"
      actions={roles.length > 0 && (
        <button onClick={() => setModal({ kind: "invite" })} className={btn.primary}>
          <UserPlus size={16} /> Invite
        </button>
      )}
    >
      {notice && (
        <div className="mb-4 rounded-lg border border-line bg-panel px-4 py-2.5 text-sm text-ink-soft">
          {notice} <button onClick={() => setNotice(null)} className="ml-2 text-muted hover:text-ink">✕</button>
        </div>
      )}
      {error && <p className="text-sm text-alert">{error}</p>}
      {members === null && !error && <div className="h-24 animate-pulse rounded-xl bg-panel" />}
      {members && members.length === 0 && (
        <p className="rounded-xl border border-line bg-panel p-5 text-sm text-muted">Nobody yet. Invite the first person.</p>
      )}
      {members && members.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-line bg-panel">
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 border-b border-line-soft px-4 py-3 last:border-b-0">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-offline-soft text-sm font-semibold uppercase text-ink-soft">
                {(m.name ?? m.email)[0]}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">{m.name ?? m.email}</span>
                  <span className="text-xs text-muted">{ROLE_LABEL[m.role]}</span>
                  <StatusBadge m={m} />
                  {m.id === me.id && <span className="text-xs text-faint">you</span>}
                </div>
                <div className="truncate text-xs text-muted">{m.name ? `${m.email} · ` : ""}{scopeSummary(m)}</div>
              </div>
              {canManageTeam(me) && m.status !== "deactivated" && (
                <div className="flex shrink-0 items-center gap-0.5">
                  {m.status === "invited" && (
                    <>
                      <button title="Resend invitation" className={btn.icon}
                        onClick={async () => { const r = await teamApi.resendInvite(m.id); done(r.ok ? `Invitation sent again to ${m.email}` : r.error.message); }}>
                        <Mail size={15} />
                      </button>
                      <button title="Withdraw invitation" className={btn.icon} onClick={() => setModal({ kind: "revoke", m })}>
                        <MailX size={15} />
                      </button>
                    </>
                  )}
                  <button title="Edit" className={btn.icon} onClick={() => setModal({ kind: "edit", m })}><Pencil size={15} /></button>
                  {m.status === "active" && (
                    <button title="Deactivate" className={btn.icon} onClick={() => setModal({ kind: "deactivate", m })}><UserX size={15} /></button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {modal?.kind === "invite" && (
        <MemberModal existing={null} districts={districts} locations={locations} roles={roles} onClose={() => setModal(null)} onSaved={() => done("Invitation sent")} />
      )}
      {modal?.kind === "edit" && (
        <MemberModal existing={modal.m} districts={districts} locations={locations} roles={roles} onClose={() => setModal(null)} onSaved={() => done()} />
      )}
      {modal?.kind === "deactivate" && (
        <Confirm
          title="Deactivate account" danger action="Deactivate"
          body={`${modal.m.name ?? modal.m.email} will be signed out everywhere and will not be able to sign in. Their name stays on everything they recorded.`}
          onClose={() => setModal(null)}
          onConfirm={async () => { const r = await teamApi.deactivate(modal.m.id); if (!r.ok) return r.error.message; done(); return null; }}
        />
      )}
      {modal?.kind === "revoke" && (
        <Confirm
          title="Withdraw invitation" action="Withdraw"
          body={`The link sent to ${modal.m.email} will stop working and the address can be invited again.`}
          onClose={() => setModal(null)}
          onConfirm={async () => { const r = await teamApi.revokeInvite(modal.m.id); if (!r.ok) return r.error.message; done(); return null; }}
        />
      )}
    </PageShell>
  );
}
