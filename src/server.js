import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { collectSnapshot, demoSnapshot } from './discovery.js';
import { parsePort, checkPort } from './ports.js';

const publicPath = fileURLToPath(new URL('../public/', import.meta.url));
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']]
]);

export function createApp({ snapshot = process.env.DEMO === 'true' ? demoSnapshot : collectSnapshot } = {}) {
  return http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    response.setHeader('Cache-Control', 'no-store');
    const json = (status, data) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(data));
    };
    try {
      if (request.method !== 'GET') return json(405, { error: 'Only GET requests are supported.' });
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/api/ports') return json(200, await snapshot());
      if (url.pathname === '/api/check') {
        let port;
        const protocol = url.searchParams.get('protocol');
        try {
          port = parsePort(url.searchParams.get('port'));
          if (!['tcp', 'udp'].includes(protocol)) throw new Error('Protocol must be tcp or udp.');
        } catch (error) {
          return json(400, { error: error.message });
        }
        const current = await snapshot();
        return json(200, { ...checkPort(current, port, protocol), errors: current.errors, demo: current.demo });
      }
      const asset = assets.get(url.pathname);
      if (!asset) return json(404, { error: 'Not found.' });
      const body = await readFile(path.join(publicPath, asset[0]));
      response.writeHead(200, { 'Content-Type': asset[1] });
      response.end(body);
    } catch (error) {
      console.error('Request failed:', error);
      json(500, { error: 'Unable to load port data. Check the server logs.' });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = parsePort(process.env.PORT || '8787');
  const host = process.env.HOST || '127.0.0.1';
  const server = createApp();
  server.on('error', error => {
    console.error('Server failed:', error.message);
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    console.log(`PortAuthority listening at http://${host}:${port}${process.env.DEMO === 'true' ? ' (DEMO DATA)' : ''}`);
  });
}
