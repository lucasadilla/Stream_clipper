import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Creator Beta Code Manager",
  robots: { index: false, follow: false },
};

export default function CreatorBetaAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
