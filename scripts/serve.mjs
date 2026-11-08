import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = dirname(dirname(fileURLToPath(import.meta.url)));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.pdf': 'application/pdf', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json' };

export async function serve({ port = 4173, root = project, base = '/shopping-list/', testFiles = false,
  testDirectory = resolve(project, 'tests'), siteRoot } = {}) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (!url.pathname.startsWith(base)) throw new Error();
      const pathname = decodeURIComponent(url.pathname.slice(base.length));
      const relative = pathname.endsWith('/') || !pathname ? pathname + 'index.html' : pathname;
      const testPath = testFiles && relative.startsWith('tests/');
      const appPath = siteRoot && relative.startsWith('app/');
      const directory = resolve(testPath ? testDirectory : appPath ? siteRoot() : root);
      const file = testPath ? relative.slice('tests/'.length) : appPath ? relative.slice('app/'.length) : relative;
      const path = resolve(directory, file);
      if (!path.startsWith(directory + sep) || !(await stat(path)).isFile()) throw new Error();
      response.writeHead(200, { 'Content-Type': (MIME[extname(path)] ?? 'text/plain') + '; charset=utf-8',
        'Cache-Control': 'no-store' });
      createReadStream(path).pipe(response);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return { server, url: 'http://127.0.0.1:' + server.address().port + base };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { url } = await serve({ port: Number(process.env.PORT ?? 4173) });
  console.log(url);
}
