import { NextRequest } from "next/server";
import { subscribe } from "@/lib/events";
import { getSession } from "@/lib/auth/session";
import { unauthorized } from "@/lib/auth/http";
import { visibleLocationIds, canSee } from "@/lib/auth/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;

/**
 * GET /api/stream — Server-Sent Events.
 * Events: `reading` and `alert` (see lib/events.ts), plus a `hello` on connect
 * and a comment heartbeat every 25 s so proxies keep the connection open.
 * Clients that can't hold SSE should poll /api/locations every 60 s instead.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();

  // Resolved once per connection. Filtering here is what actually keeps one client's
  // readings away from another: the screens hide other restaurants, but without this the
  // stream would still push their every reading into the browser.
  const visible = await visibleLocationIds(session);

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const send = (event: string, data: unknown) =>
        write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      send("hello", { now: new Date().toISOString(), heartbeatMs: HEARTBEAT_MS });

      const unsubscribe = subscribe((ev) => {
        if (!canSee(visible, ev.data.locationId)) return;
        send(ev.type, ev.data);
      });
      const heartbeat = setInterval(() => write(`: ping ${Date.now()}\n\n`), HEARTBEAT_MS);

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
