const $ = selector => document.querySelector(selector);
let snapshot = null;
let source = 'all';
let refreshing = false;
let lastSuccess = null;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

async function getJSON(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) {
    const body = await response.json();
    throw new Error(body.error || `Request failed (${response.status}).`);
  }
  return response.json();
}

function renderRows() {
  if (!snapshot) return;
  const search = $('#search').value.toLowerCase().trim();
  const protocol = $('#protocol-filter').value;
  const rows = snapshot.entries.filter(row =>
    (source === 'all' || row.source === source) &&
    (protocol === 'all' || row.protocol === protocol) &&
    `${row.port} ${row.name} ${row.detail} ${row.address} ${row.containerPort ?? ''}`.toLowerCase().includes(search)
  );
  const body = $('#port-rows');
  body.replaceChildren();
  for (const row of rows) {
    const tr = element('tr');
    const port = element('td');
    port.append(element('span', '', 'port-led'), element('span', String(row.port), 'port-number'));
    const protocolCell = element('td');
    protocolCell.append(element('span', row.protocol.toUpperCase(), `protocol ${row.protocol}`));
    const service = element('td', undefined, 'service');
    service.append(element('span', row.name), element('small', row.detail));
    tr.append(port, protocolCell, service, element('td', row.address, 'mono'),
      element('td', row.containerPort ? `${row.containerPort}` : '\u2014', 'mono'),
      element('td', row.source === 'docker' ? 'Docker' : 'Host', `source ${row.source}`));
    body.append(tr);
  }
  if (!rows.length) {
    const tr = element('tr');
    const td = element('td', snapshot.entries.length ? 'No ports match these filters.' : snapshot.complete ? 'No published ports or host listeners found.' : 'No data available. Resolve the connection errors above.', 'empty');
    td.colSpan = 6;
    tr.append(td);
    body.append(tr);
  }
  $('#row-count').textContent = snapshot.entries.length;
  $('#table-summary').textContent = `Showing ${rows.length} of ${snapshot.entries.length} observations \u00b7 Docker and host sockets may overlap`;
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  $('#refresh').disabled = true;
  try {
    snapshot = await getJSON('/api/ports');
    lastSuccess = new Date(snapshot.checkedAt).toLocaleTimeString();
    $('#demo-banner').hidden = !snapshot.demo;
    $('#errors').hidden = !snapshot.errors.length;
    $('#errors').textContent = snapshot.errors.length
      ? `Partial visibility \u2014 availability cannot be confirmed until all sources are connected. ${snapshot.errors.map(error => `${error.source}: ${error.message}`).join(' | ')}`
      : '';
    const distinct = entries => new Set(entries.map(row => `${row.port}/${row.protocol}`)).size;
    $('#port-count').textContent = distinct(snapshot.entries);
    $('#container-count').textContent = new Set(snapshot.entries.filter(row => row.source === 'docker').map(row => row.containerId)).size;
    $('#host-count').textContent = distinct(snapshot.entries.filter(row => row.source === 'host'));
    $('#status').textContent = `${snapshot.demo ? 'Sample data' : snapshot.complete ? 'All sources connected' : 'Some sources unavailable'} \u00b7 Updated ${lastSuccess}`;
    renderRows();
  } catch (error) {
    $('#errors').hidden = false;
    $('#errors').textContent = `Connection failed: ${error.message}`;
    $('#status').textContent = lastSuccess ? `Data is stale \u00b7 Last updated ${lastSuccess}` : 'Server unavailable';
    if (!snapshot) {
      const td = element('td', 'Unable to load inventory. Check the connection and refresh.', 'empty');
      td.colSpan = 6;
      const tr = element('tr');
      tr.append(td);
      $('#port-rows').replaceChildren(tr);
    }
  } finally {
    refreshing = false;
    $('#refresh').disabled = false;
  }
}

$('#check-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#check-button');
  const result = $('#check-result');
  button.disabled = true;
  result.hidden = false;
  result.className = '';
  result.textContent = 'Checking Docker and host listeners...';
  try {
    const query = new URLSearchParams({ port: $('#port').value, protocol: $('#protocol').value });
    const check = await getJSON(`/api/check?${query}`);
    result.replaceChildren();
    const label = `${check.port}/${check.protocol.toUpperCase()}`;
    result.className = check.available === false ? 'busy' : check.available === null ? 'unknown' : '';
    result.append(element('div', `${check.demo ? '[DEMO] ' : ''}${label} ${check.available === true ? 'is available' : check.available === false ? 'is already in use' : 'could not be confirmed available'}`, 'result-heading'));
    if (check.owners.length) result.append(element('div', `Observed on: ${[...new Set(check.owners.map(row => `${row.name} (${row.address})`))].join(', ')}`));
    if (!check.complete) result.append(element('div', `Incomplete visibility: ${check.errors.map(error => `${error.source}: ${error.message}`).join(' | ')}. No available alternatives can be confirmed.`));
    if (check.available === true) result.append(element('div', 'No published mapping or bound listener found for this protocol. Recheck before deploying.'));
    if (check.alternatives.length) {
      const alternatives = element('div', undefined, 'alternatives');
      alternatives.append(element('span', 'Try instead:'));
      for (const port of check.alternatives) {
        const option = element('button', String(port), 'port-option');
        option.type = 'button';
        option.title = `Check port ${port} again`;
        option.addEventListener('click', () => {
          $('#port').value = port;
          $('#check-form').requestSubmit();
        });
        alternatives.append(option);
      }
      result.append(alternatives);
    } else if (check.available === false && check.complete) {
      result.append(element('div', 'No unused non-privileged alternatives were found.'));
    }
    result.append(element('div', `Checked ${new Date(check.checkedAt).toLocaleTimeString()}. Availability can change.`));
  } catch (error) {
    result.className = 'unknown';
    result.textContent = `Port check failed: ${error.message}`;
  } finally {
    button.disabled = false;
  }
});

for (const tab of document.querySelectorAll('[data-source]')) {
  tab.addEventListener('click', () => {
    source = tab.dataset.source;
    for (const other of document.querySelectorAll('[data-source]')) {
      other.classList.toggle('selected', other === tab);
      other.setAttribute('aria-pressed', String(other === tab));
    }
    renderRows();
  });
}
$('#search').addEventListener('input', renderRows);
$('#protocol-filter').addEventListener('change', renderRows);
$('#refresh').addEventListener('click', refresh);
await refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
