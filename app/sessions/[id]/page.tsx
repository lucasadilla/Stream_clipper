import { SessionPageClient } from "./SessionPageClient";
import { RememberSession } from "@/components/RememberSession";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <><RememberSession id={id} /><SessionPageClient sessionId={id} /></>;
}
