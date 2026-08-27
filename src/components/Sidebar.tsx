"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MapPin, LineChart, Bell, Settings, LogOut } from "lucide-react";
import { signOut } from "@/lib/auth";

export default function Sidebar() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const router = useRouter();

  const handleLogout = () => {
    signOut();
    router.push("/login");
  };

  return (
    <>
      <aside className="z-20 order-last flex w-full shrink-0 items-center justify-around border-t border-line bg-panel px-2 py-1.5 md:order-first md:h-full md:w-16 md:flex-col md:justify-start md:border-t-0 md:border-r md:px-0 md:py-4">
        <Link href="/locations" className="mb-6 hidden md:block">
          <Image src="/bk-logo.png" alt="Burger King" width={36} height={36} priority />
        </Link>

        <nav className="flex flex-1 items-center justify-around gap-1 md:flex-none md:flex-col md:justify-start md:gap-2">
          <Link
            href="/locations"
            title="Locations"
            className="flex size-10 items-center justify-center rounded-lg bg-offline-soft text-ink"
          >
            <MapPin size={20} />
          </Link>
          <button
            title="Reports (coming soon)"
            disabled
            className="flex size-10 cursor-not-allowed items-center justify-center rounded-lg text-faint/70"
          >
            <LineChart size={20} />
          </button>
          <button
            title="Alerts (coming soon)"
            disabled
            className="flex size-10 cursor-not-allowed items-center justify-center rounded-lg text-faint/70"
          >
            <Bell size={20} />
          </button>
          <button
            title="Settings (coming soon)"
            disabled
            className="flex size-10 cursor-not-allowed items-center justify-center rounded-lg text-faint/70"
          >
            <Settings size={20} />
          </button>
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
