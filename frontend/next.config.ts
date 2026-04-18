import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: '/terminal',
  typescript: {
    ignoreBuildErrors: true,
  },

};

export default nextConfig;
