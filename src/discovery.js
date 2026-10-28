import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { dockerEntries, parseSocketTable } from './ports.js';

export function readDocker(socketPath) {
  return new Promise((resolve, reject) => {
    const request = http.get({ socketPath, path: '/containers/json', timeout: 3000 }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
        if (body.length > 8 * 1024 * 1024) request.destroy(new Error('Docker response exceeded 8 MB.'));
      });
      response.on('error', reject);
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(new Error(`Docker API returned HTTP ${response.statusCode}.`));
        try {
          const containers = JSON.parse(body);
          if (!Array.isArray(containers)) throw new Error('Docker returned an invalid container list.');
          resolve(dockerEntries(containers));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('Docker API timed out after 3 seconds.')));
    request.on('error', reject);
  });
}

export async function collectSnapshot({
  socketPath = process.env.DOCKER_SOCKET || '/var/run/docker.sock',
  procPath = process.env.PROC_NET_PATH || '/proc/net'
} = {}) {
  const tasks = [
    { name: 'Docker', run: () => readDocker(socketPath) },
    ...['tcp', 'tcp6', 'udp', 'udp6'].map(table => ({
      name: `Host ${table.toUpperCase()}`,
      run: async () => parseSocketTable(await readFile(path.join(procPath, table), 'utf8'), table.startsWith('tcp') ? 'tcp' : 'udp', table.endsWith('6'))
    }))
  ];
  const results = await Promise.allSettled(tasks.map(task => task.run()));
  const entries = [];
  const errors = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') entries.push(...result.value);
    else errors.push({ source: tasks[index].name, message: result.reason.message });
  });
  const unique = [...new Map(entries.map(row => [`${row.source}:${row.containerId}:${row.address}:${row.port}:${row.protocol}`, row])).values()];
  unique.sort((a, b) => a.port - b.port || a.protocol.localeCompare(b.protocol) || a.name.localeCompare(b.name));
  return { entries: unique, errors, complete: errors.length === 0, demo: false, checkedAt: new Date().toISOString() };
}

export function demoSnapshot() {
  const containers = [
    { Id: 'a1b2c3d4e5f6', Names: ['/nginx-proxy'], Image: 'nginx:alpine', Ports: [{ PublicPort: 80, PrivatePort: 80, Type: 'tcp', IP: '0.0.0.0' }, { PublicPort: 443, PrivatePort: 443, Type: 'tcp', IP: '0.0.0.0' }] },
    { Id: 'b2c3d4e5f6a1', Names: ['/grafana'], Image: 'grafana/grafana:latest', Ports: [{ PublicPort: 3000, PrivatePort: 3000, Type: 'tcp', IP: '0.0.0.0' }] },
    { Id: 'c3d4e5f6a1b2', Names: ['/postgres'], Image: 'postgres:17-alpine', Ports: [{ PublicPort: 5432, PrivatePort: 5432, Type: 'tcp', IP: '127.0.0.1' }] },
    { Id: 'd4e5f6a1b2c3', Names: ['/redis'], Image: 'redis:alpine', Ports: [{ PublicPort: 6379, PrivatePort: 6379, Type: 'tcp', IP: '127.0.0.1' }] },
    { Id: 'e5f6a1b2c3d4', Names: ['/pihole'], Image: 'pihole/pihole:latest', Ports: [{ PublicPort: 53, PrivatePort: 53, Type: 'udp', IP: '0.0.0.0' }] },
    { Id: 'f6a1b2c3d4e5', Names: ['/portainer'], Image: 'portainer/portainer-ce:latest', Ports: [{ PublicPort: 9000, PrivatePort: 9000, Type: 'tcp', IP: '0.0.0.0' }] }
  ];
  return {
    entries: [...dockerEntries(containers), { port: 22, protocol: 'tcp', address: '0.0.0.0', source: 'host', name: 'Host listener', detail: 'Listening TCP socket', containerId: null, containerPort: null }],
    errors: [], complete: true, demo: true, checkedAt: new Date().toISOString()
  };
}
