#!/usr/bin/env node
/**
 * Phase-1 exit test for the MCP agent bridge (EPIC_mcp_agent_bridge.md).
 *
 * Preconditions (human, one-time): vault running on :1646, extension loaded,
 * options-page "Agent mode" toggle ON.
 *
 *   node scripts/test-mcp-bridge.mjs
 *
 * Exits 0 when the vault serves MCP, tier-1 tools are listed, and bex_status
 * answers truthfully through the bridge (or truthfully reports bridge down).
 */

const MCP_URL = 'http://localhost:1646/mcp';
const TIER1_TOOLS = ['bex_status', 'bex_accounts', 'bex_pending_requests', 'bex_connected_sites', 'bex_logs'];

let nextId = 1;
async function rpc(method, params) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, ...(params ? { params } : {}) }),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`${method}: rpc error ${body.error.code} ${body.error.message}`);
  return body.result;
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`ok: ${msg}`);
}

const init = await rpc('initialize', {
  protocolVersion: '2025-03-26',
  capabilities: {},
  clientInfo: { name: 'exit-test', version: '0' },
});
assert(init.serverInfo?.name === 'keepkey-vault', 'initialize returns keepkey-vault serverInfo');

const { tools } = await rpc('tools/list');
const names = tools.map(t => t.name);
for (const t of TIER1_TOOLS) assert(names.includes(t), `tools/list includes ${t}`);

const call = await rpc('tools/call', { name: 'bex_status', arguments: {} });
const status = JSON.parse(call.content[0].text);
console.log('bex_status →', status);
assert(status.bridge === 'up' || status.bridge === 'down', 'bex_status reports bridge state truthfully');
if (status.bridge === 'down') {
  console.log('bridge is DOWN — enable Agent mode in the extension options page and re-run for the full pass');
  process.exit(2);
}
assert(typeof status.version === 'string' && status.version.length > 0, 'bex_status has extension version');
assert(typeof status.keepkeyState === 'number', 'bex_status has keepkeyState');

// bug #2 regression surface: raw per-chain request_accounts shapes are exposed
const acct = await rpc('tools/call', { name: 'bex_accounts', arguments: { chains: ['ethereum', 'thorchain'] } });
const accounts = JSON.parse(acct.content[0].text);
console.log('bex_accounts →', JSON.stringify(accounts.accounts, null, 2));
assert(Array.isArray(accounts.accounts) && accounts.accounts.length === 2, 'bex_accounts returns per-chain entries');

console.log('\nPhase 1 exit test PASSED');
