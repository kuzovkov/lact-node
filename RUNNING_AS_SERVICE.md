# Running lact-api as a systemd Service

This guide covers how to run `server.js` as a background systemd service
so it starts automatically on boot and restarts on failure.

## Prerequisites

- Node.js v22+ installed (via nvm or package manager)
- `lact` CLI installed (`/usr/bin/lact`)
- Project located at `/home/user1/projects/lact-node/lact-api/`

## Quick Setup

### 1. Create the service unit file

Run as root or with sudo:

```bash
sudo nano /etc/systemd/system/lact-api.service
```

Paste the following (adjust paths if your setup differs):

```ini
[Unit]
Description=LACT GPU Stats API Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/user1/projects/lact-node/lact-api
ExecStart=/home/user1/.nvm/versions/node/v22.14.0/bin/node server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
User=user1
Group=user1

[Install]
WantedBy=multi-user.target
```

> **Note:** If Node.js is available in your PATH without nvm, you can use
> `ExecStart=/usr/bin/node server.js` instead. If using nvm system-wide,
> consider sourcing the nvm script or using the full path as shown above.

### 2. Reload systemd and enable the service

```bash
sudo systemctl daemon-reload
sudo systemctl enable lact-api.service
```

### 3. Start the service

```bash
sudo systemctl start lact-api.service
```

## Managing the Service

```bash
# Check status
sudo systemctl status lact-api

# View logs
sudo journalctl -u lact-api -f

# Restart after code changes
sudo systemctl restart lact-api

# Stop the service
sudo systemctl stop lact-api

# Disable auto-start on boot
sudo systemctl disable lact-api
```

## Verify It Works

```bash
curl http://127.0.0.1:3000/gpu/stat
```

You should see GPU stats output from `lact cli stats`.

## Troubleshooting

### Service fails to start

Check logs:
```bash
sudo journalctl -u lact-api --no-pager -n 50
```

### "node: not found" error

The `ExecStart` path must be absolute. Verify with:
```bash
ls -la /home/user1/.nvm/versions/node/v22.14.0/bin/node
```

### Port 3000 already in use

Either stop the conflicting process or change the port in `server.js`
(line 5: `const port = 3000;`).

### lact command not found

Ensure `lact` is installed and accessible:
```bash
which lact
lact cli stats
```

If lact requires sudo, add `sudo` to the ExecStart or configure
passwordless sudo for the lact command via `/etc/sudoers`.

## Optional: NVM-aware service

If you use nvm and want the service to respect nvm's Node version,
replace the `ExecStart` line with a wrapper script:

```ini
ExecStart=/home/user1/projects/lact-node/lact-api/start.sh
```

Create `start.sh` in the lact-api directory:

```bash
#!/bin/bash
export NVM_DIR="/home/user1/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
exec node server.js
```

Make it executable:

```bash
chmod +x /home/user1/projects/lact-node/lact-api/start.sh
```

Then reload and restart:

```bash
sudo systemctl daemon-reload
sudo systemctl restart lact-api
```
