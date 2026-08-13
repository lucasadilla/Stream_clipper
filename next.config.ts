import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "500mb",
    },
  },
  // Next.js 16 defaults to Turbopack; keep an explicit empty config so builds
  // that use Turbopack don't fail solely because a webpack() hook exists.
  turbopack: {},
  // Stop thumbnail/recording writes in ./storage from triggering hot reloads.
  // Production builds use `next build --webpack` so this hook still applies.
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          "**/node_modules/**",
          "**/.git/**",
          "**/.next/**",
          "**/storage/**",
        ],
      };
    }
    return config;
  },
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/array/:path*",
        destination: "https://us-assets.i.posthog.com/array/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
    ];
  },
  skipTrailingSlashRedirect: true,
  // Allow serving rendered files from storage in dev if needed
  async headers() {
    return [
      {
        source: "/api/storage/:path*",
        headers: [{ key: "Cache-Control", value: "private, max-age=3600" }],
      },
      {
        source: "/mediapipe/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
