"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { MapPin, ClipboardCheck, LineChart, Bell, Settings, LogOut } from "lucide-react";
import { authApi } from "@/lib/auth-client";
import QimbyMark from "./QimbyMark";

/**
 * The BK6816 release ships the map only; everything else is visible but inert so the
 * shape of the product still reads, per the ТЗ ("остальные иконки убрать или сделать
 * неактивными"). Log Out stays.
 */
const NAV = [{ href: "/locations", title: "Locations", icon: MapPin }] as const;

const COMING_SOON = [
  { title: "Maintenance Compliance", icon: ClipboardCheck },
  { title: "Settings", icon: Settings },
  { title: "Reports", icon: LineChart },
  { title: "Alerts", icon: Bell },
] as const;

export default function Sidebar() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  const handleLogout = async () => {
    await authApi.logout();
    router.push("/login?signed_out=1");
    router.refresh();
  };

  return (
    <>
      <aside className="z-20 order-last flex w-full shrink-0 items-center justify-around border-t border-line bg-panel px-2 py-1.5 md:order-first md:h-full md:w-16 md:flex-col md:justify-start md:border-t-0 md:border-r md:px-0 md:py-4">
        <Link href="/locations" className="mb-6 hidden md:block">
          <QimbyMark size={36} />
        </Link>

        <nav className="flex flex-1 items-center justify-around gap-1 md:flex-none md:flex-col md:justify-start md:gap-2">
          {NAV.map(({ href, title, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                title={title}
                className={`flex size-10 items-center justify-center rounded-lg transition-colors ${
                  active
                    ? "bg-offline-soft text-ink"
                    : "text-muted hover:bg-offline-soft hover:text-ink"
                }`}
              >
                <Icon size={20} />
              </Link>
            );
          })}
          {COMING_SOON.map(({ title, icon: Icon }) => (
            <button
              key={title}
              title={`${title} (coming soon)`}
              disabled
              className="flex size-10 cursor-not-allowed items-center justify-center rounded-lg text-faint/70"
            >
              <Icon size={20} />
            </button>
          ))}
        </nav>

        <div className="md:mt-auto">
          <button
            title="Log out"
            onClick={() => setConfirmOpen(true)}
            className="flex size-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-offline-soft hover:text-ink"
          >
            <LogOut size={20} />
          </button>
        </div>
      </aside>

      {confirmOpen && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-ink/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-panel p-6 shadow-xl">
            <div className="mb-1 text-lg font-semibold">Log out</div>
            <p className="mb-6 text-sm text-muted">
              Are you sure you want to log out?
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmOpen(false)}
                className="rounded-lg border border-line px-5 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-offline-soft"
              >
                No
              </button>
              <button
                onClick={handleLogout}
                className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
