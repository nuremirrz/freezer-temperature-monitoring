"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import Sidebar from "@/components/Sidebar";
import { LOCATIONS } from "@/data/locations";
import { shortAddress } from "@/data/types";
import {
  getLocationPM,
  formatDate,
  pmYears,
  PMStatus,
  PM_VISITS_PER_YEAR,
  PM_INTERVAL_MONTHS,
} from "@/data/maintenance";

type Filter = "all" | "incomplete" | "overdue" | "complete";

const subscribeNoop = () => () => {};

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "incomplete", label: "Incomplete" },
  { key: "overdue", label: "Overdue" },
  { key: "complete", label: "Complete" },
];

const STATUS_ORDER: Record<PMStatus, number> = { overdue: 0, due: 1, complete: 2 };
const STATUS_LABEL: Record<PMStatus, string> = {
  complete: "Complete",
  due: "Due",
  overdue: "Overdue",
};
const STATUS_PILL: Record<PMStatus, string> = {
  complete: "bg-ok-soft text-ok",
  due: "bg-warn-soft text-warn",
  overdue: "bg-alert-soft text-alert",
};

function ProgressDots({ done, status }: { done: number; status: PMStatus }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-sm font-medium tabular-nums">
        {done}/{PM_VISITS_PER_YEAR}
      </span>
      <span className="flex gap-1">
        {Array.from({ length: PM_VISITS_PER_YEAR }).map((_, i) => {
          // done → green; the next pending visit shows how urgent it is
          let cls = "bg-line";
          if (i < done) cls = "bg-ok";
          else if (i === done) cls = status === "overdue" ? "bg-alert" : "bg-warn";
          return <span key={i} className={`size-2 rounded-full ${cls}`} />;
        })}
      </span>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  count,
  total,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  total: number;
}) {
  const pct = total ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-4 rounded-xl border border-line bg-panel p-4 md:p-5">
      {icon}
      <div>
        <div className="text-xs text-muted md:text-sm">{label}</div>
        <div className="text-2xl font-semibold tabular-nums md:text-3xl">{count}</div>
        <div className="text-xs text-faint">{pct}% of locations</div>
      </div>
    </div>
  );
}

