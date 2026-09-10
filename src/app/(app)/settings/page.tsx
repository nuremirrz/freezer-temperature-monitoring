import { getSession } from "@/lib/auth/session";
import Sidebar from "@/components/Sidebar";
import AccountActions from "@/components/settings/AccountActions";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = { admin: "Administrator" };

export default async function SettingsPage() {
  const session = await getSession();
  const user = session!.user; // the (app) layout guarantees a session

  const memberSince = user.createdAt.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="flex h-screen flex-col overflow-hidden md:flex-row">
      <Sidebar />
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl p-4 md:p-6">
          <h1 className="text-2xl font-semibold md:text-3xl">Settings</h1>
          <p className="mt-1 text-sm text-muted">Your account on Qimby.</p>

          <section className="mt-6 rounded-xl border border-line bg-panel p-5">
            <h2 className="text-sm font-semibold">Account</h2>
            <dl className="mt-3 divide-y divide-line-soft text-sm">
              <div className="flex justify-between gap-4 py-2.5">
                <dt className="text-muted">Name</dt>
                <dd className="font-medium">{user.name ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4 py-2.5">
                <dt className="text-muted">E-mail</dt>
                <dd className="font-medium">{user.email}</dd>
              </div>
              <div className="flex justify-between gap-4 py-2.5">
                <dt className="text-muted">Role</dt>
                <dd className="font-medium">{ROLE_LABEL[user.role] ?? user.role}</dd>
              </div>
              <div className="flex justify-between gap-4 py-2.5">
                <dt className="text-muted">Member since</dt>
                <dd className="font-medium">{memberSince}</dd>
              </div>
            </dl>
          </section>

          <AccountActions />
        </div>
      </main>
    </div>
  );
}
