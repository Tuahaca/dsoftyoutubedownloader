// Bundles the host (and @ytdl/shared) into a single CommonJS file Chrome can launch via host.bat.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

await build({
  entryPoints: [new URL('./src/main.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')],
  outfile: new URL('./dist/host.cjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: 'inline',
  define: { __HOST_VERSION__: JSON.stringify(pkg.version) },
  logLevel: 'info',
});