export default function MaintenancePage() {
  const router = useRouter();
  // false during SSR/hydration, true once on the client
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const rows = useMemo(
    () =>
      LOCATIONS.map((l) => getLocationPM(l, year)).sort(
        (a, b) =>
          STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
          a.location.storeNumber - b.location.storeNumber,
      ),
    [year],
  );

  const counts = useMemo(() => {
    const c = { complete: 0, due: 0, overdue: 0 };
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "complete" && r.status !== "complete") return false;
      if (filter === "overdue" && r.status !== "overdue") return false;
      if (filter === "incomplete" && r.status === "complete") return false;
      if (!q) return true;
      return (
        r.location.name.toLowerCase().includes(q) ||
        r.location.city.toLowerCase().includes(q) ||
        String(r.location.storeNumber).includes(q)
      );
    });
  }, [rows, filter, query]);

  // Dates and statuses depend on "now" — render only on the client
  if (!mounted) return <div className="h-screen bg-page" />;

  return (
    <div className="flex h-screen flex-col overflow-hidden md:flex-row">
      <Sidebar />

      <main className="@container min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl p-4 md:p-6">
          <h1 className="text-2xl font-semibold md:text-3xl">Maintenance Compliance</h1>
          <p className="mt-1 text-sm text-muted">
            Track {PM_VISITS_PER_YEAR} preventive maintenance visits per year for every Burger
            King location.
          </p>

          {/* Summary — counted from the plan, not typed in */}
          <div className="mt-5 grid gap-3 @lg:grid-cols-3">
            <SummaryCard
              icon={<CheckCircle2 size={36} className="shrink-0 text-ok" strokeWidth={1.8} />}
              label={`Completed ${PM_VISITS_PER_YEAR}/${PM_VISITS_PER_YEAR}`}
              count={counts.complete}
              total={rows.length}
            />
            <SummaryCard
              icon={<Clock size={36} className="shrink-0 text-warn" strokeWidth={1.8} />}
              label="Needs Maintenance"
              count={counts.due}
              total={rows.length}
            />
            <SummaryCard
              icon={<AlertTriangle size={36} className="shrink-0 text-alert" strokeWidth={1.8} />}
              label="Overdue"
              count={counts.overdue}
              total={rows.length}
            />
          </div>

          {/* Controls */}
          <div className="mt-5 flex flex-col gap-3 @2xl:flex-row @2xl:items-center">
            <label className="flex flex-1 items-center gap-2.5 rounded-lg border border-line bg-panel px-3.5 py-2.5 focus-within:border-accent">
              <Search size={16} className="shrink-0 text-faint" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search locations…"
                className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
              />
            </label>

            <div className="flex overflow-x-auto rounded-lg border border-line bg-panel text-sm font-medium">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`flex-1 px-4 py-2.5 whitespace-nowrap transition-colors @2xl:flex-none ${
                    filter === f.key ? "bg-primary text-white" : "text-muted hover:text-ink"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <label className="relative flex items-center">
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="w-full appearance-none rounded-lg border border-line bg-panel py-2.5 pr-9 pl-3.5 text-sm font-medium outline-none focus:border-accent @2xl:w-auto"
              >
                {pmYears().map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
              <ChevronDown size={15} className="pointer-events-none absolute right-3 text-muted" />
            </label>
          </div>

          <p className="mt-3 text-xs text-faint">
            Contract requirement: {PM_VISITS_PER_YEAR} preventive maintenance visits per year.
            Next PM is due {PM_INTERVAL_MONTHS} months after the last completed visit.
          </p>

          {/* Table */}
          <div className="mt-3 overflow-hidden rounded-xl border border-line bg-panel">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-page/60 text-left text-xs text-muted">
                  <th className="px-4 py-3 font-medium">Location</th>
                  <th className="hidden px-3 py-3 font-medium @xl:table-cell">Address</th>
                  <th className="px-3 py-3 font-medium">Progress</th>
                  <th className="hidden px-3 py-3 font-medium @lg:table-cell">Last PM</th>
                  <th className="hidden px-3 py-3 font-medium @md:table-cell">Next PM</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr
                    key={r.location.id}
                    onClick={() => router.push(`/locations/${r.location.id}`)}
                    className="cursor-pointer border-b border-line-soft transition-colors last:border-0 hover:bg-page/60"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 font-medium">
                        {r.location.name}
                        <ChevronRight size={14} className="text-faint" />
                      </div>
                      <div className="text-xs text-muted @xl:hidden">{shortAddress(r.location)}</div>
                    </td>
                    <td className="hidden px-3 py-3 whitespace-nowrap text-muted @xl:table-cell">
                      {shortAddress(r.location)}
                    </td>
                    <td className="px-3 py-3">
                      <ProgressDots done={r.visits.length} status={r.status} />
                    </td>
                    <td className="hidden px-3 py-3 whitespace-nowrap tabular-nums text-muted @lg:table-cell">
                      {formatDate(r.lastPM)}
                    </td>
                    <td
                      className={`hidden px-3 py-3 whitespace-nowrap tabular-nums @md:table-cell ${
                        r.status === "overdue" ? "font-medium text-alert" : "text-muted"
                      }`}
                    >
                      {formatDate(r.nextPM)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-md px-2.5 py-0.5 text-xs font-medium ${STATUS_PILL[r.status]}`}
                      >
                        {STATUS_LABEL[r.status]}
                      </span>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted">
                      No locations match this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 text-xs text-faint">
            Showing {visible.length} of {rows.length} locations
          </div>
        </div>
      </main>
    </div>
  );
}
