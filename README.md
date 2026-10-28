# PortAuthority

A lightweight dashboard for Docker published ports and Linux host TCP/UDP listeners. No npm dependencies, frontend build step, external fonts, or telemetry.

## Run on your Linux Docker server

Requires Docker Engine and Docker Compose. Host networking is intentional: it lets the dashboard read the **host network namespace's** `/proc/net` socket tables, including host-networked containers.

```sh
export DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)
docker compose up -d --build
```

The dashboard listens on **127.0.0.1:8787 on the Docker server**. Access it remotely through an SSH tunnel:

```sh
ssh -L 8787:127.0.0.1:8787 your-user@your-docker-server
```

Then open http://localhost:8787. Change `PORT` in `compose.yaml` if 8787 is already taken. A port occupied only on another interface can still prevent a wildcard bind.

**Keep it private.** There is no built-in authentication. For shared access, use an authenticated HTTPS reverse proxy. Do not expose it directly to the internet. The app only makes read requests to Docker, but access to the Docker socket is powerful: a read-only mount does **not** make the Docker API read-only. Deploy only on a trusted host; a restricted socket proxy allowing only GET `/containers/json` is recommended for hardened deployments. This app never starts, stops, or modifies containers.

## Local preview

Requires Node.js 22 or newer.

```sh
npm run demo
```

Open http://localhost:8787. Demo mode is clearly labeled and uses sample data; it does not inspect your machine. Stop it with Ctrl+C.

For real data directly on Linux, run `npm start` as a user with access to the Docker socket. No package installation is needed.

```sh
npm test
```

## Features

- Auto-refreshing inventory every 15 seconds, with source, protocol, and text filters.
- Running containers' published TCP/UDP mappings, bind interfaces, images, and target ports.
- Linux IPv4/IPv6 TCP listeners and bound UDP sockets (not just Docker ports).
- Port checks with up to five unused non-privileged alternatives for the selected protocol.
- Explicit source errors and stale-data indicators. Missing sources never produce a false "available."
- Read-only API: `GET /api/ports` and `GET /api/check?port=8080&protocol=tcp`.

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `HOST` | `127.0.0.1` | Dashboard bind address; keep private |
| `PORT` | `8787` | Dashboard HTTP port |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Local Docker Unix socket path |
| `PROC_NET_PATH` | `/proc/net` | Network namespace socket-table directory |
| `DEMO` | `false` | Set exactly `true` for sample data |

## How to interpret results

Availability is conservative across **all interfaces**, separately for TCP and UDP. A port bound on loopback is treated as taken even if another interface might allow reuse. Suggestions start above the requested port (at least 1024), wrap at 65535, and skip occupied ports. They are observations, not reservations or a guarantee a later deployment will bind.

Docker mappings and host sockets can describe the same port; the inventory preserves both observations. The main count deduplicates by port/protocol. Host listener process names are not collected; host-networked containers appear as host listeners rather than attributed container mappings.

TCP tables include listening sockets, not established connections or TIME_WAIT. UDP tables include bound sockets, including connected UDP sockets. These checks do not model OS reserved ranges, firewall policy, transient sockets, privileged-port permissions, Swarm ingress reservations, or other network namespaces. Stopped-container configurations are not active reservations.

The production deployment targets **Linux Docker Engine**. Native Windows/macOS local mode reports missing Linux tables instead of pretending they are empty; use demo mode to preview, and deploy to your Linux server for real host visibility. Docker Desktop's VM is not the Windows/macOS host.
