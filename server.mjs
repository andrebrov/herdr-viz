import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const host = '127.0.0.1';
const port = Number(process.env.PORT || 4777);
const refreshMs = 5000;
const beansRefreshMs = 30000;
const beansRepo = process.env.BEANS_REPO || null;
const tasksDir = process.env.BEANS_TASKS_DIR || null;
const ownersDir = process.env.BEANS_OWNERS_DIR || null;
const callsignsPath = process.env.HERDR_CALLSIGNS_FILE || join(homedir(), '.config/herdr/callsigns.tsv');
const reportsDir = process.env.STANDUP_DIR || null;
const retrosDir = process.env.RETRO_DIR || null;
const herdrCandidates = process.env.HERDR_BIN ? [process.env.HERDR_BIN] :
  ['herdr', join(homedir(), '.local/bin/herdr')];

let lastAttempt = 0;
let lastGood = [];
let lastUpdatedAt = null;
let lastError = null;
let pending = null;
let beansLastAttempt = 0;
let beansLastGood = [];
let beansLastUpdatedAt = null;
let beansLastError = null;
let beansPending = null;
let historyLastAttempt = 0;
let historyLastGood = { standups: [], retros: [] };
let historyLastError = null;
let historyPending = null;

function runCommand(candidates, args, options = {}) {
  return new Promise((resolve, reject) => {
    const run = index => {
      execFile(candidates[index], args, { timeout: 5000, maxBuffer: 8 * 1024 * 1024, ...options },
        (error, stdout, stderr) => {
          if (error?.code === 'ENOENT' && index + 1 < candidates.length) return run(index + 1);
          if (error) return reject(new Error(stderr.trim() || error.message));
          resolve(stdout);
      });
    };
    run(0);
  });
}

export function parseHerdrAgents(output, workspacesOutput = null, callsigns = new Map()) {
  const data = JSON.parse(output);
  const records = data?.result?.agents;
  if (!Array.isArray(records)) throw new Error('herdr agent list returned no agents array');
  let workspaces = [];
  if (workspacesOutput) {
    try { workspaces = JSON.parse(workspacesOutput)?.result?.workspaces || []; }
    catch { /* Callsigns are optional. */ }
  }
  const labels = new Map(workspaces.map(workspace => [workspace.workspace_id, workspace.label]));
  return records.filter(record => record && record.name).map(record => {
    const label = labels.get(record.workspace_id) || '';
    const suffix = ` · ${record.name}`;
    const labelCallsign = label.endsWith(suffix) ? label.slice(0, -suffix.length) : null;
    const rawState = String(record.agent_status || '').toLowerCase();
    return {
      name: record.name,
      kind: String(record.agent || 'other').toLowerCase(),
      state: ['working', 'idle', 'done', 'blocked', 'missing'].includes(rawState) ? rawState : 'missing',
      pane: record.pane_id || '-',
      cwd: record.cwd ? basename(record.cwd) : '-',
      title: record.terminal_title_stripped || record.terminal_title || '',
      callsign: labelCallsign || callsigns.get(record.name) || null,
    };
  });
}

async function readCallsigns() {
  const content = await readFile(callsignsPath, 'utf8').catch(() => '');
  return new Map(content.split(/\r?\n/).map(line => line.split('\t')).filter(parts =>
    parts.length >= 2 && parts[0] && parts[1]));
}

export async function getStatus() {
  if (pending) return pending;
  if (Date.now() - lastAttempt < refreshMs) return response();
  lastAttempt = Date.now();
  pending = Promise.all([
    runCommand(herdrCandidates, ['agent', 'list']),
    runCommand(herdrCandidates, ['workspace', 'list']).catch(() => null),
  ])
    .then(async ([agentsOutput, workspacesOutput]) => {
      const callsigns = await readCallsigns();
      lastGood = parseHerdrAgents(agentsOutput, workspacesOutput, callsigns);
      lastUpdatedAt = new Date().toISOString();
      lastError = null;
      return response();
    })
    .catch(error => {
      lastError = error.message;
      return response();
    })
    .finally(() => { pending = null; });
  return pending;
}

function response() {
  return {
    agents: lastGood,
    updatedAt: lastUpdatedAt,
    stale: lastError !== null,
    error: lastError !== null,
    errorMessage: lastError,
  };
}

async function readAssignments() {
  const assignments = new Map();
  const current = new Set();
  const seats = tasksDir ? await readdir(tasksDir).catch(() => []) : [];
  for (const seat of seats) {
    const line = await readFile(join(tasksDir, seat), 'utf8').catch(() => '');
    const bean = line.trim().split(/\s+/)[1];
    if (bean && bean !== 'none' && bean !== 'self-serve') {
      assignments.set(bean, seat);
      current.add(bean);
    }
  }
  const ownerFiles = ownersDir ? await readdir(ownersDir).catch(() => []) : [];
  for (const bean of ownerFiles) {
    if (assignments.has(bean)) continue;
    const owner = (await readFile(join(ownersDir, bean), 'utf8').catch(() => '')).trim();
    if (owner) assignments.set(bean, owner);
  }
  return { assignments, current };
}

