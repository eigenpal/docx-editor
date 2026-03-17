import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@eigenpal/docx-js-editor', '@eigenpal/docx-core'],
};

export default nextConfig;
