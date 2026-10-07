import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseHerdrAgents, parseBeanRelationships } from './server.mjs';

const parsed = parseHerdrAgents(JSON.stringify({ result: { agents: [{ name: 'claude-pm',
  agent: 'claude', agent_status: 'working', pane_id: 'pane-1', cwd: '/work/demo',
  terminal_title_stripped: 'Plan release', workspace_id: 'workspace-1' }] } }),
  JSON.stringify({ result: { workspaces: [{ workspace_id: 'workspace-1', label: 'Sulu · claude-pm' }] } }));
assert.deepEqual(parsed[0], { name: 'claude-pm', kind: 'claude', state: 'working',
  pane: 'pane-1', cwd: 'demo', title: 'Plan release', callsign: 'Sulu' });
const relations = parseBeanRelationships([
  { id: 'work-epic', type: 'epic' },
  { id: 'work-open', parent: 'work-epic', status: 'todo' },
  { id: 'work-draft', parent: 'work-epic', status: 'draft' },
  { id: 'work-done', parent: 'work-epic', status: 'completed' },
  { id: 'work-scrapped', parent: 'work-epic', status: 'scrapped' },
]);
assert.equal(relations.openChildrenById.get('work-epic'), 2);
assert.equal(relations.parentById.get('work-open'), 'work-epic');

const kinds = ['claude', 'codex', 'cursor', 'opencode', 'grok', 'agy', 'oss'];
const states = ['working', 'idle', 'done', 'blocked', 'missing'];
const fixture = Array.from({ length: 25 }, (_, i) => ({
  name: `agent-${String(i + 1).padStart(2, '0')}`, kind: kinds[i % kinds.length],
  state: states[i % states.length], pane: `pane-${i}`, cwd: `work-${i}`,
  title: `Task ${i + 1}`, callsign: null,
}));
fixture.push(
  { name: 'claude-pm', kind: 'claude', state: 'idle', pane: 'pane-sulu', cwd: 'pm',
    title: 'Plan release', callsign: 'Sulu' },
  { name: 'architect', kind: 'claude', state: 'working', pane: 'pane-scotty', cwd: 'architecture',
    title: 'Design service', callsign: 'Scotty' },
  { name: '-', kind: 'codex', state: 'working', pane: 'pane-unknown', cwd: 'scratch',
    title: 'Exploration', callsign: null },
  { name: 'claude-coder', kind: 'claude', state: 'working', pane: 'pane-chekov', cwd: 'coder',
    title: 'Build feature', callsign: 'Chekov' },
);
assert.equal(fixture.length, 29);
assert.equal(fixture[28].name, 'claude-coder');

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const originalScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(originalScript);
const script = originalScript
  .replace('    poll();',
    `    receive(${JSON.stringify({ agents: fixture, updatedAt: 'fixture', stale: false })});`)
  .replace('    pollBeans();',
    `    receiveBeans(${JSON.stringify({ beans: [
      { id: 'work-current', title: 'Current work item '.repeat(35) + 'END OF TITLE', status: 'in-progress',
        priority: 'high', owner: 'claude-coder', current: true },
      { id: 'work-old', title: 'Older owner record', status: 'in-progress',
        priority: 'critical', owner: 'claude-coder', current: false },
      { id: 'work-unowned', title: 'Unowned critical', status: 'todo',
        priority: 'critical', owner: null, current: false },
      { id: 'work-done', title: 'Finished today', status: 'completed',
        priority: 'normal', owner: 'claude-pm', updatedAt: new Date().toISOString() },
      { id: 'work-epic', title: 'Project container', type: 'epic', status: 'todo',
        priority: 'critical', owner: 'claude-coder', current: true, openChildren: 2 },
      { id: 'work-milestone', title: 'Release milestone', type: 'milestone', status: 'todo',
        priority: 'critical', owner: null, openChildren: 1 },
      { id: 'work-child', title: 'Build the child task', type: 'task', status: 'in-progress',
        priority: 'high', owner: 'architect', parentId: 'work-epic' },
    ], updatedAt: 'fixture', stale: false })});`)
  .replace('    pollHistory();',
    `    receiveHistory(${JSON.stringify({ standups: [{ id: 'standup-test.md',
      title: 'Standup test', updatedAt: '2026-10-06T12:00:00Z', body: '# Standup test\nToday was productive.' }],
      retros: [{ id: 'retro-test.md', title: 'Retro test', updatedAt: '2026-10-06T12:00:00Z',
        body: '# Retro test\nA lesson.' }] })});`)
  .replace('    function drawSprite(a) {', '    function drawSprite(a) { window.__drawn.push(a.id);')
  .replace('    requestAnimationFrame(frame);\n  })();',
    '    window.__fleetTest = { agents, fitText, displayName, unitName, currentBean, inspectionRows, update, receive, getQueue: () => visibleQueue, beanCounts, getWorld: () => ({ w: worldW, h: worldH }), getReader: () => reader };\n' +
    '    requestAnimationFrame(frame);\n  })();');
