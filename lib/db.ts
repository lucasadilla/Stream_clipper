import { PrismaClient } from "@prisma/client";
import { configureDatabaseUrl } from "@/lib/databaseReliability";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    datasources: {
      db: {
        url: configureDatabaseUrl(process.env.DATABASE_URL, {
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
        }),
      },
    },
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
