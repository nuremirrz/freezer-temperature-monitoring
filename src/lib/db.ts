import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { __qimbyPrisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set — copy .env.example to .env");
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

// One client per process; survives Next.js HMR in development
export const prisma: PrismaClient = globalForPrisma.__qimbyPrisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.__qimbyPrisma = prisma;
