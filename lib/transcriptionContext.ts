import type { TranscriptionContextPacket } from "@/lib/transcriptionTypes";

const COMMON_WORDS = new Set(
  (
    "about after again against all also and any are because been before being between both but can did does doing down during each few for from further had has have having her here hers herself him himself his how into its itself just more most other our ours ourselves out over own same she should some such than that the their theirs them themselves then there these they this those through too under until very was were what when where which while who whom why will with you your yours yourself yourselves yeah yes okay like really right gonna wanna dude bro chat thanks thank stream live video today tonight playing game games"
  ).split(/\s+/)
);

function cleanTerm(value: string): string | null {
  const term = value
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}+#.'’-]+$/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (term.length < 2 || term.length > 80) return null;
  if (COMMON_WORDS.has(term.toLocaleLowerCase())) return null;
  if (/^https?:|^www\./i.test(term)) return null;
  return term;
}

function metadataTerms(value: string | null | undefined): string[] {
  if (!value) return [];
  const candidates = value.match(
    /(?:[A-Z][\p{L}\p{N}+#.'’-]*(?:\s+[A-Z][\p{L}\p{N}+#.'’-]*){0,3}|[\p{L}]*[A-Z0-9][\p{L}\p{N}+#.'’-]*)/gu
  );
  return (candidates ?? []).flatMap((candidate) => {
    const clean = cleanTerm(candidate);
    return clean ? [clean] : [];
  });
}

function repeatedChatTerms(messages: string[]): string[] {
  const counts = new Map<string, { display: string; count: number }>();
  for (const message of messages) {
    const seen = new Set<string>();
    for (const token of message.match(/[\p{L}\p{N}][\p{L}\p{N}+#.'’-]{2,31}/gu) ?? []) {
      const clean = cleanTerm(token);
      if (!clean) continue;
      const key = clean.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const current = counts.get(key);
      counts.set(key, {
        display: current?.display ?? clean,
        count: (current?.count ?? 0) + 1,
      });
    }
  }
  return [...counts.values()]
    .filter((entry) => entry.count >= 2)
    .sort((a, b) => b.count - a.count || a.display.localeCompare(b.display))
    .map((entry) => entry.display);
}

function uniqueTerms(groups: string[][], limit = 100): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const group of groups) {
    for (const value of group) {
      const clean = cleanTerm(value);
      if (!clean) continue;
      const key = clean.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(clean);
      if (result.length >= limit) return result;
    }
  }
  return result;
}

export function buildTranscriptionContext(input: {
  title?: string | null;
  description?: string | null;
  channelTitle?: string | null;
  previousTranscript?: string | null;
  chatMessages?: string[];
  knownTerms?: string[];
  language?: string;
}): TranscriptionContextPacket {
  const title = input.title?.trim().slice(0, 240);
  const channel = input.channelTitle?.trim().slice(0, 120);
  const description = input.description
    ?.replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  const previous = input.previousTranscript
    ?.replace(/\s+/g, " ")
    .trim()
    .slice(-500);
  const chatMessages = (input.chatMessages ?? []).slice(-80);

  const keyterms = uniqueTerms([
    input.knownTerms ?? [],
    metadataTerms(channel),
    metadataTerms(title),
    metadataTerms(description),
    repeatedChatTerms(chatMessages),
    metadataTerms(previous),
  ]);

  const prompt = [
    title ? `Stream title: ${title}.` : "",
    channel ? `Creator or channel: ${channel}.` : "",
    description ? `Stream context: ${description}` : "",
    keyterms.length > 0
      ? `Expected names and terminology: ${keyterms.slice(0, 40).join(", ")}.`
      : "",
    previous ? `Previous transcript: ${previous}` : "",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(-1_500);

  return {
    prompt: prompt || undefined,
    keyterms,
    language: input.language,
  };
}
