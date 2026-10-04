import { ImageResponse } from "next/og";
import { getPublicSiteUrl } from "@/lib/publicOrigin";

export const runtime = "edge";
export const alt =
  "Clipper — Turn livestreams and VODs into clips and Shorts";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function OpenGraphImage() {
  const markUrl = new URL(
    "/brand/clipper-mark-ivory.png",
    getPublicSiteUrl()
  ).toString();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#020302",
          color: "#F1EFE7",
          padding: "64px 72px",
          fontFamily: "Georgia, 'Times New Roman', serif",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(circle at 18% 20%, rgba(149,255,0,0.16), transparent 42%), radial-gradient(circle at 88% 78%, rgba(143,203,85,0.12), transparent 36%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 4,
            background: "#95ff00",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 56,
              height: 44,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#F1EFE7",
            }}
          >
            {/* ImageResponse requires a plain image element for raster marks. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={markUrl}
              alt=""
              width={56}
              height={56}
              style={{ objectFit: "contain" }}
            />
          </div>
          <div
            style={{
              fontSize: 42,
              letterSpacing: "-0.03em",
              color: "#F1EFE7",
            }}
          >
            Clipper
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div
            style={{
              fontSize: 64,
              lineHeight: 1.05,
              letterSpacing: "-0.04em",
              maxWidth: 920,
              color: "#FFFFFF",
            }}
          >
            Turn livestreams into clips and Shorts.
          </div>
          <div
            style={{
              fontSize: 28,
              lineHeight: 1.35,
              maxWidth: 820,
              color: "rgba(241,239,231,0.72)",
              fontFamily: "ui-sans-serif, system-ui, sans-serif",
            }}
          >
            Search transcripts, cut on a timeline, caption, and export 16:9
            highlights or 9:16 Shorts.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 10,
              fontSize: 18,
              color: "#95ff00",
              textTransform: "uppercase",
              letterSpacing: "0.14em",
            }}
          >
            <span>Live</span>
            <span style={{ color: "#5f6b5c" }}>/</span>
            <span>Transcript</span>
            <span style={{ color: "#5f6b5c" }}>/</span>
            <span>Export</span>
          </div>
          <div style={{ fontSize: 22, color: "rgba(241,239,231,0.55)" }}>
            streamclipper.stream
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
