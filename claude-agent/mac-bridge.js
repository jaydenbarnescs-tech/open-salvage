const express = require('express');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const PORT = 8081;
const CLAUDE = '/opt/homebrew/bin/claude';
const TOKEN = 'mgc-mac-bridge-2026';
const TIMEOUT = 120_000;
const LOG = path.join(process.env.HOME, 'claude-agent/logs/mac-bridge.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  fs.appendFileSync(LOG, line);
}

function getEnv() {
  const env = { ...process.env, PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/Users/jayden.csai/bin' };
  const tokenFile = path.join(process.env.HOME, '.claude-setup-token');
  if (fs.existsSync(tokenFile)) {
    env.CLAUDE_CODE_OAUTH_TOKEN = fs.readFileSync(tokenFile, 'utf-8').trim();
  }
  return env;
}

function auth(req, res, next) {
  if (req.headers['x-bridge-token'] !== TOKEN) return res.status(401).json({ error: 'unauthorized' });
  next();
}

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'mac-bridge' }));

app.post('/claude', auth, (req, res) => {
  const { prompt, model = 'sonnet', tools = [] } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  const toolArgs = tools.length ? `--allowedTools ${tools.join(',')}` : '';
  const promptEscaped = prompt.replace(/"/g, '\\"');
  const cmd = `${CLAUDE} -p --model ${model} --dangerously-skip-permissions ${toolArgs} "${promptEscaped}" < /dev/null 2>&1`;

  log(`/claude called: model=${model} prompt=${prompt.substring(0, 80)}...`);

  exec(cmd, { timeout: TIMEOUT, env: getEnv(), maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
    const output = (stdout || '').trim();
    log(`/claude response: ${output.substring(0, 100)}`);
    if (err && !output) {
      return res.status(500).json({ error: err.message, stderr });
    }
    res.json({ response: output });
  });
});

app.post('/run', auth, (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ error: 'command required' });
  log(`/run: ${command.substring(0, 100)}`);
  exec(command, { timeout: TIMEOUT, env: getEnv(), maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: err.message, stderr, code: err.code });
    res.json({ stdout, stderr });
  });
});

app.listen(PORT, () => log(`mac-bridge listening on port ${PORT}`));
