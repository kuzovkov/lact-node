const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(cors());

// One block per system GPU: a line like "GPU 10DE:2204-1462:3881-0000:03:00.0:"
const GPU_HEADER_RE = /^GPU\s+\S+:$/;
// `lact cli list` entry, e.g.:
// "0: 10DE:2204-1462:3881-0000:03:00.0 (NVIDIA GeForce RTX 3090) [Dedicated]"
const LIST_LINE_RE = /^\s*(\d+):\s*([0-9A-Fa-f]{4}:[0-9A-Fa-f]{4}(?:-[0-9A-Za-z.:]+)*)\s*(?:\(([^)]*)\))?/;
// Device id shape, used to validate ?id= queries (only shell-safe characters)
const DEVICE_ID_RE = /^[0-9A-Fa-f]{4}:[0-9A-Fa-f]{4}(?:-[0-9A-Za-z.:]+)*$/;
// GPU indexes come from `lact cli list` and are only ever digits
const INDEX_RE = /^\d{1,3}$/;
const ANSI_RE = /\u001b\[[0-9;]*[A-Za-z]/g;

function stripAnsi(text) {
  return text.replace(ANSI_RE, '');
}

function execCmd(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr || '';
        reject(error);
      } else {
        resolve(stdout);
      }
    });
  });
}

// lact selects a GPU with `-g <index>`, where index comes from `lact cli list`.
// If your lact build uses a different flag, adjust here only.
function lactCmd(subcommand, gpuIndex) {
  const flag = gpuIndex === undefined || gpuIndex === null ? '' : ` -g ${gpuIndex}`;
  return `lact cli${flag} ${subcommand}`;
}

function parseGpuList(listOutput) {
  const gpus = [];
  for (const line of listOutput.split('\n')) {
    const match = line.match(LIST_LINE_RE);
    if (match) gpus.push({ index: match[1], id: match[2], name: (match[3] || '').trim() });
  }
  return gpus;
}

async function getGpuList() {
  try {
    return parseGpuList(stripAnsi(await execCmd('lact cli list')));
  } catch (error) {
    console.error(`lact cli list failed: ${error.message}`);
    return [];
  }
}

function countGpuBlocks(output) {
  return output.split('\n').filter((line) => GPU_HEADER_RE.test(line.trim())).length;
}

// Resolve a ?id= query param (numeric GPU index or full device id) to a
// validated list index; returns null for unknown or malformed ids.
async function resolveIndex(rawId) {
  const gpus = await getGpuList();
  if (INDEX_RE.test(rawId)) {
    // cannot validate against an empty list (lact cli list failed); lact itself
    // will error out for a bogus index, so pass it through in that case
    if (!gpus.length) return rawId;
    return gpus.some((g) => g.index === rawId) ? rawId : null;
  }
  if (!DEVICE_ID_RE.test(rawId)) return null;
  const found = gpus.find((g) => g.id === rawId);
  return found ? found.index : null;
}

// Run a `lact cli` subcommand for every installed GPU and concatenate the raw
// output blocks. The default invocation is tried first; if it reports fewer
// GPU blocks than `lact cli list` shows cards, the subcommand is re-run per
// device with -g <index> and the per-device blocks replace the default output.
async function forAllGpus(subcommand) {
  const gpus = await getGpuList();

  let output = '';
  let defaultError = null;
  try {
    output = stripAnsi(await execCmd(lactCmd(subcommand)));
  } catch (error) {
    defaultError = error;
    console.error(`lact cli ${subcommand} failed: ${error.message}`);
  }

  if (gpus.length > countGpuBlocks(output)) {
    const perDevice = await Promise.all(gpus.map((gpu) =>
      execCmd(lactCmd(subcommand, gpu.index))
        .then(stripAnsi)
        .catch((error) => {
          console.error(`lact -g ${gpu.index} ${subcommand} failed: ${error.message}`);
          return '';
        })
    ));
    const combined = perDevice.join('');
    if (combined.trim()) return combined;
  }

  if (!output.trim() && defaultError) throw defaultError;
  return output;
}

function getIdParam(req) {
  const raw = req.query.id;
  return Array.isArray(raw) ? raw[0] : raw;
}

app.get('/gpu/list', (req, res) => {
  execCmd('lact cli list')
    .then((stdout) => res.send(stdout))
    .catch((error) => {
      console.error(`exec error: ${error}`);
      res.status(500).json({ error: error.message, stderr: error.stderr });
    });
});

async function serveSubcommand(req, res, subcommand) {
  const id = getIdParam(req);
  try {
    if (id !== undefined) {
      const index = await resolveIndex(id);
      if (index === null) {
        return res.status(404).json({ error: `unknown device: ${id}` });
      }
      return res.send(stripAnsi(await execCmd(lactCmd(subcommand, index))));
    }
    res.send(await forAllGpus(subcommand));
  } catch (error) {
    console.error(`exec error: ${error}`);
    res.status(500).json({ error: error.message, stderr: error.stderr });
  }
}

app.get('/gpu/info', (req, res) => serveSubcommand(req, res, 'info'));

app.get('/gpu/stat', (req, res) => serveSubcommand(req, res, 'stats'));

app.listen(port, () => {
  console.log(`lact-api listening at http://localhost:${port}`);
});
