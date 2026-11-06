# AGENTS.md — lact-node

Guidance for AI coding agents working in this repository.

## Project Overview

**LACT GPU Monitor** — a small stack for monitoring AMD GPU stats on Linux via the
[LACT](https://gitlab.com/PlaceHolder/PlaceHolderBoi/lact) CLI:

```
┌──────────────────┐   HTTP    ┌────────────────┐   exec()   ┌────────────┐
│  Browser UI       │ ◄──────► │  Node.js API    │ ◄────────► │  lact cli  │
│  dashboard.html   │           │  lact-api/      │            │  (Linux)   │
│  index.html       │           │  port 3000      │            └────────────┘
└──────────────────┘            └────────────────┘
        ▲
        │ same dashboard.html is injected into a VS Code Webview
┌──────────────────┐
│  VS Code extension │  gpu-monitor (vscode-extension/)
│  status bar + webview
└──────────────────┘
```

There are **three clients** of the same data: `dashboard.html` (root), `index.html` (root),
and the VS Code extension (`vscode-extension/`). All consume the raw text output of
`lact cli stats`.

## Components

| Path | Purpose | Language / Runtime |
|------|---------|--------------------|
| `lact-api/server.js` | Express API server; `GET /gpu/list`, `/gpu/info`, `/gpu/stat` shell out to `lact cli list|info|stats` and return raw stdout; stats/info aggregate one block per GPU (enumerates GPUs via `lact cli list`, re-runs per device with `-g <index>` when needed); `?id=<index or device id>` selects a single GPU | Node.js (CommonJS), Express 5 |
| `lact-api/package.json` | API deps: `express` ^5, `cors` ^2 | — |
| `lact-api/lact-api.service` | systemd unit template (User=root) | systemd ini |
| `dashboard.html` | Styled GPU stats dashboard for the browser | Vanilla JS + HTML/CSS |
| `index.html` | Simple terminal-style raw viewer | Vanilla JS |
| `vscode-extension/src/extension.ts` | Extension host: status bar item, webview panel, polling via `http`/`https` | TypeScript (ESM-style imports, compiled with tsc) |
| `vscode-extension/dashboard.html` | Webview copy of the dashboard; injected with `API_URL`, `REFRESH_INTERVAL`, `EXTENSION_VERSION` constants | Vanilla JS |
| `RUNNING_AS_SERVICE.md` | systemd setup/troubleshooting guide | Docs |

## Commands

### API server
```bash
cd lact-api
npm install
npm start          # or: node server.js  → listens on http://127.0.0.1:3000
```
Verify: `curl http://127.0.0.1:3000/gpu/stat` (also `/gpu/list`, `/gpu/info`)

### VS Code extension
```bash
cd vscode-extension
npm install
npm run compile    # tsc -p ./  → dist/extension.js
npm run watch      # incremental
npx vsce package   # build .vsix (see README for install options)
```

### Tests / lint
No test suite or linter is configured (`npm test` in lact-api is a stub). Verify changes
by running the server and loading the dashboard manually, or via
`curl http://127.0.0.1:3000/gpu/stat`.

### systemd service
```bash
sudo systemctl restart lact-api
sudo journalctl -u lact-api -f
```
Unit file: `lact-api/lact-api.service` (template in repo; installed copy at
`/etc/systemd/system/lact-api.service`). `ExecStart` uses the nvm node binary path
(`/home/user1/.nvm/versions/node/v22.14.0/bin/node`) — update it if the node version changes.

## The Critical Contract: raw `lact cli` text parsing

The API returns **raw stdout text** — there is no JSON schema. `/gpu/stat` and
`/gpu/info` may contain **multiple GPU blocks** (one per installed card), aggregated
server-side. Stats example:

```
GPU 10DE:2204-1462:3881-0000:03:00.0:
=====================================
GPU Clockspeed: 210 MHz
VRAM Clockspeed: 405 MHz
GPU Voltage: 725 mV
Power Usage: 18.3/300 W
Temperatures: GPU Hotspot: 57°C, GPU: 47°C, VRAM: 50°C
VRAM Usage: 22402/24576 MiB
Throttling: No
Fan Speed: 24% (439 RPM)
Fan Control Mode: Curve
```

(`=====` separator lines follow each GPU header; `/gpu/info` blocks carry
`GPU Model:` as the human-readable name.)

This text is parsed by **regexes in three places** that must stay in sync:

1. `dashboard.html` → `parseGpuData()` (root, browser dashboard; also parses `GPU Model:`
   from `/gpu/info` to label cards)
2. `vscode-extension/dashboard.html` → `parseGpuData()` (webview dashboard — keep identical to #1)
3. `vscode-extension/src/extension.ts` → `updateStatusBar()` + `splitGpuBlocks()` (per-GPU
   blocks; `VRAM:`, `GPU Hotspot:`, `GPU:` patterns; status bar shows max across all GPUs)

If you change the parsing, change all three. GPU blocks are delimited by a line matching
`/^GPU\s+\S+:$/`. `lact cli list` is indexed, e.g.
`0: 10DE:2204-1462:3881-0000:03:00.0 (NVIDIA GeForce RTX 3090) [Dedicated]`, parsed via
`LIST_LINE_RE` in `server.js`. Only numeric GPU indexes (validated by `INDEX_RE`) are ever
interpolated into shell commands; `?id=` device-id queries are resolved to an index
against the list output (`DEVICE_ID_RE` is a shell-safe shape guard). If your lact build
uses a different device-selection flag than `-g`, change `lactCmd()` in `server.js`.

## Extension ↔ Webview protocol

`extension.ts` injects constants by replacing the first `<script>` tag in
`vscode-extension/dashboard.html` with:

```js
const REFRESH_INTERVAL = <ms>;
const API_URL = '<url>';
const EXTENSION_VERSION = '<ver>';
```

Messages: webview posts `{type:'fetch'}`; extension posts `{type:'data', data}`,
`{type:'error', message}`, or `{type:'info', data}` (raw `lact cli info` text, polled
every 30 s and used to label GPU cards with device names when stats lines lack them).
Settings keys: `gpuMonitor.apiUrl` (default `http://127.0.0.1:3000/gpu/stat`),
`gpuMonitor.refreshInterval` (default 2000 ms, clamped 1000–60000).

## Gotchas & Conventions

- **Port 3000** is the default in `lact-api/server.js` line 5, overridable via the `PORT`
  env var; CORS is wide open (`app.use(cors())`).
- The API shells out with `exec('lact cli …')` — the `lact` CLI must be on PATH
  (and may need sudo for some operations; see RUNNING_AS_SERVICE.md troubleshooting).
  Multi-GPU aggregation runs `lact cli list` then `lact cli -g <index> stats|info` per device.
- `server.js` listens on all interfaces by default (no host in `app.listen`) — the
  README documents `127.0.0.1`; keep this in mind for security-sensitive changes.
- The two `dashboard.html` files (root + extension) are separate copies; changes to the
  dashboard UI must usually be applied to both.
- The root dashboard fetches `http://127.0.0.1:3000/gpu/stat` from the browser; the
  extension polls from the extension host (never from the webview).
- No build step for the API; the extension requires `npm run compile` before any
  change to `extension.ts` takes effect.
- Prereqs for anything to work: Linux + AMD GPU + `lact` installed + Node.js v18+ (v22+ for the service guide).

## License

ISC