function runBeans() {
  const candidates = process.env.BEANS_BIN ? [process.env.BEANS_BIN] :
    ['beans', join(homedir(), 'go/bin/beans'), join(homedir(), '.local/bin/beans')];
  return runCommand(candidates, ['list', '--json'], {
    cwd: beansRepo, timeout: 12000, maxBuffer: 32 * 1024 * 1024,
  }).then(output => {
    const records = JSON.parse(output);
    if (!Array.isArray(records)) throw new Error('beans list returned a non-array');
    return records;
  });
}

function beansResponse() {
  return {
    beans: beansLastGood,
    configured: Boolean(beansRepo),
    updatedAt: beansLastUpdatedAt,
    stale: beansLastError !== null,
    error: beansLastError !== null,
    errorMessage: beansLastError,
  };
}

export async function getBeans() {
  if (!beansRepo) return { beans: [], configured: false, updatedAt: null,
    stale: false, error: false, errorMessage: null };
  if (beansPending) return beansPending;
  if (Date.now() - beansLastAttempt < beansRefreshMs) return beansResponse();
  beansLastAttempt = Date.now();
  beansPending = Promise.all([runBeans(), readAssignments()])
    .then(([records, { assignments, current }]) => {
      beansLastGood = records.filter(bean => bean && typeof bean.id === 'string').map(bean => ({
        id: bean.id,
        title: bean.title || '',
        status: bean.status || '',
        priority: bean.priority || 'normal',
        type: bean.type || 'task',
        owner: assignments.get(bean.id) || (typeof bean.owner === 'string' ? bean.owner : null),
        current: current.has(bean.id),
        updatedAt: bean.updated_at || null,
      }));
      beansLastUpdatedAt = new Date().toISOString();
      beansLastError = null;
      return beansResponse();
    })
    .catch(error => {
      beansLastError = error.message;
      return beansResponse();
    })
    .finally(() => { beansPending = null; });
  return beansPending;
}

async function readHistoryFiles(directory, prefix) {
  if (!directory) return [];
  const names = (await readdir(directory).catch(() => []))
    .filter(name => name.endsWith('.md') && name.startsWith(`${prefix}-`));
  const dated = await Promise.all(names.map(async name => ({
    name,
    mtime: (await stat(join(directory, name)).catch(() => null))?.mtimeMs || 0,
  })));
  return Promise.all(dated.sort((a, b) => b.mtime - a.mtime).slice(0, 20).map(async ({ name, mtime }) => {
    const body = (await readFile(join(directory, name), 'utf8')).slice(0, 100000);
    return {
      id: name,
      title: body.match(/^#\s+(.+)$/m)?.[1] || name.replace(/\.md$/, ''),
      updatedAt: new Date(mtime).toISOString(),
      body,
    };
  }));
}

export async function getHistory() {
  if (historyPending) return historyPending;
  if (Date.now() - historyLastAttempt < beansRefreshMs) {
    return { ...historyLastGood, stale: historyLastError !== null, errorMessage: historyLastError };
  }
  historyLastAttempt = Date.now();
  historyPending = Promise.all([
    readHistoryFiles(reportsDir, 'standup'),
    readHistoryFiles(retrosDir, 'retro'),
  ]).then(([standups, retros]) => {
    historyLastGood = { standups, retros };
    historyLastError = null;
    return { ...historyLastGood, stale: false, errorMessage: null };
  }).catch(error => {
    historyLastError = error.message;
    return { ...historyLastGood, stale: true, errorMessage: historyLastError };
  }).finally(() => { historyPending = null; });
  return historyPending;
}

export const server = createServer(async (request, reply) => {
  const path = new URL(request.url, `http://${host}:${port}`).pathname;
  if (request.method !== 'GET') {
    reply.writeHead(405, { Allow: 'GET' }).end();
    return;
  }
  if (path === '/api/status') {
    const payload = await getStatus();
    reply.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    }).end(JSON.stringify(payload));
    return;
  }
  if (path === '/api/beans') {
    const payload = await getBeans();
    reply.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    }).end(JSON.stringify(payload));
    return;
  }
  if (path === '/api/history') {
    const payload = await getHistory();
    reply.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    }).end(JSON.stringify(payload));
    return;
  }
  if (path === '/') {
    try {
      const html = await readFile(join(root, 'index.html'));
      reply.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
    } catch {
      reply.writeHead(500).end('Could not load index.html');
    }
    return;
  }
  reply.writeHead(404).end('Not found');
});

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(port, host, () => {
    console.log(`Herdr Bridge at http://${host}:${port}`);
  });
}
