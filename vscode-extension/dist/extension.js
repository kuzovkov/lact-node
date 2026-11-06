"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const https = __importStar(require("https"));
const http = __importStar(require("http"));
const DEFAULT_API_URL = 'http://127.0.0.1:3000/gpu/stat';
const GPU_HEADER_RE = /^GPU\s+\S+:$/;
const INFO_REFRESH_MS = 30000; // device names rarely change; refresh slowly
let currentPanel;
let refreshTimer;
let infoTimer;
let statusBar;
let gpuTemp = '';
let extVersion = '';
function activate(context) {
    extVersion = context.extension?.packageJSON?.version ?? '';
    statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.text = '$(cpu) GPU';
    statusBar.tooltip = 'Click to open GPU Monitor';
    statusBar.command = 'gpuMonitor.showDashboard';
    statusBar.show();
    context.subscriptions.push(statusBar);
    const disposable = vscode.commands.registerCommand('gpuMonitor.showDashboard', showDashboard);
    context.subscriptions.push(disposable);
}
function apiUrl() {
    return vscode.workspace.getConfiguration('gpuMonitor').get('apiUrl', DEFAULT_API_URL);
}
function infoUrlFrom(apiUrlValue) {
    if (/\/gpu\/stat\/?$/.test(apiUrlValue)) {
        return apiUrlValue.replace(/\/stat\/?$/, '/info');
    }
    return undefined;
}
function refreshInterval() {
    return vscode.workspace.getConfiguration('gpuMonitor').get('refreshInterval', 2000);
}
function showDashboard() {
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
    currentPanel = vscode.window.createWebviewPanel('gpuMonitor', 'GPU Monitor', vscode.ViewColumn.One, {
        enableScripts: true,
        retainContextWhenHidden: true,
    });
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
function httpGet(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(body);
                }
                else {
                    reject(new Error(`HTTP ${res.statusCode}`));
                }
            });
        }).on('error', reject);
    });
}
function fetchGpuData(url) {
    if (!currentPanel)
        return;
    httpGet(url).then((body) => {
        if (!currentPanel)
            return;
        currentPanel.webview.postMessage({ type: 'data', data: body });
        updateStatusBar(body);
    }).catch((err) => {
        if (!currentPanel)
            return;
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
function fetchGpuInfo(statsUrl) {
    if (!currentPanel)
        return;
    const url = infoUrlFrom(statsUrl);
    if (!url)
        return;
    httpGet(url).then((body) => {
        if (!currentPanel)
            return;
        currentPanel.webview.postMessage({ type: 'info', data: body });
    }).catch(() => {
        // info endpoint may be unavailable on older lact-api versions
    });
}
// Split raw `lact cli stats` output into per-GPU blocks keyed by device id.
function splitGpuBlocks(raw) {
    const blocks = [];
    let current = null;
    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (GPU_HEADER_RE.test(trimmed)) {
            if (current)
                blocks.push(current);
            current = { id: trimmed.replace(/:$/, ''), body: '' };
            continue;
        }
        if (current)
            current.body += line + '\n';
    }
    if (current)
        blocks.push(current);
    return blocks;
}
function updateStatusBar(raw) {
    const blocks = splitGpuBlocks(raw);
    if (!blocks.length)
        return;
    const patterns = [
        ['VRAM', /VRAM:\s*(\d+)/i],
        ['GPU Hotspot', /GPU Hotspot:\s*(\d+)/i],
        ['GPU', /GPU:\s*(\d+)/i],
    ];
    const allReadings = [];
    const gpuHighest = [];
    for (const block of blocks) {
        let highest = null;
        for (const [label, re] of patterns) {
            const m = block.body.match(re);
            if (!m)
                continue;
            const value = parseInt(m[1], 10);
            allReadings.push({ gpu: block.id, label, value });
            if (!highest || value > highest.value)
                highest = { label, value };
        }
        if (highest)
            gpuHighest.push({ gpu: block.id, value: highest.value });
    }
    if (!gpuHighest.length)
        return;
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
function getHtmlForWebview(webview, apiUrlValue, refreshIntervalValue) {
    const dashboardPath = path.join(__dirname, '..', 'dashboard.html');
    let html = fs.readFileSync(dashboardPath, 'utf-8');
    html = html.replace('<script>', `<script>\nconst REFRESH_INTERVAL = ${refreshIntervalValue};\nconst API_URL = '${apiUrlValue}';\nconst EXTENSION_VERSION = '${extVersion}';\n`);
    return html;
}
//# sourceMappingURL=extension.js.map