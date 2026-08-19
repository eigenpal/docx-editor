import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { plugin } from 'bun';
import { readFileSync } from 'node:fs';

plugin({
  name: 'vue-classic-jsx-for-tests',
  setup(build) {
    build.onLoad({ filter: /\/packages\/(?:vue|pro\/src\/vue)\/.*\.tsx$/ }, (args) => {
      const source = readFileSync(args.path, 'utf8');
      const transpiler = new Bun.Transpiler({
        loader: 'tsx',
        tsconfig: {
          compilerOptions: {
            jsx: 'react',
            jsxFactory: 'h',
            jsxFragmentFactory: 'Fragment',
          },
        },
      });
      let code = transpiler.transformSync(source);
      if (!/\b(from ['"]vue['"])/.test(code) && /\bh\(/.test(code)) {
        code = `import { h, Fragment } from "vue";\n${code}`;
      }
      return { contents: code, loader: 'js' };
    });
  },
});
