# LACT GPU Monitor

A simple web dashboard for monitoring AMD GPU stats via the [LACT](https://gitlab.com/PlaceHolder/PlaceHolderBoi/lact) CLI tool.

## Architecture

```
┌─────────────────┐         ┌──────────────────┐
│   Browser UI     │  HTTP   │   Node.js API    │
│  dashboard.html  │◄───────►│   server.js      │
│  index.html      │         │  (port 3000)     │
└─────────────────┘         └────────┬─────────┘
                                    │ exec()
                                    ▼
                              ┌─────────────┐
                              │  lact cli   │
                              │   (Linux)   │
                              └─────────────┘
```

## Project Structure

```
lact-node/
├── lact-api/
│   ├── server.js          # Express API server
│   ├── package.json
│   └── node_modules/
├── dashboard.html         # Styled GPU stats dashboard
├── index.html            # Simple terminal-style viewer
├── RUNNING_AS_SERVICE.md # systemd service setup guide
├── vscode-extension/    # VS Code extension for GPU monitoring
│   ├── src/extension.ts
│   ├── package.json
│   └── tsconfig.json
└── README.md            # This file
 ```

## VS Code Extension

A VS Code extension is included that provides an in-editor GPU monitoring dashboard.

### Compile the Extension

```bash
cd vscode-extension
npm install
npm run compile
```

This will produce `dist/extension.js` (the bundled extension entry point).

### Install the Extension

#### Option 1: Load from VS Code (development)

1. Open the `vscode-extension` folder in VS Code
2. Press `Ctrl+Shift+D` to open the Run view
3. Click "Start Debugging" (or press `F5`) — this launches a new VS Code window with the extension loaded

#### Option 2: Install the `.vsix` package

1. Build the `.vsix` file:

   ```bash
   cd vscode-extension
   npx vsce package
   ```

2. Install it in VS Code:

   ```bash
   code --install-extension gpu-monitor-0.1.6.vsix
   ```

   Or via the UI: **Extensions** → `⋯` menu → **Install from VSIX…** → select the `.vsix` file.

#### Option 3: Manual install into the extensions folder

```bash
cd vscode-extension
npm run compile
mkdir -p ~/.vscode/extensions/gpu-monitor-0.1.6
cp dist/extension.js package.json tsconfig.json dashboard.html ~/.vscode/extensions/gpu-monitor-0.1.6/
```

Then restart VS Code.

### Using the Extension

After installation, open the Command Palette (`Ctrl+Shift+P`) and run **GPU Monitor: Show Dashboard**. You can also configure the API URL and refresh interval in VS Code settings under **GPU Monitor**.

## Features

- Real-time GPU monitoring (clock speed, temperature, power, VRAM, fan)
- Auto-refresh with configurable interval
- Dark terminal-style UI
- Runs as a background systemd service

## Prerequisites

- Linux system with AMD GPU
- [LACT](https://gitlab.com/PlaceHolder/PlaceHolderBoi/lact) installed and configured
- Node.js v18+

## Quick Start

### Install dependencies

```bash
cd lact-api
npm install
```

### Run manually

```bash
cd lact-api
node server.js
```

Then open `dashboard.html` or `index.html` in your browser.

### Run as service

See [RUNNING_AS_SERVICE.md](RUNNING_AS_SERVICE.md) for systemd setup.

## API

### GET `/gpu/stat`

Returns raw output from `lact cli stats`.

**Example response:**

```
GPU 10DE:2204-1462:3881-0000:03:00.0:
GPU Clockspeed: 210 MHz
VRAM Clockspeed: 405 MHz
GPU Voltage: 725 mV
Power Usage: 18.5/350 W
Temperatures: GPU Hotspot: 57°C, GPU: 47°C, VRAM: 50°C
VRAM Usage: 15875/24576 MiB
Throttling: No
Fan Speed: 0% (0 RPM)
Fan Control Mode: Automatic
```

## Configuration

The server listens on `127.0.0.1:3000` by default. To change the port, edit `lact-api/server.js` (line 5).

## License

ISC
