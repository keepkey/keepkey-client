#!/usr/bin/env node
/**
 * Exit test for the browser-driving MCP tools (bex_snapshot/click/type/…).
 *
 * Serves its own fixture page on an ephemeral port and drives it through the
 * real stack: this script → vault POST /mcp → WS bridge → BEX background →
 * content script → DOM. Nothing is mocked; a pass means an agent can drive a
 * page in the user's Chrome for real.
 *
 * Preconditions (human, one-time):
 *   1. vault running on :1646, PATCHED per HANDOFF_vault_mcp_dumb_pipe.md
 *      (unpatched → tools/list omits the browser tools and this fails at step 1)
 *   2. extension loaded from dist/, options-page "Agent mode" toggle ON
 *
 *   KEEPKEY_API_KEY=<pairing key> node scripts/test-browser-tools.mjs
 *
 * Opens and closes one tab in your Chrome. Exits 0 on pass, 1 on failure,
 * 2 if the bridge is down (Agent mode off / extension not loaded).
 */

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const MCP_URL = 'http://localhost:1646/mcp';
const BROWSER_TOOLS = [
  'bex_tabs',
  'bex_navigate',
  'bex_snapshot',
  'bex_find',
  'bex_click',
  'bex_type',
  'bex_select',
  'bex_read_page',
  'bex_screenshot',
];

const API_KEY = process.env.KEEPKEY_API_KEY;
if (!API_KEY) {
  console.error('KEEPKEY_API_KEY is required (the vault bearer-authenticates /mcp).');
  console.error("Get the extension's key from the background console: chrome.storage.local.get('keepkey-api-key')");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, 'fixture-agent-page.html'), 'utf8');

let nextId = 1;
async function rpc(method, params) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, ...(params ? { params } : {}) }),
  });
  if (res.status === 401) throw new Error(`${method}: HTTP 401 — KEEPKEY_API_KEY is not a valid vault pairing key`);
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`${method}: rpc error ${body.error.code} ${body.error.message}`);
  return body.result;
}

/** Call a tool; throw on isError so a failed tool fails the test loudly. */
async function tool(name, args = {}) {
  const res = await rpc('tools/call', { name, arguments: args });
  if (res.isError) throw new Error(`${name} failed: ${res.content?.[0]?.text ?? 'unknown'}`);
  return res;
}
const toolText = async (name, args) => (await tool(name, args)).content[0].text;
const toolJson = async (name, args) => JSON.parse(await toolText(name, args));

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`ok: ${msg}`);
  } else {
    console.error(`FAIL: ${msg}`);
    failures++;
  }
}

/** Pull the ref out of a snapshot line like: - button "Swap" [ref=e3] [disabled] */
function refFor(snapshot, name) {
  const line = snapshot.split('\n').find(l => l.includes(`"${name}"`));
  return line?.match(/\[ref=(e\d+)\]/)?.[1];
}
const lineFor = (snapshot, name) => snapshot.split('\n').find(l => l.includes(`"${name}"`)) ?? '';

const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(fixture);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
console.log(`fixture served at ${url}\n`);

