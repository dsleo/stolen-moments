import {build} from 'esbuild';
import {mkdir, copyFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'static/listen/assets');
await mkdir(output, {recursive: true});
await build({
  entryPoints: [path.join(root, 'static/listen/transcription-worker.js')],
  outfile: path.join(output, 'transcription-worker.bundle.js'),
  bundle: true, platform: 'browser', format: 'iife', target: ['es2020'], minify: true,
  legalComments: 'none',
});
const sources = [
  ['node_modules/@spotify/basic-pitch/model/model.json', 'model.json'],
  ['node_modules/@spotify/basic-pitch/model/group1-shard1of1.bin', 'group1-shard1of1.bin'],
  ['node_modules/@spotify/basic-pitch/LICENSE', 'basic-pitch-LICENSE.txt'],
];
for (const [source, target] of sources)
  await copyFile(path.join(root, source), path.join(output, target));
await writeFile(path.join(output, 'tfjs-NOTICE.txt'),
  '@tensorflow/tfjs 3.21.0 - Apache License 2.0.\n' +
  'Source: https://github.com/tensorflow/tfjs\n' +
  'License: https://www.apache.org/licenses/LICENSE-2.0\n');
const files = ['transcription-worker.bundle.js', ...sources.map(([, target]) => target),
  'tfjs-NOTICE.txt'];
const manifest = {};
for (const name of files) {
  const bytes = await readFile(path.join(output, name));
  manifest[name] = {bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')};
}
await writeFile(path.join(output, 'assets.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Built ${files.length} local audio model/runtime assets.`);
