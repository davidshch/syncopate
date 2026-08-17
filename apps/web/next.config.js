/** @type {import('next').NextConfig} */
const nextConfig = {
  agentRules: false,
  transpilePackages: ["@syncopate/shared"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
      {
        source: "/worklets/:path*",
        headers: [
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
      {
        source: "/workers/:path*",
        headers: [
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
