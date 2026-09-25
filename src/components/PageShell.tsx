"use client";

import Sidebar from "./Sidebar";

/**
 * The frame for screens that are not the map: the same sidebar, a scrolling column of content.
 * The locations screen keeps its own layout because the map has to survive navigation.
 */
export default function PageShell({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen flex-col overflow-hidden md:flex-row">
      <Sidebar />
      <main className="min-h-0 flex-1 overflow-y-auto bg-page">
        <div className="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-8">
          <header className="mb-6 flex items-center justify-between gap-4">
            <h1 className="text-xl font-semibold">{title}</h1>
            {actions}
          </header>
          {children}
        </div>
      </main>
    </div>
  );
}
