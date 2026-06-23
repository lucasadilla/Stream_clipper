import { NextRequest } from "next/server";
import { serveStorageFile } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: pathSegments } = await params;
    const relativePath = pathSegments.join("/");
    return serveStorageFile(relativePath);
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
