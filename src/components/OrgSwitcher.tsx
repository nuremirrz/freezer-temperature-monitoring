"use client";

import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { useMe } from "./SessionProvider";
import { organizationApi } from "@/lib/team-client";

/**
 * Which customer Qimby's own team is looking at. An owner is inside one organization and
 * never sees this; an admin stands outside all of them and has to say, once there is more
 * than one. The choice is remembered in the browser so it survives a reload and carries from
 * the Team page to the Restaurants page.
 */

const KEY = "qimby.adminOrganization";

function remembered(): string | undefined {
  try {
    return window.localStorage.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function remember(id: string) {
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    // a private window: the choice lasts for the page, which is fine
  }
}

/**
 * The organization an admin has picked, or undefined while there is nothing to pick from.
 * Non-admins get undefined and the server uses their own organization.
 */
export function useAdminOrganization(): {
  organizationId: string | undefined;
  organizations: { id: string; name: string }[];
  choose: (id: string) => void;
  ready: boolean;
} {
  const me = useMe();
  const [organizations, setOrganizations] = useState<{ id: string; name: string }[]>([]);
  const [organizationId, setOrganizationId] = useState<string | undefined>(undefined);
  const [ready, setReady] = useState(me.role !== "admin");

  useEffect(() => {
    if (me.role !== "admin") return;
    let alive = true;
    organizationApi.list().then((r) => {
      if (!alive || !r.ok) return;
      const list = r.data.organizations;
      const saved = remembered();
      // The one remembered, if it still exists; otherwise the only one, if there is only one.
      const pick = list.find((o) => o.id === saved)?.id ?? (list.length === 1 ? list[0].id : undefined);
      setOrganizations(list);
      setOrganizationId(pick);
      setReady(true);
    });
    return () => { alive = false; };
  }, [me.role]);

  const choose = (id: string) => {
    remember(id);
    setOrganizationId(id);
  };
  return { organizationId, organizations, choose, ready };
}

export default function OrgSwitcher({ organizations, organizationId, onChange }: {
  organizations: { id: string; name: string }[];
  organizationId: string | undefined;
  onChange: (id: string) => void;
}) {
  const me = useMe();
  if (me.role !== "admin" || organizations.length < 2) return null;
  return (
    <label className="inline-flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-sm">
      <Building2 size={15} className="text-muted" />
      <select value={organizationId ?? ""} onChange={(e) => onChange(e.target.value)} className="bg-transparent outline-none">
        {organizationId === undefined && <option value="">Pick an organization…</option>}
        {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </label>
  );
}
