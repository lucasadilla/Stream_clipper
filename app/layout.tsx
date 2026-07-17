import type { Metadata } from "next";
import { Instrument_Serif } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
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
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://streamclipper.stream"
  ),
  title: {
    default: "Clipper - AI Livestream Editor & Shorts Generator",
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
    url: "https://streamclipper.stream/",
    siteName: "Clipper",
    locale: "en_US",
    title: "Clipper - Turn Livestreams into Clips and Shorts",
    description:
      "Find the best moments in livestreams and VODs, add captions, and export 16:9 clips or 9:16 Shorts.",
    images: [
      {
        url: "https://streamclipper.stream/og.png",
        secureUrl: "https://streamclipper.stream/og.png",
        type: "image/png",
        width: 1200,
        height: 630,
        alt: "Clipper - Turn livestreams and VODs into clips and Shorts",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Clipper - AI Livestream Editor & Shorts Generator",
    description:
      "AI finds the best moments in livestreams and VODs. Cut, caption, and export Shorts fast.",
    images: ["https://streamclipper.stream/og.png"],
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
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
