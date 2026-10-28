import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectSnapshot, readDocker } from '../src/discovery.js';

async function fixture(t, responder) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'portauthority-test-'));
  const socketPath = process.platform === 'win32' ? `\\\\.\\pipe\\portauthority-test-${process.pid}-${path.basename(dir)}` : path.join(dir, 'docker.sock');
  const server = http.createServer(responder);
  server.listen(socketPath);
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, socketPath };
}

test('collects Docker and all Linux tables and deduplicates identical observations', async t => {
  const container = { Id: 'abc123', Names: ['/web'], Image: 'nginx', Ports: [{ PublicPort: 8080, PrivatePort: 80, IP: '0.0.0.0', Type: 'tcp' }] };
  const { dir, socketPath } = await fixture(t, (request, response) => {
    assert.equal(request.method, 'GET');
    assert.equal(request.url, '/containers/json');
    response.end(JSON.stringify([container, container]));
  });
  const header = 'sl local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode\n';
  for (const table of ['tcp', 'tcp6', 'udp', 'udp6']) {
    const row = table === 'tcp' ? '0: 00000000:0016 00000000:0000 0A 0:0 00:0 0 0 0 123\n' : '';
    await writeFile(path.join(dir, table), header + row);
  }
  const result = await collectSnapshot({ socketPath, procPath: dir });
  assert.equal(result.complete, true);
  assert.equal(result.demo, false);
  assert.equal(result.entries.length, 2);
  assert.deepEqual(result.entries.map(row => row.port), [22, 8080]);
  assert.deepEqual(result.errors, []);
});

test('records Docker and missing socket-table failures without hiding partial data', async t => {
  const { dir, socketPath } = await fixture(t, (_request, response) => {
    response.writeHead(403);
    response.end('denied');
  });
  await writeFile(path.join(dir, 'tcp'), 'sl local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode\n0: 00000000:0016 00000000:0000 0A 0:0 00:0 0 0 0 123\n');
  const result = await collectSnapshot({ socketPath, procPath: dir });
  assert.equal(result.complete, false);
  assert.equal(result.entries.length, 1);
  assert.equal(result.errors.length, 4);
  assert.match(result.errors[0].message, /HTTP 403/);
});

test('rejects malformed Docker responses', async t => {
  const { socketPath } = await fixture(t, (_request, response) => response.end('{"not":"containers"}'));
  await assert.rejects(readDocker(socketPath), /invalid container list/);
});
