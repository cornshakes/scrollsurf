import type { NextConfig } from 'next';
import { execSync } from 'child_process';

const commit_id = execSync('git rev-parse --short HEAD').toString().trim();

const nextConfig: NextConfig = {
  output: 'standalone',
  devIndicators: false,
  env: {
    NEXT_PUBLIC_COMMIT_ID: commit_id,
  },
};

export default nextConfig;
