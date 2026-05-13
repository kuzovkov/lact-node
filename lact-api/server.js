const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const app = express();
const port = 3000;

app.use(cors());

app.get('/gpu/stat', (req, res) => {
  exec('lact cli stats', (error, stdout, stderr) => {
    if (error) {
      console.error(`exec error: ${error}`);
      return res.status(500).json({ error: error.message, stderr: stderr });
    }
    res.send(stdout);
  });
});

app.listen(port, () => {
  console.log(`lact-api listening at http://localhost:${port}`);
});
