import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  devIndicators: false,
  env: {
    NEXT_PUBLIC_COMMIT_ID: process.env.COMMIT_ID ?? 'dev',
  },
  allowedDevOrigins: ['10.0.0.16'],
  // turn off nextjs server-action logging because (src/lib/log.ts) already cover them.
  logging: {
    serverFunctions: false,
  },
};

export default nextConfig;
