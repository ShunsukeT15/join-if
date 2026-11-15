// Bundles the API into a single ESM file for AWS Lambda, plus the SQL migrations.
import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'lambda');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await build({
  entryPoints: [join(root, 'src', 'lambda.ts')],
  outfile: join(out, 'index.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  // pg optionally requires pg-native; it is never used.
  external: ['pg-native'],
  banner: {
    js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
  },
});
// The migrator reads *.sql next to the bundle.
await cp(join(root, 'src', 'infrastructure', 'persistence', 'postgres', 'migrations'), join(out, 'migrations'), {
  recursive: true,
});
console.log('built', out);
