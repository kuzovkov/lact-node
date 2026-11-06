---
name: lact-node
description: Work with the lact-node project (LACT GPU Monitor: Express API that shells out to `lact cli stats`, a browser dashboard, and a VS Code extension webview). Use when editing, running, debugging, or extending anything in this repo — server.js, dashboard.html, index.html, vscode-extension, or the systemd service.
---

<objective>
Provide the project-specific knowledge needed to safely modify, run, and debug the lact-node
stack: an Express API that returns raw `lact cli stats` stdout, three HTML/JS clients that
parse it, and a VS Code extension that polls it and injects a webview dashboard.
</objective>

<quick_start>
Run the API:
```bash
cd lact-api && npm install && npm start   # http://127.0.0.1:3000
curl http://127.0.0.1:3000/gpu/stat       # verify raw stats output
```
Build the VS Code extension (compilation is required after ANY extension.ts change):
```bash
cd vscode-extension && npm install && npm run compile   # tsc → dist/extension.js
npx vsce package                                        # produce .vsix
```
Restart the systemd service after API changes:
```bash
sudo systemctl restart lact-api && sudo journalctl -u lact-api -f
```
There is no test suite or linter; verify manually with curl + loading the dashboard.
</quick_start>

<architecture>
- `lact-api/server.js` — Express 5, CommonJS. Single route `GET /gpu/stat` that runs
  `exec('lact cli stats')` and sends raw stdout. Port 3000 hardcoded on line 5. CORS is
  wide open (`app.use(cors())`). `app.listen(port)` has no host binding, so it listens on
  all interfaces even though the README documents 127.0.0.1.
- `dashboard.html` (root) — browser dashboard; fetches `http://127.0.0.1:3000/gpu/stat`
  client-side.
- `index.html` (root) — minimal terminal-style raw viewer.
- `vscode-extension/` — extension "gpu-monitor". `src/extension.ts` creates a status bar
  item and a webview panel; it does all HTTP polling in the extension host (never inside
  the webview), then posts results to the webview.
- `vscode-extension/dashboard.html` — separate copy of the root dashboard, injected at
  runtime with `REFRESH_INTERVAL`, `API_URL`, `EXTENSION_VERSION` by string-replacing the
  first `<script>` tag.
- `lact-api/lact-api.service` — systemd unit template (User=root, nvm node path on
  ExecStart). `RUNNING_AS_SERVICE.md` is the operational guide.
- Extension settings: `gpuMonitor.apiUrl` (default `http://127.0.0.1:3000/gpu/stat`),
  `gpuMonitor.refreshInterval` (default 2000 ms, clamped 1000–60000).
</architecture>

<critical_contract>
The API has NO JSON schema — it returns raw `lact cli stats` text. The parsing regexes
live in THREE places that must stay in sync whenever the format or parsing changes:

1. `dashboard.html` → `parseGpuData()` (root, browser dashboard)
2. `vscode-extension/dashboard.html` → `parseGpuData()` (must remain identical to #1)
3. `vscode-extension/src/extension.ts` → `updateStatusBar()` (regexes for `VRAM:`,
   `GPU Hotspot:`, `GPU:`)

GPU blocks are delimited by lines matching `/^GPU\s+\S+:$/`. Sample format:

```
GPU 10DE:2204-1462:3881-0000:03:00.0:
GPU Clockspeed: 210 MHz
Power Usage: 18.5/350 W
Temperatures: GPU Hotspot: 57°C, GPU: 47°C, VRAM: 50°C
VRAM Usage: 15875/24576 MiB
Throttling: No
Fan Speed: 0% (0 RPM)
```
</critical_contract>

<webview_protocol>
Messages between extension host and webview:
- webview → host: `{type: 'fetch'}` (host re-reads settings, then fetches)
- host → webview: `{type: 'data', data}` or `{type: 'error', message}`
- on reveal of an existing panel: `{type: 'config', apiUrl, refreshInterval}`

The injection relies on `vscode-extension/dashboard.html` containing a bare `<script>`
tag as the first script; do not add attributes to it or place another script tag before it.
</webview_protocol>

<gotchas>
- The root `dashboard.html` and `vscode-extension/dashboard.html` are separate copies;
  dashboard UI changes usually must be applied to BOTH.
- Extension changes need `npm run compile` (or `npm run watch`) before they take effect;
  packaged .vsix files (e.g. `gpu-monitor-0.1.6.vsix`) are build artifacts.
- `lact` CLI must be on PATH for the API to work; some lact operations need sudo — see
  RUNNING_AS_SERVICE.md troubleshooting before changing the service unit.
- The systemd unit's `ExecStart` hardcodes the nvm node path
  (`/home/user1/.nvm/versions/node/v22.14.0/bin/node`); update it when the node version changes.
- Prereqs for anything to work: Linux + AMD GPU + lact installed + Node.js v18+.
- When changing the port or host binding in `server.js`, update: README.md,
  RUNNING_AS_SERVICE.md, the extension's two default apiUrl strings in package.json and
  extension.ts, and the fetch URL inside both dashboard.html copies.
</gotchas>

<success_criteria>
A change to this project is done when:
- API changes verified with `curl http://127.0.0.1:3000/gpu/stat` (service restarted if
  running under systemd).
- Parsing changes applied to all three parse sites (or the divergence is intentional and
  documented).
- `extension.ts` changes compiled (`npm run compile` exits clean) and, if UI-facing, the
  dashboard HTML is updated in both copies.
- Docs (README.md / RUNNING_AS_SERVICE.md / AGENTS.md) updated if commands, ports, or
  defaults changed.
</success_criteria>
