import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "System health",
  robots: { index: false, follow: false },
};

export default function HealthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
