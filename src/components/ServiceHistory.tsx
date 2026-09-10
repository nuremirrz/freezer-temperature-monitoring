"use client";

import { useMemo } from "react";
import { ClipboardCheck, Wrench, Plug, FlaskConical } from "lucide-react";
import { UnitDetail, UnitType } from "@/lib/api";
import { mulberry32, hashString, pick, intBetween } from "@/data/rng";

/**
 * DEMO CONTENT. There is no service-history table in the pilot backend yet, so these
 * records are generated from the unit id and clearly labelled in the UI. Replace with
 * a real `ServiceRecord` model once the client confirms technicians will file reports here.
 */

type ServiceType = "PM" | "Service" | "Installation";

interface Record_ {
  date: number;
  type: ServiceType;
  technician: string;
  notes: string;
}

const TECHNICIANS = ["Azat", "Eugenii"] as const;
const DAY = 24 * 60 * 60_000;

const PM_NOTES: Record<UnitType, string[]> = {
  freezer: [
    "Cleaned condenser coil, verified door seal",
    "Checked refrigerant charge, calibrated thermostat",
    "Inspected evaporator fan, cleared drain line",
  ],
  walk_in_cooler: [
    "Cleaned evaporator and condenser coils, checked door closer",
    "Verified refrigerant pressure, replaced door sweep",
  ],
  walk_in_freezer: [
    "Cleaned coils, inspected door heater and gasket",
    "Checked defrost timer, cleared drain heater line",
  ],
  ac: ["Replaced air filter, inspected blower motor", "Cleaned condenser coil, tested thermostat"],
};

const TYPE_META: Record<
  ServiceType,
  { icon: React.ComponentType<{ size?: number; className?: string }>; badge: string }
> = {
  PM: { icon: ClipboardCheck, badge: "bg-accent/10 text-accent" },
  Service: { icon: Wrench, badge: "bg-warn-soft text-warn" },
  Installation: { icon: Plug, badge: "bg-offline-soft text-ink-soft" },
};

function buildHistory(unit: UnitDetail): Record_[] {
  const rng = mulberry32(hashString(`${unit.id}:svc`));
  const now = Date.now();
  const out: Record_[] = [];

  for (let i = 1; i <= 3; i++) {
    out.push({
      date: now - i * intBetween(rng, 100, 130) * DAY,
      type: "PM",
      technician: pick(rng, TECHNICIANS),
      notes: pick(rng, PM_NOTES[unit.type]),
    });
  }
  if (unit.year) {
    out.push({
      date: new Date(unit.year, intBetween(rng, 1, 11), intBetween(rng, 1, 28)).getTime(),
      type: "Installation",
      technician: pick(rng, TECHNICIANS),
      notes: "Unit delivered, installed and commissioned",
    });
  }
  return out.sort((a, b) => b.date - a.date);
}

const fmtDate = (ts: number) =>
  new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function Badge({ type }: { type: ServiceType }) {
  const { icon: Icon, badge } = TYPE_META[type];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ${badge}`}
    >
      <Icon size={13} />
      {type}
    </span>
  );
}

export default function ServiceHistory({ unit }: { unit: UnitDetail }) {
  const records = useMemo(() => buildHistory(unit), [unit]);

  return (
    <div className="@container mt-4 rounded-xl border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 pb-3 md:px-5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Service History</span>
          <span
            title="Sample records — no service log in the database yet"
            className="inline-flex items-center gap-1 rounded-md bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn"
          >
            <FlaskConical size={12} /> Demo data
          </span>
        </div>
        <div className="text-xs text-muted">{records.length} records</div>
      </div>

      <div className="border-t border-line @md:hidden">
        {records.map((r, i) => (
          <div key={i} className="border-b border-line-soft px-4 py-3 last:border-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium tabular-nums">{fmtDate(r.date)}</span>
              <Badge type={r.type} />
            </div>
            <div className="mt-1 text-sm text-ink-soft">{r.notes}</div>
            <div className="mt-0.5 text-xs text-muted">{r.technician}</div>
          </div>
        ))}
      </div>

      <table className="hidden w-full border-t border-line text-sm @md:table">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="px-4 py-2.5 font-medium md:px-5">Date</th>
            <th className="px-2 py-2.5 font-medium">Service</th>
            <th className="px-2 py-2.5 font-medium">Technician</th>
            <th className="px-2 py-2.5 pr-4 font-medium md:pr-5">Notes</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r, i) => (
            <tr key={i} className="border-t border-line-soft">
              <td className="px-4 py-3 whitespace-nowrap font-medium tabular-nums md:px-5">
                {fmtDate(r.date)}
              </td>
              <td className="px-2 py-3">
                <Badge type={r.type} />
              </td>
              <td className="px-2 py-3 whitespace-nowrap text-ink-soft">{r.technician}</td>
              <td className="px-2 py-3 pr-4 text-ink-soft md:pr-5">{r.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
