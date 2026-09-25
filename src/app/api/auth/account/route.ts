import { NextRequest } from "next/server";
import { deleteAccountSchema } from "@/lib/auth/validation";
import { deleteAccount } from "@/lib/auth/service";
import { getSession, destroySession } from "@/lib/auth/session";
import { parseBody, json, unauthorized } from "@/lib/auth/http";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/auth/account {password} — removes the account; sensor data is not affected.
 *
 * Only Qimby's own team may do this to their own account. For everyone in an organization the
 * spec replaces self-deletion with deactivation by an owner: a technician who leaves still has
 * their name on the reports that explain what happened to a compressor, and a record that
 * could delete itself would take that with it.
 */
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.user.role !== "admin") {
    return json(
      { error: "forbidden", message: "Ask the owner of your organization to deactivate your account" },
      403,
    );
  }

  const parsed = await parseBody(req, deleteAccountSchema);
  if (!parsed.ok) return parsed.response;

  const result = await deleteAccount(session.user.id, parsed.data.password);
  if (!result.ok) return json({ error: result.code, message: result.message }, result.status);

  await destroySession().catch(() => undefined); // sessions are already gone; this clears the cookie
  return json({ status: "account_deleted" });
}
