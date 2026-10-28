import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/server.js';
import { demoSnapshot } from '../src/discovery.js';

async function start(t, options) {
  const server = createApp(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('serves dashboard assets and applies browser safety headers', async t => {
  const url = await start(t, { snapshot: demoSnapshot });
  for (const [route, type] of [['/', 'text/html'], ['/app.js', 'text/javascript'], ['/styles.css', 'text/css']]) {
    const response = await fetch(url + route);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').startsWith(type));
    assert.ok(response.headers.get('content-security-policy').includes("default-src 'self'"));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok((await response.text()).length > 100);
  }
});

test('inventory and check APIs expose demo flag, ownership, and alternatives', async t => {
  const url = await start(t, { snapshot: demoSnapshot });
  const inventory = await (await fetch(url + '/api/ports')).json();
  assert.equal(inventory.demo, true);
  assert.equal(inventory.complete, true);
  assert.equal(inventory.entries.length, 8);
  const busy = await (await fetch(url + '/api/check?port=3000&protocol=tcp')).json();
  assert.equal(busy.available, false);
  assert.equal(busy.owners[0].name, 'grafana');
  assert.deepEqual(busy.alternatives, [3001, 3002, 3003, 3004, 3005]);
  const free = await (await fetch(url + '/api/check?port=8080&protocol=tcp')).json();
  assert.equal(free.available, true);
});

test('rejects invalid checks, unknown paths, and mutation methods', async t => {
  const url = await start(t, { snapshot: demoSnapshot });
  for (const query of ['port=0&protocol=tcp', 'port=65536&protocol=tcp', 'port=1.5&protocol=tcp', 'port=80&protocol=sctp', 'protocol=tcp', 'port=80']) {
    assert.equal((await fetch(`${url}/api/check?${query}`)).status, 400, query);
  }
  assert.equal((await fetch(url + '/package.json')).status, 404);
  assert.equal((await fetch(url + '/api/ports', { method: 'POST' })).status, 405);
});

test('check performs a fresh discovery each time and exposes missing sources', async t => {
  let calls = 0;
  const url = await start(t, { snapshot: () => {
    calls++;
    return { entries: [], demo: false, complete: false, errors: [{ source: 'Docker', message: 'Unavailable' }], checkedAt: new Date().toISOString() };
  } });
  for (let i = 0; i < 2; i++) {
    const result = await (await fetch(url + '/api/check?port=8080&protocol=tcp')).json();
    assert.equal(result.available, null);
    assert.equal(result.errors[0].source, 'Docker');
  }
  assert.equal(calls, 2);
});
