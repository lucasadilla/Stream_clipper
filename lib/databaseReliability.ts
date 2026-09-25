const TRANSIENT_DATABASE_CODES = new Set([
  "P1001", // Database server is unreachable.
  "P1002", // Database server connection timed out.
  "P1008", // Database operation timed out.
  "P1017", // Server closed the connection.
  "P2024", // Timed out waiting for a pool connection.
]);

const TRANSIENT_DATABASE_MESSAGES = [
  "can't reach database server",
  "timed out fetching a new connection from the connection pool",
  "connection reset",
  "connection was forcibly closed",
  "server has closed the connection",
  "connection terminated unexpectedly",
  "broken pipe",
];

export interface DatabaseUrlOptions {
  connectionLimit?: number;
  poolTimeoutSeconds?: number;
  connectTimeoutSeconds?: number;
  applicationName?: string;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value ?? 0) > 0
    ? Math.floor(value as number)
    : fallback;
}

/**
 * Applies conservative Prisma pool defaults only to transaction-pooler URLs.
 * Explicit query-string settings always win.
 */
export function configureDatabaseUrl(
  rawUrl: string | undefined,
  options: DatabaseUrlOptions = {}
): string | undefined {
  if (!rawUrl) return rawUrl;

  try {
    const url = new URL(rawUrl);
    const isPostgres = url.protocol === "postgresql:" || url.protocol === "postgres:";
    const isTransactionPooler =
      url.port === "6543" || url.searchParams.get("pgbouncer") === "true";
    if (!isPostgres || !isTransactionPooler) return rawUrl;

    if (!url.searchParams.has("pgbouncer")) {
      url.searchParams.set("pgbouncer", "true");
    }
    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set(
        "connection_limit",
        String(positiveInteger(options.connectionLimit, 5))
      );
    }
    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set(
        "pool_timeout",
        String(positiveInteger(options.poolTimeoutSeconds, 20))
      );
    }
    if (!url.searchParams.has("connect_timeout")) {
      url.searchParams.set(
        "connect_timeout",
        String(positiveInteger(options.connectTimeoutSeconds, 10))
      );
    }
    if (options.applicationName && !url.searchParams.has("application_name")) {
      url.searchParams.set("application_name", options.applicationName);
    }
    return url.toString();
  } catch {
    // Let Prisma report malformed URLs with its normal, detailed startup error.
    return rawUrl;
  }
}

function collectErrorDetails(error: unknown): string[] {
  const details: string[] = [];
  let current: unknown = error;
  const visited = new Set<unknown>();
  for (let depth = 0; current && depth < 5 && !visited.has(current); depth += 1) {
    visited.add(current);
    if (current instanceof Error) details.push(current.message);
    if (typeof current === "object") {
      const value = current as { code?: unknown; message?: unknown; cause?: unknown };
      if (typeof value.code === "string") details.push(value.code);
      if (typeof value.message === "string") details.push(value.message);
      current = value.cause;
    } else {
      details.push(String(current));
      break;
    }
  }
  return details;
}

export function isTransientDatabaseError(error: unknown): boolean {
  const details = collectErrorDetails(error);
  if (details.some((detail) => TRANSIENT_DATABASE_CODES.has(detail))) return true;
  const message = details.join(" ").toLowerCase();
  return TRANSIENT_DATABASE_MESSAGES.some((fragment) => message.includes(fragment));
}

export function databaseBackoffDelayMs(
  consecutiveFailures: number,
  baseMs = 5_000,
  maxMs = 120_000
): number {
  const exponent = Math.min(5, Math.max(0, consecutiveFailures - 1));
  return Math.min(maxMs, Math.max(baseMs, baseMs * 2 ** exponent));
}
