import { NextRequest } from "next/server";
import { deleteAccountSchema } from "@/lib/auth/validation";
import { deleteAccount } from "@/lib/auth/service";
import { getSession, destroySession } from "@/lib/auth/session";
import { parseBody, json, unauthorized } from "@/lib/auth/http";

export const dynamic = "force-dynamic";

/** DELETE /api/auth/account {password} — removes the account; sensor data is not affected. */
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();

  const parsed = await parseBody(req, deleteAccountSchema);
  if (!parsed.ok) return parsed.response;

  const result = await deleteAccount(session.user.id, parsed.data.password);
  if (!result.ok) return json({ error: result.code, message: result.message }, result.status);

  await destroySession().catch(() => undefined); // sessions are already gone; this clears the cookie
  return json({ status: "account_deleted" });
}
