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
let currentPanel;
let refreshTimer;
let statusBar;
let gpuTemp = '';
function activate(context) {
    statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.text = '$(monitor) GPU Monitor';
    statusBar.tooltip = 'Click to open GPU Monitor';
    statusBar.command = 'gpuMonitor.showDashboard';
    statusBar.show();
    context.subscriptions.push(statusBar);
    context.subscriptions.push(vscode.commands.registerCommand('gpuMonitor.showDashboard', showDashboard));
}
function showDashboard() {
    const config = vscode.workspace.getConfiguration('gpuMonitor');
    const apiUrl = config.get('apiUrl', 'http://127.0.0.1:3000/gpu/stat');
    const refreshInterval = config.get('refreshInterval', 2000);
    if (currentPanel) {
        currentPanel.reveal();
        currentPanel.webview.postMessage({
            type: 'config',
            apiUrl,
            refreshInterval,
        });
        return;
    }
    currentPanel = vscode.window.createWebviewPanel('gpuMonitor', 'GPU Monitor', vscode.ViewColumn.One, {
        enableScripts: true,
        retainContextWhenHidden: true,
    });
    currentPanel.webview.html = getHtmlForWebview(currentPanel.webview, apiUrl, refreshInterval);
    currentPanel.onDidDispose(() => {
        currentPanel = undefined;
        if (refreshTimer) {
            clearInterval(refreshTimer);
            refreshTimer = undefined;
        }
    });
    currentPanel.webview.onDidReceiveMessage((message) => {
        if (message.type === 'fetch') {
            const newConfig = vscode.workspace.getConfiguration('gpuMonitor');
            const url = newConfig.get('apiUrl', 'http://127.0.0.1:3000/gpu/stat');
            fetchGpuData(url);
        }
    });
    fetchGpuData(apiUrl);
    refreshTimer = setInterval(() => {
        const newConfig = vscode.workspace.getConfiguration('gpuMonitor');
        const url = newConfig.get('apiUrl', 'http://127.0.0.1:3000/gpu/stat');
        fetchGpuData(url);
    }, refreshInterval);
}
async function fetchGpuData(url) {
    if (!currentPanel)
        return;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const text = await response.text();
        currentPanel.webview.postMessage({ type: 'data', data: text });
        updateStatusBar(text);
    }
    catch (err) {
        currentPanel.webview.postMessage({
            type: 'error',
            message: err instanceof Error ? err.message : String(err),
        });
        statusBar.text = '$(circle-slash) GPU Monitor';
        statusBar.tooltip = 'Failed to connect';
    }
}
function updateStatusBar(raw) {
    const tempMatch = raw.match(/GPU:\s*(\d+)/i);
    if (tempMatch) {
        gpuTemp = tempMatch[1];
        statusBar.text = `$(monitor) ${gpuTemp}°C`;
        statusBar.tooltip = `GPU Temp: ${gpuTemp}°C\nClick to open GPU Monitor`;
    }
}
function getHtmlForWebview(webview, apiUrl, refreshInterval) {
    const dashboardPath = path.join(__dirname, '..', 'dashboard.html');
    let html = fs.readFileSync(dashboardPath, 'utf-8');
    html = html.replace('<script>', `<script>\nconst REFRESH_INTERVAL = ${refreshInterval};\nconst API_URL = '${apiUrl}';\n`);
    return html;
}
//# sourceMappingURL=extension.js.map