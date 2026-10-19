import { build } from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const common = {
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome116'],
  sourcemap: true,
  logLevel: 'info',
  absWorkingDir: root
};

await Promise.all([
  build({
    ...common,
    entryPoints: ['src/content/content.ts'],
    outfile: path.join(dist, 'content.js')
  }),
  build({
    ...common,
    entryPoints: ['src/popup/popup.ts'],
    outfile: path.join(dist, 'popup.js')
  }),
  build({
    ...common,
    entryPoints: ['src/workbench/workbench.ts'],
    outfile: path.join(dist, 'workbench.js')
  })
]);

const staticFiles = [
  ['manifest.json', 'manifest.json'],
  ['INSTALL.txt', 'INSTALL.txt'],
  ['dictionary.example.json', 'dictionary.example.json'],
  ['src/popup/popup.html', 'popup.html'],
  ['src/popup/popup.css', 'popup.css'],
  ['src/workbench/workbench.html', 'workbench.html'],
  ['src/workbench/workbench.css', 'workbench.css']
];

await Promise.all(staticFiles.map(([source, target]) => {
  return copyFile(path.join(root, source), path.join(dist, target));
}));
