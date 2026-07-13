import type { Metadata } from "next";
import { Instrument_Serif } from "next/font/google";
import "./globals.css";

const instrumentSerif = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://streamclipper.app"
  ),
  title: {
    default: "Clipper — AI Livestream Editor & Shorts Generator",
    template: "%s | Clipper",
  },
  description:
    "Turn livestreams and VODs into captioned clips and vertical Shorts. Search transcripts, edit on a synchronized timeline, and export fast.",
  applicationName: "Clipper",
  keywords: [
    "AI stream clipper",
    "livestream clip maker",
    "YouTube Shorts generator",
    "Twitch clip editor",
    "stream highlight generator",
    "video transcript editor",
  ],
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Clipper",
    title: "Clipper — Turn Livestreams into Clips and Shorts",
    description:
      "Find the best moments in livestreams and VODs, add captions, and export 16:9 clips or 9:16 Shorts.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Clipper — AI Livestream Editor & Shorts Generator",
    description:
      "Search transcripts, caption clips, and export livestream highlights fast.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={instrumentSerif.variable}>
      <body
        className="min-h-screen antialiased site-body"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
