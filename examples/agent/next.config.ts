import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  // The example lives inside the monorepo, so the workspace packages it imports
  // sit above its own directory. Without this Next traces from `examples/agent`
  // and warns about files it cannot reach.
  outputFileTracingRoot: path.resolve(__dirname, '../..'),
  turbopack: {
    resolveAlias: {
      // The text shaper ships one file for both runtimes and reaches for Node's
      // `module` behind an `IS_NODE` guard. The guard is false in a browser, but
      // the import still has to RESOLVE or the client build fails. Webpack
      // stubs node builtins for the browser target; Turbopack does not, so
      // point it at a stub.
      module: { browser: './stub/node-module.js' },
    },
  },
};

export default nextConfig;
