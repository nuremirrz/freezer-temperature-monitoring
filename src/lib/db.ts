import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { __qimbyPrisma?: PrismaClient };

const isLocal = (url: string) => /@(localhost|127\.0\.0\.1|\[::1\])/.test(url);

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set — copy .env.example to .env");
  }
  // A script run with --prod asks for the production URL and sets it here before touching the
  // database. If the client is being built while the URL is still the local one, something was
  // imported ahead of that prompt and the run would quietly write to the wrong database while
  // announcing the right one — which is exactly what org:setup did on 13 Oct 2026.
  if (process.argv.includes("--prod") && isLocal(connectionString)) {
    throw new Error(
      "--prod was passed, but the database client is being created while DATABASE_URL still " +
        "points at localhost. Something imported src/lib/db before prodIfAsked() ran — import " +
        "it with `const { prisma } = await import(\"../src/lib/db\")` after the prompt, and make " +
        "sure no static import of this script reaches it either.",
    );
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

// One client per process; survives Next.js HMR in development
export const prisma: PrismaClient = globalForPrisma.__qimbyPrisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.__qimbyPrisma = prisma;
