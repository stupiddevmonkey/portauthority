import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPort, dockerEntries, parsePort, parseSocketTable } from '../src/ports.js';

const header = '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode\n';
const socket = (address, state = '0A') => `   0: ${address} 00000000:0000 ${state} 00000000:00000000 00:00000000 00000000 1000 0 12345`;
const snapshot = entries => ({ entries, complete: true, checkedAt: '2026-10-28T12:00:00Z' });

test('port validation accepts boundaries and rejects malformed input', () => {
  for (const [value, expected] of [['1', 1], ['65535', 65535], ['08080', 8080]]) assert.equal(parsePort(value), expected);
  for (const value of [null, undefined, 80, '', '0', '-1', '65536', '1.5', '1e3', ' 80', '80x']) {
    assert.throws(() => parsePort(value), /whole port number/);
  }
});

test('parses IPv4 listening TCP sockets and excludes non-listeners', () => {
  const rows = parseSocketTable(header + socket('0100007F:1F90') + '\n' + socket('00000000:1234', '01'), 'tcp');
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].address, rows[0].port, rows[0].protocol], ['127.0.0.1', 8080, 'tcp']);
});

test('parses IPv6 wildcard and loopback addresses', () => {
  const rows = parseSocketTable(header + socket('00000000000000000000000000000000:01BB') + '\n' + socket('00000000000000000000000001000000:0050'), 'tcp', true);
  assert.equal(rows[0].address, '::');
  assert.equal(rows[0].port, 443);
  assert.equal(rows[1].address, '0:0:0:0:0:0:0:1');
});

test('includes connected and unconnected bound UDP sockets, excludes port zero', () => {
  const rows = parseSocketTable(header + socket('00000000:0035', '07') + '\n' + socket('0100007F:1234', '01') + '\n' + socket('00000000:0000', '07'), 'udp');
  assert.deepEqual(rows.map(row => row.port), [53, 4660]);
});

test('malformed socket rows fail explicitly instead of reporting an empty source', () => {
  assert.throws(() => parseSocketTable(header + 'bad row', 'tcp'), /Unrecognized/);
});

test('Docker discovery uses published ports only and preserves interfaces and targets', () => {
  const rows = dockerEntries([{ Id: 'abc123', Names: ['/web'], Image: 'nginx:alpine', Ports: [
    { PrivatePort: 80, Type: 'tcp' },
    { PublicPort: 8080, PrivatePort: 80, Type: 'tcp', IP: '127.0.0.1' },
    { PublicPort: 8080, PrivatePort: 80, Type: 'tcp', IP: '::' },
    { PublicPort: 53, PrivatePort: 53, Type: 'udp', IP: '0.0.0.0' }
  ] }]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].name, 'web');
  assert.equal(rows[0].containerPort, 80);
  assert.equal(rows[0].address, '127.0.0.1');
  assert.equal(rows[1].address, '::');
});

test('suggestions skip used ports on all interfaces but respect protocols', () => {
  const data = snapshot([
    { port: 8080, protocol: 'tcp', address: '127.0.0.1', name: 'web' },
    { port: 8081, protocol: 'tcp', address: '::', name: 'other' },
    { port: 8082, protocol: 'udp', name: 'dns' }
  ]);
  const result = checkPort(data, 8080, 'tcp');
  assert.equal(result.available, false);
  assert.deepEqual(result.alternatives, [8082, 8083, 8084, 8085, 8086]);
  assert.equal(result.owners.length, 1);
  assert.equal(checkPort(data, 8080, 'udp').available, true);
});

test('suggestions wrap at 65535, avoid privileged ports and never suggest the requested port', () => {
  const result = checkPort(snapshot([{ port: 65535, protocol: 'tcp' }, { port: 1024, protocol: 'tcp' }]), 65535, 'tcp');
  assert.deepEqual(result.alternatives, [1025, 1026, 1027, 1028, 1029]);
  assert.equal(checkPort(snapshot([{ port: 80, protocol: 'tcp' }]), 80, 'tcp').alternatives[0], 1024);
});

test('incomplete discovery never claims availability or suggests alternatives', () => {
  const data = { ...snapshot([{ port: 80, protocol: 'tcp' }]), complete: false };
  assert.equal(checkPort(data, 8080, 'tcp').available, null);
  assert.equal(checkPort(data, 80, 'tcp').available, false);
  assert.deepEqual(checkPort(data, 80, 'tcp').alternatives, []);
});

test('exhausted non-privileged range returns no alternatives', () => {
  const entries = Array.from({ length: 64512 }, (_, i) => ({ port: i + 1024, protocol: 'tcp' }));
  assert.deepEqual(checkPort(snapshot(entries), 8080, 'tcp').alternatives, []);
});
