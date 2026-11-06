import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = dirname(dirname(fileURLToPath(import.meta.url)));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

export async function serve({ port = 4173, root = project, base = '/shopping-list/', testFiles = false } = {}) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (!url.pathname.startsWith(base)) throw new Error();
      const relative = decodeURIComponent(url.pathname.slice(base.length)) || 'index.html';
      const testPath = testFiles && relative.startsWith('tests/');
      const directory = testPath ? resolve(project, 'tests') : root;
      const path = resolve(directory, testPath ? relative.slice('tests/'.length) : relative);
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
