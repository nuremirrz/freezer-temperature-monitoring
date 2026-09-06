"use client";

import { ClipboardCheck, Wrench, Plug } from "lucide-react";
import { BKLocation, Unit } from "@/data/types";
import { getServiceHistory, formatDate, ServiceType } from "@/data/maintenance";

const TYPE_META: Record<
  ServiceType,
  { icon: React.ComponentType<{ size?: number; className?: string }>; badge: string }
> = {
  PM: { icon: ClipboardCheck, badge: "bg-accent/10 text-accent" },
  Service: { icon: Wrench, badge: "bg-warn-soft text-warn" },
  Installation: { icon: Plug, badge: "bg-offline-soft text-ink-soft" },
};

function ServiceBadge({ type }: { type: ServiceType }) {
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

export default function ServiceHistory({ unit, loc }: { unit: Unit; loc: BKLocation }) {
  const records = getServiceHistory(unit, loc);

  return (
    <div className="@container mt-4 rounded-xl border border-line bg-panel">
      <div className="flex items-center justify-between px-4 pt-4 pb-3 md:px-5">
        <div className="text-sm font-semibold">Service History</div>
        <div className="text-xs text-muted">{records.length} records</div>
      </div>

      {/* Stacked on narrow panels */}
      <div className="border-t border-line @md:hidden">
        {records.map((r, i) => (
          <div key={i} className="border-b border-line-soft px-4 py-3 last:border-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium tabular-nums">{formatDate(r.date)}</span>
              <ServiceBadge type={r.type} />
            </div>
            <div className="mt-1 text-sm text-ink-soft">{r.notes}</div>
            <div className="mt-0.5 text-xs text-muted">{r.technician}</div>
          </div>
        ))}
      </div>

      {/* Table when there is room */}
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
                {formatDate(r.date)}
              </td>
              <td className="px-2 py-3">
                <ServiceBadge type={r.type} />
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
