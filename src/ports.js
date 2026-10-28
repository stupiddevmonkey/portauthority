export function parsePort(value) {
  if (typeof value !== 'string' || !/^[0-9]{1,5}$/.test(value)) {
    throw new Error('Enter a whole port number between 1 and 65535.');
  }
  const port = Number(value);
  if (port < 1 || port > 65535) {
    throw new Error('Enter a whole port number between 1 and 65535.');
  }
  return port;
}

export function checkPort(snapshot, port, protocol) {
  const occupied = new Set(snapshot.entries.filter(row => row.protocol === protocol).map(row => row.port));
  const owners = snapshot.entries.filter(row => row.protocol === protocol && row.port === port);
  const available = occupied.has(port) ? false : snapshot.complete ? true : null;
  const alternatives = [];
  if (available === false && snapshot.complete) {
    const start = port >= 1024 && port < 65535 ? port + 1 : 1024;
    for (let offset = 0; offset < 64512 && alternatives.length < 5; offset++) {
      const candidate = 1024 + ((start - 1024 + offset) % 64512);
      if (candidate !== port && !occupied.has(candidate)) alternatives.push(candidate);
    }
  }
  return { port, protocol, available, owners, alternatives, complete: snapshot.complete, checkedAt: snapshot.checkedAt };
}

function decodeAddress(value, ipv6) {
  const bytes = value.match(/../g);
  if (!bytes || bytes.length !== (ipv6 ? 16 : 4)) throw new Error('Invalid address in Linux socket table.');
  if (!ipv6) return bytes.reverse().map(byte => parseInt(byte, 16)).join('.');
  const ordered = [];
  for (let i = 0; i < bytes.length; i += 4) ordered.push(...bytes.slice(i, i + 4).reverse());
  if (ordered.every(byte => byte === '00')) return '::';
  return ordered.join('').match(/.{4}/g).map(group => parseInt(group, 16).toString(16)).join(':');
}

export function parseSocketTable(text, protocol, ipv6 = false) {
  return text.trim().split('\n').slice(1).filter(line => line.trim()).flatMap(line => {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 10 || !/^[0-9A-F]+:[0-9A-F]{4}$/i.test(columns[1])) {
      throw new Error('Unrecognized Linux socket table format.');
    }
    if (protocol === 'tcp' && columns[3] !== '0A') return [];
    const [address, hexPort] = columns[1].split(':');
    const port = parseInt(hexPort, 16);
    if (!port) return [];
    return [{
      port, protocol, address: decodeAddress(address, ipv6), source: 'host',
      name: 'Host listener', detail: protocol === 'udp' ? 'Bound UDP socket' : 'Listening TCP socket',
      containerPort: null, containerId: null
    }];
  });
}

export function dockerEntries(containers) {
  return containers.flatMap(container => (container.Ports ?? []).filter(binding => binding.PublicPort && ['tcp', 'udp'].includes(binding.Type)).map(binding => ({
    port: binding.PublicPort,
    protocol: binding.Type,
    address: binding.IP || '0.0.0.0',
    source: 'docker',
    name: container.Names?.[0]?.replace(/^\//, '') || container.Id.slice(0, 12),
    detail: container.Image,
    containerPort: binding.PrivatePort,
    containerId: container.Id
  })));
}
