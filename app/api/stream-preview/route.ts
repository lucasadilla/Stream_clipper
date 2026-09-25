import { NextRequest } from "next/server";
import { z } from "zod";
import { parseStreamUrl, platformLabel } from "@/lib/streamPlatform";
import { errorResponse, jsonResponse } from "@/lib/utils";

const cache = new Map<
  string,
  { expiresAt: number; value: Record<string, string | null> }
>();
const requests = new Map<string, { startedAt: number; count: number }>();

const schema = z.object({ url: z.string().trim().min(1).max(2_000) });

function allowRequest(request: NextRequest): boolean {
  const key =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  if (requests.size > 1_000) {
    for (const [requestKey, value] of requests) {
      if (now - value.startedAt > 60_000) requests.delete(requestKey);
    }
  }
  const current = requests.get(key);
  if (!current || now - current.startedAt > 60_000) {
    requests.set(key, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= 20;
}

export async function POST(request: NextRequest) {
  try {
    if (!allowRequest(request)) {
      return errorResponse("Too many preview requests. Try again in a minute.", 429);
    }
    const { url } = schema.parse(await request.json());
    const parsed = parseStreamUrl(url);
    if (!parsed) return errorResponse("Unsupported stream URL", 400);
    const cached = cache.get(parsed.canonicalUrl);
    if (cached && cached.expiresAt > Date.now()) {
      return jsonResponse({ preview: cached.value });
    }

    let title = `${parsed.sourceId} on ${platformLabel(parsed.platform)}`;
    let creator: string | null = parsed.sourceId;
    let thumbnailUrl: string | null = null;

    if (parsed.platform === "youtube") {
      try {
        const endpoint = new URL("https://www.youtube.com/oembed");
        endpoint.searchParams.set("url", parsed.canonicalUrl);
        endpoint.searchParams.set("format", "json");
        const response = await fetch(endpoint, {
          signal: AbortSignal.timeout(3_500),
          next: { revalidate: 600 },
        });
        if (response.ok) {
          const metadata = (await response.json()) as {
            title?: string;
            author_name?: string;
            thumbnail_url?: string;
          };
          title = metadata.title?.trim() || title;
          creator = metadata.author_name?.trim() || creator;
          thumbnailUrl = metadata.thumbnail_url?.trim() || null;
        }
      } catch {
        // Metadata is optional. The validated URL remains usable.
      }
    }

    const value = {
      title,
      creator,
      thumbnailUrl,
      platform: parsed.platform,
      canonicalUrl: parsed.canonicalUrl,
      liveStatus: null,
    };
    cache.set(parsed.canonicalUrl, {
      value,
      expiresAt: Date.now() + 10 * 60_000,
    });
    if (cache.size > 1_000) {
      const now = Date.now();
      for (const [cacheKey, item] of cache) {
        if (item.expiresAt <= now) cache.delete(cacheKey);
      }
    }
    return jsonResponse({ preview: value });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(error.errors[0]?.message ?? "Invalid URL", 400);
    }
    return errorResponse("Preview unavailable", 400);
  }
}
