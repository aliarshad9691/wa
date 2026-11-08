import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // The auth proxy buffers request bodies (default 10 MB), which truncated video uploads.
    // Allow up to the send route's own 100 MB limit plus multipart overhead.
    proxyClientMaxBodySize: "110mb",
  },
  // Long-lived native/server-only libraries must not be bundled.
  serverExternalPackages: [
    "baileys",
    "better-sqlite3",
    "pino",
    "qrcode",
    "sharp",
    "jimp",
    "link-preview-js",
    "@aws-sdk/client-s3",
    "@aws-sdk/s3-request-presigner",
  ],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
