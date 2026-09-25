import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { SessionProvider } from "@/components/SessionProvider";

/**
 * Every screen inside the app requires a valid session, checked against the database.
 * The proxy only looks at cookie presence; this is the real gate. A cookie whose session
 * is gone is cleared via the logout route (server components can't write cookies).
 *
 * The account is handed down to client components so they can draw only what the role may
 * use. That is a courtesy, not a check — every request is checked again on the server.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/api/auth/logout?next=/login");
  const { id, email, name, role, organizationId, status } = session.user;
  return <SessionProvider me={{ id, email, name, role, organizationId, status }}>{children}</SessionProvider>;
}