let tabId;
try {
  // 1. The catalog must include the browser tools — i.e. the vault is serving
  //    the BEX's catalog, not its own static list.
  const { tools } = await rpc('tools/list');
  const names = tools.map(t => t.name);
  if (!names.includes('bex_snapshot')) {
    console.error('FAIL: tools/list has no browser tools — is the vault patched per HANDOFF_vault_mcp_dumb_pipe.md?');
    console.error(`      tools/list returned: ${names.join(', ')}`);
    process.exit(1);
  }
  for (const t of BROWSER_TOOLS) assert(names.includes(t), `tools/list includes ${t}`);

  const status = JSON.parse((await rpc('tools/call', { name: 'bex_status', arguments: {} })).content[0].text);
  if (status.bridge !== 'up') {
    console.log('\nbridge is DOWN — load the extension and turn on Agent mode in its options page, then re-run');
    process.exit(2);
  }

  // 2. Open the fixture.
  const created = await toolJson('bex_tabs', { action: 'create', url });
  tabId = created.tabId;
  assert(typeof tabId === 'number', `bex_tabs create opened tab ${tabId}`);

  // 3. Snapshot: refs minted, roles/names right, disabled state visible, and
  //    the shadow-root button surfaced (deepQuery works).
  const snap = await toolText('bex_snapshot', { tabId });
  console.log(`\n--- bex_snapshot ---\n${snap}\n`);
  assert(/heading "Agent Fixture"/.test(snap), 'snapshot names the h1 heading');
  assert(refFor(snap, 'Connect Wallet'), 'snapshot mints a ref for the Connect Wallet button');
  assert(/textbox "You pay"/.test(snap), 'snapshot resolves the input label to an accessible name');
  assert(/\[disabled\]/.test(lineFor(snap, 'Swap')), 'snapshot reports Swap as disabled');
  assert(refFor(snap, 'Deep Shadow Button'), 'snapshot pierces the open shadow root');

  // 4. A disabled button must REFUSE the click rather than fire its handler —
  //    otherwise an agent gets a pass on gating a real user could never defeat.
  const early = await rpc('tools/call', {
    name: 'bex_click',
    arguments: { tabId, ref: refFor(snap, 'Swap'), element: 'Swap button (still disabled)' },
  });
  assert(early.isError && /element_disabled/.test(early.content[0].text), 'clicking a disabled button is refused');
  assert(!(await toolText('bex_read_page', { tabId })).includes('swapped'), 'the refused click did not fire the handler');

  // 5. Click → assert via rendered text, not pixels.
  await tool('bex_click', { tabId, ref: refFor(snap, 'Connect Wallet'), element: 'Connect Wallet button' });
  assert((await toolText('bex_read_page', { tabId })).includes('connected'), 'bex_click fired the Connect handler');

  // 6. Type → the fixture's input listener must fire and un-disable Swap. This
  //    is the real assertion on setValue()'s native-setter path: a plain
  //    `el.value = x` would leave Swap disabled here.
  const amountRef = refFor(snap, 'You pay');
  await tool('bex_type', { tabId, ref: amountRef, element: 'You pay amount field', text: '1.5' });
  const afterType = await toolText('bex_snapshot', { tabId });
  assert(!/\[disabled\]/.test(lineFor(afterType, 'Swap')), 'bex_type fired input events — Swap became enabled');
  assert(/value="1\.5"/.test(lineFor(afterType, 'You pay')), 'snapshot reflects the typed value');

  // 7. bex_find returns only hits, with usable refs.
  const found = await toolText('bex_find', { tabId, text: 'swap' });
  assert(refFor(found, 'Swap'), 'bex_find locates Swap and returns its ref');
  assert(!found.includes('Connect Wallet'), 'bex_find returns only matches, not the whole page');

  await tool('bex_click', { tabId, ref: refFor(afterType, 'Swap'), element: 'Swap button' });
  assert((await toolText('bex_read_page', { tabId })).includes('swapped 1.5'), 'the full type→click flow works');

  // 8. Stale refs must fail loudly rather than hit the wrong element.
  const stale = await rpc('tools/call', { name: 'bex_click', arguments: { tabId, ref: 'e9999', element: 'nonexistent' } });
  assert(stale.isError && /stale_ref/.test(stale.content[0].text), 'a stale ref returns a structured stale_ref error');

  // 9. Screenshot comes back as an MCP image block (proves the vault passes
  //    content through) and is downscaled enough to be affordable.
  const shot = (await tool('bex_screenshot', { tabId })).content[0];
  assert(shot.type === 'image' && shot.mimeType === 'image/jpeg', 'bex_screenshot returns an image content block');
  const kb = Math.round((shot.data.length * 0.75) / 1024);
  assert(kb > 0 && kb < 300, `screenshot is ${kb}KB (downscaled, not a raw retina capture)`);
} finally {
  if (tabId != null) await tool('bex_tabs', { action: 'close', tabId }).catch(() => {});
  server.close();
}

if (failures) {
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nBrowser-tools exit test PASSED');