assert.notEqual(script, originalScript);

function render(width, height, dpr) {
  let frame;
  const drawn = [];
  const renderedText = [];
  const scales = [];
  const handlers = {};
  const context = {
    font: 'bold 7px monospace',
    measureText(value) {
      const size = Number(this.font.match(/(\d+)px/)?.[1] || 7);
      return { width: String(value).length * size * 0.602 };
    },
  };
  for (const method of ['fillRect', 'drawImage', 'beginPath', 'moveTo',
    'lineTo', 'stroke', 'rect', 'clip', 'save', 'restore', 'translate',
    'strokeRect', 'ellipse']) context[method] = () => {};
  context.scale = (x, y) => scales.push([x, y]);
  context.fillText = function(text, x, y) {
    if (this.fillStyle !== '#111923') renderedText.push({ text, x, y, align: this.textAlign,
      size: Number(this.font.match(/(\d+)px/)?.[1]) });
  };
  const makeCanvas = () => ({ style: {}, getContext: () => context,
    addEventListener(type, handler) { handlers[type] = handler; },
    getBoundingClientRect() { return { left: 0, top: 0 }; },
    setPointerCapture() {} });
  const canvas = makeCanvas();
  const window = { innerWidth: width, innerHeight: height, devicePixelRatio: dpr,
    __drawn: drawn, addEventListener() {} };
  const sandbox = {
    window,
    document: { getElementById: id => id === 'game' ? canvas : {}, createElement: makeCanvas },
    performance: { now: () => 0 },
    requestAnimationFrame: callback => { frame = callback; },
    setInterval() {},
    console: { assert(condition, message) { assert.ok(condition, message); } },
  };
  vm.runInNewContext(script, sandbox, { filename: 'index.html' });
  frame(16);
  assert.equal(canvas.width, width * dpr);
  assert.equal(canvas.height, height * dpr);
  assert.equal(canvas.style.width, `${width}px`);
  assert.equal(canvas.style.height, `${height}px`);
  assert.equal(scales.length, 1);
  assert.equal(scales[0][0], dpr);
  assert.equal(scales[0][1], dpr);
  assert.equal(context.imageSmoothingEnabled, false);

  const { agents, fitText, displayName, unitName, currentBean, inspectionRows,
    update, receive, getQueue, beanCounts, getWorld, getReader } = window.__fleetTest;
  assert.equal(agents.size, fixture.length, 'one unit per API agent');
  assert.equal(drawn.length, fixture.length, 'every unit was drawn');
  assert.equal(new Set(drawn).size, fixture.length, 'every drawn unit is distinct');
  assert.equal(currentBean([...agents.values()].find(a => a.name === 'claude-coder')).id,
    'work-current', 'containers never become unit cargo, even with a current owner');
  assert.equal(beanCounts().critical, 2, 'critical alerts count work items, not containers');
  assert.ok(getQueue().some(item => item.id === 'work-epic' && item.openChildren === 2));
  assert.ok(getQueue().some(item => item.id === 'work-milestone' && item.openChildren === 1));
  assert.ok(getQueue().findIndex(item => item.id === 'work-epic') <
    getQueue().findIndex(item => item.id === 'work-child'), 'child work follows its group header');
  assert.ok(renderedText.some(t => t.text === 'EPIC  /  2 OPEN CHILDREN'));
  assert.ok(renderedText.some(t => t.text.includes('work-epic') && t.text.includes('OWNER: claude-coder')));
  assert.ok(renderedText.some(t => t.text.includes('UNOWNED — ASSIGN UNIT')),
    'unowned critical work still has an alert');
  assert.ok(renderedText.some(t => t.text.includes('work-current')),
    'current bean cargo is visible');
  assert.ok(renderedText.some(t => t.text === '⚒ WORK QUEUE'), 'work queue is visible');
  assert.equal(new Set([...agents.values()].map(agent => `${agent.homeX},${agent.homeY}`)).size,
    fixture.length, 'every unit has its own cell');
  const boxes = [];
  for (const agent of agents.values()) {
    const name = fitText(unitName(agent), agent.cellWidth - 36, 14);
    const workspace = fitText(agent.cwd === '-' ? 'NO OUTPOST' : agent.cwd,
      agent.cellWidth - 12, 12);
    for (const [kind, text, size, y, h] of [
      ['name', name, 14, agent.cellTop + 2, agent.callsign ? 37 : 21],
      ['workspace', workspace, 12, agent.cellTop + 94, 17],
    ]) {
      const call = renderedText.find(entry => entry.text === text &&
        entry.x === Math.round(agent.homeX + (kind === 'name' ? 7 : 0)) &&
        entry.y === Math.round(y + 2) && entry.align === 'center');
      assert.ok(call, `${kind} was not drawn for ${agent.id}`);
      assert.ok(call.size >= size, `${kind} is too small for ${agent.id}`);
      const w = context.measureText.call({ font: `bold ${size}px monospace` }, text).width + 8;
      const box = { id: agent.id, kind, x: agent.homeX - w / 2, y, w, h };
      assert.ok(box.x >= 0 && box.x + box.w <= width, `${text} exceeds map width`);
      assert.ok(box.y >= 0 && box.y + box.h <= height - 206, `${text} exceeds map height`);
      boxes.push(box);
    }
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxes[i].id === boxes[j].id) continue;
      const a = boxes[i], b = boxes[j];
      assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x ||
        a.y + a.h <= b.y || b.y + b.h <= a.y,
      `${width}x${height}: ${a.kind} of ${a.id} overlaps ${b.kind} of ${b.id}`);
    }
  }
  assert.ok([...agents.values()].some(agent => displayName(agent) === 'unnamed (codex)'));
  assert.ok(renderedText.some(t => t.text === 'Sulu' && t.size === 14));
  assert.ok(renderedText.some(t => t.text === 'Scotty' && t.size === 14));
  assert.ok(renderedText.some(t => t.text === '✳' && t.size === 14));
  const queueX = width - Math.min(350, Math.floor(width * .24));
  handlers.pointerdown({ pointerId: 6, clientX: queueX + 40, clientY: 100 });
  handlers.pointerup({ clientX: queueX + 40, clientY: 100 });
  assert.ok(inspectionRows(width - 497 - 34).map(row => row.line).join(' ').includes('2 OPEN CHILDREN'),
    'clicking a container shows its child count in the inspector');
  const unit = [...agents.values()].find(agent => agent.name === 'claude-coder');
  handlers.pointerdown({ pointerId: 1, clientX: unit.x, clientY: unit.y - 12 });
  handlers.pointerup({ clientX: unit.x, clientY: unit.y - 12 });
  renderedText.length = 0;
  frame(32);
  assert.ok(renderedText.some(t => t.text.includes('work-current') && t.y >= height - 206),
    'clicking a unit shows its current bean in the selected unit panel');
  assert.ok(inspectionRows(width - 497 - 34).map(row => row.line).join(' ').includes('END OF TITLE'));
  const before = renderedText.filter(t => t.y >= height - 206).map(t => t.text).join('|');
  handlers.wheel({ clientX: 500, clientY: height - 50, deltaY: 100, preventDefault() {} });
  renderedText.length = 0;
  frame(48);
  const after = renderedText.filter(t => t.y >= height - 206).map(t => t.text).join('|');
  assert.notEqual(after, before, 'inspector scroll changes visible text');
  const sideX = width - Math.min(350, Math.floor(width * .24));
  const todayTabX = sideX + 10 + (Math.min(350, Math.floor(width * .24)) - 20) * .375;
  handlers.pointerdown({ pointerId: 4, clientX: todayTabX, clientY: 60 });
  handlers.pointerup({ clientX: todayTabX, clientY: 60 });
  handlers.pointerdown({ pointerId: 5, clientX: sideX + 40, clientY: 100 });
  handlers.pointerup({ clientX: sideX + 40, clientY: 100 });
  renderedText.length = 0;
  frame(64);
  assert.ok(renderedText.some(t => t.text.includes('work-done') && t.y >= height - 206),
    'today history selects a completed bean');
  const standupTabX = sideX + 10 + (Math.min(350, Math.floor(width * .24)) - 20) * .625;
  handlers.pointerdown({ pointerId: 2, clientX: standupTabX, clientY: 60 });
  handlers.pointerup({ clientX: standupTabX, clientY: 60 });
  handlers.pointerdown({ pointerId: 3, clientX: sideX + 40, clientY: 100 });
  handlers.pointerup({ clientX: sideX + 40, clientY: 100 });
  assert.equal(getReader()?.title, 'Standup test', 'standup history opens a report reader');
  const worker = [...agents.values()].find(agent => agent.name === 'agent-01');
  const completed = [...agents.values()].find(agent => agent.name === 'agent-03');
  const blocked = [...agents.values()].find(agent => agent.name === 'agent-04');
  const blockedPosition = [blocked.x, blocked.y];
  const bridge = getWorld();
  const beforeBridge = Math.hypot(completed.x - bridge.w / 2, completed.y - bridge.h / 2);
  update(20);
  assert.equal(worker.trip, 'peer', 'working unit gathers at the crystal field before a crew visit');
  assert.equal(worker.x, worker.resourceX);
  assert.equal(worker.y, worker.resourceY);
  assert.ok(Math.hypot(completed.x - bridge.w / 2, completed.y - bridge.h / 2) < beforeBridge,
    'completed unit heads to the bridge');
  assert.deepEqual([blocked.x, blocked.y], blockedPosition, 'blocked unit stays put');
  update(20);
  assert.equal(worker.trip, 'back', 'working unit visits another active unit');
  update(20);
  assert.equal(worker.trip, 'out', 'working unit returns to its outpost');
  update(20);
  assert.equal(worker.trip, 'bridge', 'next work cycle goes to the bridge');
  const pausedPosition = [worker.x, worker.y];
  receive({ agents: fixture.map(agent => agent.name === 'agent-01' ?
    { ...agent, state: 'blocked' } : agent), updatedAt: 'fixture', stale: false });
  update(2);
  assert.deepEqual([worker.x, worker.y], pausedPosition,
    'a newly blocked unit stops moving immediately');
  console.log(`${width}x${height} @${dpr}x: ${agents.size} distinct units, ${boxes.length} labels, no overlap; bean selection passes`);
}

render(1440, 900, 2);
render(1920, 1080, 1);
