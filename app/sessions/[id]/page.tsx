import { SessionPageClient } from "./SessionPageClient";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SessionPageClient sessionId={id} />;
}
