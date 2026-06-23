import { SessionWorkspace } from "@/components/SessionWorkspace";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SessionPage({ params }: PageProps) {
  const { id } = await params;
  return <SessionWorkspace sessionId={id} />;
}
