import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Clip Editor",
  robots: { index: false, follow: false },
};

export default function SessionLayout({ children }: { children: React.ReactNode }) {
  return children;
}
