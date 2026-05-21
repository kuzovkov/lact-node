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
let currentPanel;
let refreshTimer;
let statusBar;
function activate(context) {
    statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.text = '$(cpu) GPU';
    statusBar.tooltip = 'Click to open GPU Monitor';
    statusBar.command = 'gpuMonitor.showDashboard';
    statusBar.show();
    context.subscriptions.push(statusBar);
    const disposable = vscode.commands.registerCommand('gpuMonitor.showDashboard', showDashboard);
    context.subscriptions.push(disposable);
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
        if (statusBar) {
            statusBar.text = '$(cpu) GPU';
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
function fetchGpuData(url) {
    if (!currentPanel)
        return;
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                currentPanel.webview.postMessage({ type: 'data', data });
                updateStatusBar(data);
            }
            else {
                currentPanel.webview.postMessage({
                    type: 'error',
                    message: `HTTP ${res.statusCode}`,
                });
                if (statusBar) {
                    statusBar.text = '$(error) GPU';
                }
            }
        });
    }).on('error', (err) => {
        currentPanel.webview.postMessage({
            type: 'error',
            message: err.message,
        });
        if (statusBar) {
            statusBar.text = '$(error) GPU';
        }
    });
}
function updateStatusBar(raw) {
    const tempMatch = raw.match(/GPU:\s*(\d+)/i);
    if (tempMatch && statusBar) {
        const temp = tempMatch[1];
        statusBar.text = `$(cpu) ${temp}°C`;
        statusBar.tooltip = `GPU Temp: ${temp}°C\nClick to open GPU Monitor`;
    }
}
function getHtmlForWebview(webview, apiUrl, refreshInterval) {
    const dashboardPath = path.join(__dirname, '..', 'dashboard.html');
    let html = fs.readFileSync(dashboardPath, 'utf-8');
    html = html.replace('<script>', `<script>\nconst REFRESH_INTERVAL = ${refreshInterval};\nconst API_URL = '${apiUrl}';\n`);
    return html;
}
//# sourceMappingURL=extension.js.map