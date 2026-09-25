"use client";

import { createContext, useContext } from "react";
import type { UserRole, UserStatus } from "@/generated/prisma/client";

/**
 * The signed-in account, as the browser needs to know it: enough to decide what to draw.
 *
 * The app layout already holds the session, so it hands this down rather than having every
 * screen ask /api/auth/me again. Nothing here is a permission — permissions.ts decides those,
 * and the server decides them again on every request. This only lets a screen not draw a
 * button that would be refused.
 */
export interface Me {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  organizationId: string | null;
  status: UserStatus;
}

const MeContext = createContext<Me | null>(null);

export function SessionProvider({ me, children }: { me: Me; children: React.ReactNode }) {
  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}

/** The signed-in account. Only valid inside the app layout, which always has one. */
export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe() outside the app layout — there is no session here");
  return me;
}
