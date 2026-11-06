import { cp, mkdir, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const output = new URL('dist/', root);
await mkdir(output, { recursive: true });
for (const path of ['index.html', 'style.css', 'src']) {
  await cp(new URL(path, root), new URL(path, output), { recursive: true });
}
await writeFile(new URL('.nojekyll', output), '');
