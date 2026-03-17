import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['@eigenpal/docx-core', '@eigenpal/docx-editor-agent-use'],
};

export default nextConfig;
