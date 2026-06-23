import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "500mb",
    },
  },
  // Allow serving rendered files from storage in dev if needed
  async headers() {
    return [
      {
        source: "/api/storage/:path*",
        headers: [{ key: "Cache-Control", value: "private, max-age=3600" }],
      },
    ];
  },
};

export default nextConfig;
