import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  devIndicators: false,
  env: {
    NEXT_PUBLIC_COMMIT_ID: process.env.COMMIT_ID ?? 'dev',
  },
};

export default nextConfig;
