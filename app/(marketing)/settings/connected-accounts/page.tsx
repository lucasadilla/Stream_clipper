import type { Metadata } from "next";
import { Suspense } from "react";
import { ConnectedAccountsWorkspace } from "@/components/social/ConnectedAccountsWorkspace";

export const metadata: Metadata = {
  title: "Connected Accounts",
  robots: { index: false, follow: false },
};

export default function ConnectedAccountsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[var(--color-background)] text-sm text-[#7d8877]">
          Loading connected accounts…
        </div>
      }
    >
      <ConnectedAccountsWorkspace />
    </Suspense>
  );
}
