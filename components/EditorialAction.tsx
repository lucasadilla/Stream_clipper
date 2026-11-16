"use client";

import Link from "next/link";
import posthog from "posthog-js";
import type { ReactNode } from "react";

export function EditorialAction({ contentId, destination, children, className }: {
  contentId: string;
  destination: "sample" | "editor";
  children: ReactNode;
  className?: string;
}) {
  const attribution = new URLSearchParams({ content_id: contentId });
  const href = destination === "sample" ? `/sample?${attribution}` : `/?${attribution}#analyze`;
  return (
    <Link className={className} href={href} onClick={() => {
      posthog.capture("editorial_cta_clicked", { content_id: contentId, destination });
    }}>
      {children}
    </Link>
  );
}
