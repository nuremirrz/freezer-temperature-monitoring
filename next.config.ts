import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev overlay badge sits on top of the mobile bottom bar
  devIndicators: false,
  // Native-ish server deps should not be bundled by Turbopack
  serverExternalPackages: ["pg", "@prisma/adapter-pg"],
};

export default nextConfig;
