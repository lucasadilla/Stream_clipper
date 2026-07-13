import type { Metadata } from "next";
import { CreatorBetaAccess } from "@/components/CreatorBetaAccess";

export const metadata: Metadata = {
  title: "Creator Beta",
  description: "Unlock invite-only Creator Beta access for AI clip creation.",
  robots: { index: false, follow: false },
};

export default function CreatorBetaPage() {
  return <CreatorBetaAccess />;
}
