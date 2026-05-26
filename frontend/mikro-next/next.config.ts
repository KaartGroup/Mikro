import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@timur00kh/whisper.wasm"],
  experimental: {
    middlewareClientMaxBodySize: "500mb",
    serverActions: {
      bodySizeLimit: "500mb",
    },
  },
  async headers() {
    return [
      {
        source: "/transcribe-worker",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
};

export default nextConfig;
