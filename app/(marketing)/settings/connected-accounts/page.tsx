import type { Metadata } from "next";
import { Suspense } from "react";
import { ConnectedAccountsWorkspace } from "@/components/social/ConnectedAccountsWorkspace";
import { OperationProgress } from "@/components/ui/operation-progress";

export const metadata: Metadata = {
  title: "Connected Accounts",
  robots: { index: false, follow: false },
};

export default function ConnectedAccountsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[var(--color-background)] px-6">
          <OperationProgress
            title="Loading connected accounts"
            stages={["Checking platform connections…", "Loading account permissions…"]}
            className="max-w-sm"
          />
        </div>
      }
    >
      <ConnectedAccountsWorkspace />
    </Suspense>
  );
}
