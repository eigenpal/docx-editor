import type { NextConfig } from 'next';
import path from 'path';
import fs from 'fs';

// Detect monorepo: resolve to source when developing locally
const monorepoRoot = path.resolve(__dirname, '../..');
const isMonorepo = fs.existsSync(path.join(monorepoRoot, 'src/index.ts'));

const nextConfig: NextConfig = {
  outputFileTracingRoot: monorepoRoot,
  transpilePackages: ['@eigenpal/docx-js-editor'],
  webpack: (config, { webpack }) => {
    if (isMonorepo) {
      config.resolve.alias['@eigenpal/docx-js-editor'] = path.join(monorepoRoot, 'src/index.ts');
    }
    config.plugins.push(
      new webpack.DefinePlugin({
        __ENABLE_FRAMEWORK_SWITCHER__: JSON.stringify(
          process.env.ENABLE_FRAMEWORK_SWITCHER === 'true'
        ),
      })
    );
    return config;
  },
};

export default nextConfig;
