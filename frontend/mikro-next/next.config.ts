import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@timur00kh/whisper.wasm"],
  experimental: {
    middlewareClientMaxBodySize: "500mb",
    serverActions: {
      bodySizeLimit: "500mb",
    },
  },
  async redirects() {
    return [
      // Dashboard
      { source: "/admin/dashboard", destination: "/dashboard", permanent: true },
      { source: "/user/dashboard", destination: "/dashboard", permanent: true },
      { source: "/validator/dashboard", destination: "/dashboard", permanent: true },
      // Projects
      { source: "/admin/projects", destination: "/projects", permanent: true },
      { source: "/user/projects", destination: "/projects", permanent: true },
      { source: "/admin/projects/:id", destination: "/projects/:id", permanent: true },
      { source: "/user/projects/:id", destination: "/projects/:id", permanent: true },
      // Training
      { source: "/admin/training", destination: "/training", permanent: true },
      { source: "/user/training", destination: "/training", permanent: true },
      // Checklists
      { source: "/admin/checklists", destination: "/checklists", permanent: true },
      { source: "/user/checklists", destination: "/checklists", permanent: true },
      { source: "/validator/checklists", destination: "/checklists", permanent: true },
      // Time
      { source: "/admin/time", destination: "/time", permanent: true },
      { source: "/user/time", destination: "/time", permanent: true },
      { source: "/admin/time-categories", destination: "/time?tab=categories", permanent: true },
      // Teams
      { source: "/admin/teams", destination: "/teams", permanent: true },
      { source: "/user/teams", destination: "/teams", permanent: true },
      { source: "/admin/teams/:id", destination: "/teams/:id", permanent: true },
      { source: "/user/teams/:id", destination: "/teams/:id", permanent: true },
      // Payments
      { source: "/user/payments", destination: "/payments", permanent: true },
      // Users
      { source: "/admin/users", destination: "/users", permanent: true },
      { source: "/admin/users/:id", destination: "/users/:id", permanent: true },
      // Reports
      { source: "/admin/reports", destination: "/reports", permanent: true },
      { source: "/admin/reports/weekly", destination: "/reports/weekly", permanent: true },
    ];
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
