import {readFile, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'static/listen/assets');
const manifest = JSON.parse(await readFile(path.join(directory, 'assets.json'), 'utf8'));
const actual = (await readdir(directory)).filter(name => name !== 'assets.json').sort();
const expected = Object.keys(manifest).sort();
if (JSON.stringify(actual) !== JSON.stringify(expected))
  throw new Error('Local audio model asset list does not match assets.json.');
for (const [name, info] of Object.entries(manifest)) {
  const bytes = await readFile(path.join(directory, name));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== info.bytes || sha256 !== info.sha256)
    throw new Error(`Audio model asset is corrupted: ${name}`);
}
console.log(`Verified ${expected.length} local model/runtime assets.`);
