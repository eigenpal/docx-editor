import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@docx-editor.dev/react', '@docx-editor.dev/core'],
};

export default nextConfig;
