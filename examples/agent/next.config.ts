import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  // The example lives inside the monorepo, so the workspace packages it imports
  // sit above its own directory. Without this Next traces from `examples/agent`
  // and warns about files it cannot reach.
  outputFileTracingRoot: path.resolve(__dirname, '../..'),
};

export default nextConfig;
