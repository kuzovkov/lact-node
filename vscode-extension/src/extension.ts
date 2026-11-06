import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';

const DEFAULT_API_URL = 'http://127.0.0.1:3000/gpu/stat';
const GPU_HEADER_RE = /^GPU\s+\S+:$/;
const INFO_REFRESH_MS = 30000; // device names rarely change; refresh slowly

let currentPanel: vscode.WebviewPanel | undefined;
let refreshTimer: NodeJS.Timeout | undefined;
let infoTimer: NodeJS.Timeout | undefined;
let statusBar: vscode.StatusBarItem;
let gpuTemp: string = '';
let extVersion: string = '';

export function activate(context: vscode.ExtensionContext) {
  extVersion = context.extension?.packageJSON?.version ?? '';
  statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBar.text = '$(cpu) GPU';
  statusBar.tooltip = 'Click to open GPU Monitor';
  statusBar.command = 'gpuMonitor.showDashboard';
  statusBar.show();
  context.subscriptions.push(statusBar);

  const disposable = vscode.commands.registerCommand('gpuMonitor.showDashboard', showDashboard);
  context.subscriptions.push(disposable);
}

function apiUrl(): string {
  return vscode.workspace.getConfiguration('gpuMonitor').get<string>('apiUrl', DEFAULT_API_URL);
}

function infoUrlFrom(apiUrlValue: string): string | undefined {
  if (/\/gpu\/stat\/?$/.test(apiUrlValue)) {
    return apiUrlValue.replace(/\/stat\/?$/, '/info');
  }
  return undefined;
}

function refreshInterval(): number {
  return vscode.workspace.getConfiguration('gpuMonitor').get<number>('refreshInterval', 2000);
}

function showDashboard(): void {
  const apiUrlValue = apiUrl();
  const interval = refreshInterval();

  if (currentPanel) {
    currentPanel.reveal();
    currentPanel.webview.postMessage({
      type: 'config',
      apiUrl: apiUrlValue,
      refreshInterval: interval,
    });
    return;
  }

  currentPanel = vscode.window.createWebviewPanel(
    'gpuMonitor',
    'GPU Monitor',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    }
  );

  currentPanel.webview.html = getHtmlForWebview(currentPanel.webview, apiUrlValue, interval);

  currentPanel.onDidDispose(() => {
    currentPanel = undefined;
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = undefined;
    }
    if (infoTimer) {
      clearInterval(infoTimer);
      infoTimer = undefined;
    }
    if (statusBar) {
      statusBar.text = '$(cpu) GPU';
    }
  });

  currentPanel.webview.onDidReceiveMessage((message) => {
    if (message.type === 'fetch') {
      fetchGpuData(apiUrl());
    }
  });

  fetchGpuData(apiUrlValue);
  refreshTimer = setInterval(() => fetchGpuData(apiUrl()), interval);

  fetchGpuInfo(apiUrlValue);
  infoTimer = setInterval(() => fetchGpuInfo(apiUrl()), INFO_REFRESH_MS);
}

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    }).on('error', reject);
  });
}

function fetchGpuData(url: string): void {
  if (!currentPanel) return;

  httpGet(url).then((body) => {
    if (!currentPanel) return;
    currentPanel.webview.postMessage({ type: 'data', data: body });
    updateStatusBar(body);
  }).catch((err: Error) => {
    if (!currentPanel) return;
    currentPanel.webview.postMessage({
      type: 'error',
      message: err.message,
    });
    if (statusBar) {
      statusBar.text = '$(error) GPU';
    }
  });
}

// Optional GPU names (lact cli info); failures are silently ignored.
function fetchGpuInfo(statsUrl: string): void {
  if (!currentPanel) return;
  const url = infoUrlFrom(statsUrl);
  if (!url) return;

  httpGet(url).then((body) => {
    if (!currentPanel) return;
    currentPanel.webview.postMessage({ type: 'info', data: body });
  }).catch(() => {
    // info endpoint may be unavailable on older lact-api versions
  });
}

// Split raw `lact cli stats` output into per-GPU blocks keyed by device id.
function splitGpuBlocks(raw: string): { id: string; body: string }[] {
  const blocks: { id: string; body: string }[] = [];
  let current: { id: string; body: string } | null = null;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (GPU_HEADER_RE.test(trimmed)) {
      if (current) blocks.push(current);
      current = { id: trimmed.replace(/:$/, ''), body: '' };
      continue;
    }
    if (current) current.body += line + '\n';
  }
  if (current) blocks.push(current);
  return blocks;
}

function updateStatusBar(raw: string): void {
  const blocks = splitGpuBlocks(raw);
  if (!blocks.length) return;

  const patterns: [string, RegExp][] = [
    ['VRAM', /VRAM:\s*(\d+)/i],
    ['GPU Hotspot', /GPU Hotspot:\s*(\d+)/i],
    ['GPU', /GPU:\s*(\d+)/i],
  ];

  const allReadings: { gpu: string; label: string; value: number }[] = [];
  const gpuHighest: { gpu: string; value: number }[] = [];
  for (const block of blocks) {
    let highest: { label: string; value: number } | null = null;
    for (const [label, re] of patterns) {
      const m = block.body.match(re);
      if (!m) continue;
      const value = parseInt(m[1], 10);
      allReadings.push({ gpu: block.id, label, value });
      if (!highest || value > highest.value) highest = { label, value };
    }
    if (highest) gpuHighest.push({ gpu: block.id, value: highest.value });
  }

  if (!gpuHighest.length) return;
  gpuHighest.sort((a, b) => b.value - a.value);
  gpuTemp = String(gpuHighest[0].value);

  const gpuCount = gpuHighest.length;
  const tooltipLines = [`Highest Temp: ${gpuTemp}°C (${gpuHighest[0].gpu})`];
  if (gpuCount > 1) {
    tooltipLines.push(`GPU count: ${gpuCount}`);
  }
  tooltipLines.push('');
  for (const gpu of gpuHighest) {
    const sensors = allReadings
      .filter((r) => r.gpu === gpu.gpu)
      .sort((a, b) => b.value - a.value)
      .map((r) => `${r.label}: ${r.value}°C`)
      .join(' | ');
    tooltipLines.push(`${gpu.gpu}: ${sensors}`);
  }
  tooltipLines.push('Click to open GPU Monitor');

  statusBar.text = `$(monitor) ${gpuTemp}°C`;
  statusBar.tooltip = tooltipLines.join('\n');
}

function getHtmlForWebview(webview: vscode.Webview, apiUrlValue: string, refreshIntervalValue: number): string {
  const dashboardPath = path.join(__dirname, '..', 'dashboard.html');
  let html = fs.readFileSync(dashboardPath, 'utf-8');

  html = html.replace(
    '<script>',
    `<script>\nconst REFRESH_INTERVAL = ${refreshIntervalValue};\nconst API_URL = '${apiUrlValue}';\nconst EXTENSION_VERSION = '${extVersion}';\n`
  );

  return html;
}
