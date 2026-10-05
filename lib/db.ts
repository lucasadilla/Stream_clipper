import { PrismaClient } from "@prisma/client";
import { configureDatabaseUrl } from "@/lib/databaseReliability";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// DATABASE_URL is not available during `next build` in the Docker image.
// Only override the datasource when a URL exists; otherwise let Prisma
// resolve it lazily from the environment at connect time.
const databaseUrl = configureDatabaseUrl(process.env.DATABASE_URL, {
  connectionLimit: Number.parseInt(
    process.env.DATABASE_CONNECTION_LIMIT || "5",
    10
  ),
  poolTimeoutSeconds: Number.parseInt(
    process.env.DATABASE_POOL_TIMEOUT_SECONDS || "20",
    10
  ),
  connectTimeoutSeconds: Number.parseInt(
    process.env.DATABASE_CONNECT_TIMEOUT_SECONDS || "10",
    10
  ),
  applicationName: "clipper",
});

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    ...(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : {}),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
