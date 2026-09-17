import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';

let currentPanel: vscode.WebviewPanel | undefined;
let refreshTimer: NodeJS.Timeout | undefined;
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

function showDashboard(): void {
  const config = vscode.workspace.getConfiguration('gpuMonitor');
  const apiUrl = config.get<string>('apiUrl', 'http://127.0.0.1:3000/gpu/stat');
  const refreshInterval = config.get<number>('refreshInterval', 2000);

  if (currentPanel) {
    currentPanel.reveal();
    currentPanel.webview.postMessage({
      type: 'config',
      apiUrl,
      refreshInterval,
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

  currentPanel.webview.html = getHtmlForWebview(currentPanel.webview, apiUrl, refreshInterval);

  currentPanel.onDidDispose(() => {
    currentPanel = undefined;
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = undefined;
    }
    if (statusBar) {
      statusBar.text = '$(cpu) GPU';
    }
  });

  currentPanel.webview.onDidReceiveMessage((message) => {
    if (message.type === 'fetch') {
      const newConfig = vscode.workspace.getConfiguration('gpuMonitor');
      const url = newConfig.get<string>('apiUrl', 'http://127.0.0.1:3000/gpu/stat');
      fetchGpuData(url);
    }
  });

  fetchGpuData(apiUrl);
  refreshTimer = setInterval(() => {
    const newConfig = vscode.workspace.getConfiguration('gpuMonitor');
    const url = newConfig.get<string>('apiUrl', 'http://127.0.0.1:3000/gpu/stat');
    fetchGpuData(url);
  }, refreshInterval);
}

function fetchGpuData(url: string): void {
  if (!currentPanel) return;

  const client = url.startsWith('https') ? https : http;

  client.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        currentPanel!.webview.postMessage({ type: 'data', data });
        updateStatusBar(data);
      } else {
        currentPanel!.webview.postMessage({
          type: 'error',
          message: `HTTP ${res.statusCode}`,
        });
        if (statusBar) {
          statusBar.text = '$(error) GPU';
        }
      }
    });
  }).on('error', (err) => {
    currentPanel!.webview.postMessage({
      type: 'error',
      message: err.message,
    });
    if (statusBar) {
      statusBar.text = '$(error) GPU';
    }
  });
}

function updateStatusBar(raw: string): void {
  const readings: { label: string; value: number }[] = [];
  const patterns: [string, RegExp][] = [
    ['VRAM', /VRAM:\s*(\d+)/i],
    ['GPU Hotspot', /GPU Hotspot:\s*(\d+)/i],
    ['GPU', /GPU:\s*(\d+)/i],
  ];
  for (const [label, re] of patterns) {
    const m = raw.match(re);
    if (m) readings.push({ label, value: parseInt(m[1], 10) });
  }
  if (readings.length) {
    readings.sort((a, b) => b.value - a.value);
    const highest = readings[0];
    gpuTemp = String(highest.value);
    const details = readings.map((r) => `${r.label}: ${r.value}°C`).join(' | ');
    statusBar.text = `$(monitor) ${gpuTemp}°C`;
    statusBar.tooltip = `Highest Temp: ${gpuTemp}°C\n${details}\nClick to open GPU Monitor`;
  }
}

function getHtmlForWebview(webview: vscode.Webview, apiUrl: string, refreshInterval: number): string {
  const dashboardPath = path.join(__dirname, '..', 'dashboard.html');
  let html = fs.readFileSync(dashboardPath, 'utf-8');

  html = html.replace(
    '<script>',
    `<script>\nconst REFRESH_INTERVAL = ${refreshInterval};\nconst API_URL = '${apiUrl}';\nconst EXTENSION_VERSION = '${extVersion}';\n`
  );

  return html;
}
