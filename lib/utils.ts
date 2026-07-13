import type { Prisma } from "@prisma/client";

function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

export function toJsonValue(value: unknown): Prisma.InputJsonValue {
  try {
    const json = JSON.stringify(value, jsonReplacer);
    if (!json || json === "undefined") return {};
    return JSON.parse(json) as Prisma.InputJsonValue;
  } catch {
    return {};
  }
}

export function serializeForJson<T>(value: T): T {
  return value;
}

export async function parseRequestJson<T = unknown>(
  request: Request
): Promise<T | null> {
  const text = await request.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Invalid JSON body");
  }
}

export function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function jsonResponse(data: unknown, status = 200) {
  try {
    const body = JSON.stringify(data, jsonReplacer);
    return new Response(body, {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "JSON serialization failed";
    return errorResponse(message, 500);
  }
}

export function errorResponse(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}
