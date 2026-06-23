import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stream Clipper — AI YouTube Shorts Generator",
  description:
    "Turn YouTube livestreams into Shorts with AI. Detect hype moments from chat and render vertical clips.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
