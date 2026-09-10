import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";

/**
 * Every screen inside the app requires a valid session, checked against the database.
 * The proxy only looks at cookie presence; this is the real gate. A cookie whose session
 * is gone is cleared via the logout route (server components can't write cookies).
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/api/auth/logout?next=/login");
  return <>{children}</>;
}
