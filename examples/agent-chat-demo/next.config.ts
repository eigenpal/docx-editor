import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@eigenpal/docx-editor-react', '@eigenpal/docx-editor-core'],
};

export default nextConfig;
