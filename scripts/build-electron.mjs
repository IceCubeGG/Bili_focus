import { build } from 'esbuild';

await Promise.all([
  build({ entryPoints: ['src/electron/main.ts'], outfile: 'dist-electron/main.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], sourcemap: true }),
  build({ entryPoints: ['src/electron/preload.ts'], outfile: 'dist-electron/preload.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'] }),
]);
