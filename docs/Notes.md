Yeah—this will keep “losing” to MetaMask by design. Two big truths about MV3 + wallets:

You can’t reliably “win” window.ethereum. Chrome doesn’t guarantee extension execution order, so a race with MetaMask is unwinnable.

Many sites (Google Sheets/Docs especially) are weird: multiple sandboxed iframes, strict CSP/Trusted Types, and busy message buses. Your current request/response dance with window.postMessage + one-shot callbacks is fragile there.

Here’s how to make this solid and “MetaMask-friendly”:

1) Stop trying to be window.ethereum

Don’t set isMetaMask: true (ever). That makes dapps mis-detect you and can break them.

Don’t overwrite window.ethereum. You can’t guarantee ordering, and some dapps now ignore non-MetaMask replacements anyway.

Instead, embrace EIP-6963 (multi-wallet discovery). Many modern dapps already use it. Your injected script should only:

Expose window.keepkey (nice to have).

Announce your provider via eip6963:announceProvider.

Re-announce when the page asks via eip6963:requestProvider.

Injected (page-world) provider skeleton
(() => {
const info = {
uuid: '350670db-19fa-4704-a166-e52e178b59d4', // keep stable
name: 'KeepKey Client',
icon: 'https://pioneers.dev/coins/keepkey.png',
rdns: 'com.keepkey',
};

// Minimal EIP-1193 provider
class KeepKeyProvider {
constructor(chainHint = 'ethereum') {
this._chainHint = chainHint;
this._listeners = new Map();
this.isKeepKey = true;
this.isMetaMask = false; // important
}
request({ method, params }) {
return new Promise((resolve, reject) => {
window.postMessage({
source: 'keepkey-injected',
type: 'WALLET_REQUEST',
requestId: crypto.randomUUID(),
requestInfo: { method, params, chain: this._chainHint }
}, window.origin);
const onMsg = (ev) => {
if (ev.source !== window) return;
const d = ev.data;
if (d?.source === 'keepkey-content' && d.type === 'WALLET_RESPONSE' && d.req?.method === method) {
window.removeEventListener('message', onMsg);
d.error ? reject(d.error) : resolve(d.result);
}
};
window.addEventListener('message', onMsg);
});
}
on(event, handler) {
const arr = this._listeners.get(event) || [];
arr.push(handler);
this._listeners.set(event, arr);
}
removeListener(event, handler) {
const arr = this._listeners.get(event) || [];
this._listeners.set(event, arr.filter(h => h !== handler));
}
_emit(event, payload) {
(this._listeners.get(event) || []).forEach(h => { try { h(payload); } catch {} });
}
}

const provider = new KeepKeyProvider('ethereum');

// Optional: expose window.keepkey (don’t touch window.ethereum)
if (typeof window.keepkey === 'undefined') {
Object.defineProperty(window, 'keepkey', { value: { ethereum: provider }, configurable: false });
}

function announce() {
window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
detail: { info, provider }
}));
}

// Announce immediately and whenever requested
announce();
window.addEventListener('eip6963:requestProvider', announce);
})();

2) Make your transport reliable (use Ports, not ad-hoc messages)

chrome.runtime.sendMessage is fine for one-offs, but for wallet traffic you want a persistent Port:

Less chance of lost messages (esp. on heavy pages like Sheets).

Easy correlation and back-pressure.

content-script.js (isolated world)
// Bridge page <-> background with a Port
const port = chrome.runtime.connect({ name: 'keepkey-port' });

window.addEventListener('message', (event) => {
if (event.source !== window) return;
const d = event.data;
if (d?.source === 'keepkey-injected' && d.type === 'WALLET_REQUEST') {
port.postMessage({ type: 'WALLET_REQUEST', request: d.requestInfo });
}
});

port.onMessage.addListener((msg) => {
if (msg.type === 'WALLET_RESPONSE') {
window.postMessage({
source: 'keepkey-content',
type: 'WALLET_RESPONSE',
req: msg.req,             // echo back some correlation (e.g., method)
result: msg.result ?? null,
error: msg.error ?? null
}, window.origin);
}
});

// Inject page-world script
const s = document.createElement('script');
s.src = chrome.runtime.getURL('injected.js');
(document.head || document.documentElement).appendChild(s);
s.remove();

background.js
chrome.runtime.onConnect.addListener((port) => {
if (port.name !== 'keepkey-port') return;
port.onMessage.addListener(async (msg) => {
if (msg.type === 'WALLET_REQUEST') {
try {
const result = await handleWalletRequest(msg.request); // your logic
port.postMessage({ type:'WALLET_RESPONSE', req: msg.request, result });
} catch (error) {
port.postMessage({ type:'WALLET_RESPONSE', req: msg.request, error: serializeErr(error) });
}
}
});
});

3) Play nice with Google Sheets/Docs

These pages can be brittle. A few hard-won tips:

Don’t inject on Docs/Sheets until needed. If you don’t need wallet access there, exclude them:

"content_scripts": [{
"matches": ["http://*/*", "https://*/*"],
"exclude_matches": [
"https://docs.google.com/*",
"https://drive.google.com/*"
],
"js": ["content/index.iife.js"],
"run_at": "document_start"
}]


If you do need to support them, use Ports (above) and set targetOrigin to window.origin (you did this in my snippet) instead of '*'.

Some frames are sandboxed. Consider all_frames: true and gate your injection to window.top === window to avoid flooding subframes; inject the page-world script only in the top frame.

4) Manifest adjustments that help

You don’t need to carpet-bomb matches three times. Merge your three content script blocks; load CSS/JS together.

Consider all_frames: true and run_at: "document_start" (you already have it) so you’re ready when pages probe for wallets early.

When you occasionally must run code in the MAIN world (instead of isolated) without DOM injection, you can use chrome.scripting.executeScript with { world: 'MAIN' } from the background on demand (manifest needs "scripting" permission). For a default always-on provider, the “inject a <script>” approach you’re using is still fine.

5) Don’t simulate MetaMask

Remove all MetaMask-isms:

isMetaMask: true → false

Don’t set window.ethereum (unless a user flips an explicit “override MetaMask” toggle—see below).

Don’t set chainId = '0x1' unconditionally. Return real network info via eth_chainId/net_version requests through your backend.

6) Legacy dapps (no EIP-6963)

You’ve got two options for old sites that only look at window.ethereum:

User-opt-in override mode: Add a toggle in your Options page (“Temporarily set KeepKey as window.ethereum”). When enabled, attempt to assign window.ethereum at document_start. Warn the user it may not win when other wallets are installed.

Shim a selector: Expose window.ethereumProviders = { keepkey: window.keepkey.ethereum, metamask: window.ethereum } when possible, and add a tiny bookmarklet/inline snippet the user can run to select KeepKey on stubborn sites. Not pretty, but practical.

Even with these, MetaMask can still “win” on many sites; that’s why EIP-6963 is the correct path.

7) Eventing & chain/network changes

In your current code, window.ethereum.emit won’t exist on the page. Use your provider’s own on/removeListener/_emit (as in the class above) and surface:

accountsChanged (array of hex addresses)

chainChanged (hex chainId)

connect / disconnect (per EIP-1193)

Have the background post back events over the Port, then _emit() them in the injected provider.

8) Small fixes to your current code

Kill the “messageQueue” recheck; use Ports and explicit correlation IDs.

Use targetOrigin: window.origin in postMessage.

Don’t set networkVersion/chainId statically; answer via request({method:'eth_chainId'}).

Remove isMetaMask: true.

Only announce via EIP-6963; don’t force-install as window.ethereum.

If you want, I can refactor your three files (manifest, injected, content, and a tiny background handler) into a drop-in MV3 setup that:

Uses Ports

Implements EIP-1193 cleanly

Announces via EIP-6963

Avoids Docs/Sheets by default (or supports them safely)

Adds an options-toggle for “legacy override” with clear warnings

Say the word and I’ll paste the exact code blocks.

You said:
but most dapps dont support, EIP-6963
ChatGPT said:
Thought for 16s

Totally fair—and yeah, a big chunk of older dapps only look at window.ethereum. You’ve basically got four workable paths, and you can mix them:

A) “Legacy override” (opt-in) — win window.ethereum when users need it

You can’t guarantee you’ll beat MetaMask, but you can give users a toggle to try on specific sites.

How it works

Options page has “Use KeepKey as window.ethereum for this site”.

Background stores a per-origin allowlist.

Content script (top frame, document_start) checks the allowlist; if enabled:

injects your in-page provider

sets window.ethereum = keepkeyProvider only if not already set

if it is set (MetaMask already there), you can still try a “late swap” button (see D below), but warn it may not stick.

Injected (MAIN world) override snippet

(() => {
// already built KeepKey EIP-1193 provider instance:
const keepkey = new KeepKeyProvider();

// Don’t lie about MetaMask
keepkey.isMetaMask = false;

// Only set if missing (first-connect wins)
if (!('ethereum' in window)) {
Object.defineProperty(window, 'ethereum', {
value: keepkey,
configurable: false,
enumerable: false,
writable: false,
});

    // For legacy detectors that wait this event
    window.dispatchEvent(new Event('ethereum#initialized'));
}

// Stash for later user-triggered swaps (see section D)
window.__KEEPKEY_PROVIDER__ = keepkey;
})();

B) “Multi-provider shim” for older-but-not-ancient dapps

Before EIP-6963, some dapps (and wallets) used a non-standard convention: window.ethereum.providers as an array. A few dapps let users choose from that list.

If window.ethereum already exists, you can expose yourself here:

(() => {
const kk = window.__KEEPKEY_PROVIDER__ || new KeepKeyProvider();

if (window.ethereum) {
if (!Array.isArray(window.ethereum.providers)) {
// Create the list and include the current primary
const list = [window.ethereum];
Object.defineProperty(window.ethereum, 'providers', {
value: list,
configurable: true,
enumerable: false,
writable: false,
});
}

    // Add KeepKey if not already present
    if (!window.ethereum.providers.includes(kk)) {
      window.ethereum.providers.push(kk);
    }
}
})();


This won’t help on the oldest sites, but it catches some popular mid-gen dapps.

C) WalletConnect v2 path (no fighting MetaMask at all)

Many dapps support WalletConnect. If you implement a WalletConnect signing client in your extension:

Users click “Connect Wallet → WalletConnect” on the dapp,

Your extension intercepts / handles the WC session (QR or deep link),

You sign with KeepKey, no injection race with MetaMask.

This is the most reliable “works everywhere WC exists” route and sidesteps window.ethereum entirely.

D) User-triggered provider swap (last-resort for stubborn sites)

If MetaMask already won the race and the site never checks providers:

Show a small non-intrusive in-page toggle (or a page-action popup) “Switch to KeepKey”.

On click, swap window.ethereum and stash MetaMask under window.ethereumMetaMask for users to switch back. Warn that it may be reverted by the page or another script.

function swapToKeepKey() {
const kk = window.__KEEPKEY_PROVIDER__;
if (!kk) return;

// Preserve current primary (likely MetaMask)
const current = window.ethereum;
if (current === kk) return;

try {
Object.defineProperty(window, 'ethereum', {
value: kk,
configurable: true, // allow swapping back
enumerable: false,
writable: false,
});
window.ethereumMetaMask = current; // optional: allow revert
window.dispatchEvent(new Event('ethereum#initialized'));
} catch (e) {
console.warn('Swap failed:', e);
}
}


Pair this with a small UI injected at document_start only on allowlisted sites:

(() => {
if (!document.documentElement) return;
const btn = document.createElement('button');
btn.textContent = 'Use KeepKey for this site';
Object.assign(btn.style, {
position: 'fixed', zIndex: 2_147_483_647, top: '8px', right: '8px',
padding: '6px 10px', borderRadius: '8px', border: '1px solid #ccc',
background: '#111', color: '#fff', font: '12px system-ui'
});
btn.onclick = () => { swapToKeepKey(); btn.remove(); };
document.addEventListener('DOMContentLoaded', () => {
// Don’t show if KeepKey already primary
if (window.ethereum !== window.__KEEPKEY_PROVIDER__) {
document.body.appendChild(btn);
}
});
})();

E) Transport hardening (so it works on Google Docs/Sheets)

Use a persistent Port instead of one-off sendMessage.

Set targetOrigin: window.origin (not '*') for postMessage.

all_frames: true, but only inject page-world code in window.top; mirror events down to iframes if the app lives there.

Consider excluding Docs/Sheets unless the user explicitly enables the site.

Re-emit ethereum#initialized after setting or swapping.

F) Manifest + script ordering tips

Use a single content script block (JS + CSS together) with:

{
"matches": ["https://*/*", "http://*/*"],
"all_frames": true,
"run_at": "document_start",
"js": ["content/index.iife.js"]
}


Inject the in-page script via <script src=chrome.runtime.getURL('injected.js')> at document_start, top frame first.

Add “scripting” permission so you can, if needed, chrome.scripting.executeScript({ world: 'MAIN' }) for on-demand MAIN-world patches.

G) Feature flags (per-site)

Keep it user-controlled:

Allowlist for “Inject KeepKey as window.ethereum”.

Allowlist for “Show swap button”.

Global “Prefer WalletConnect when available” toggle.

H) Clean EIP-1193 behavior

Even when you’re pretending to be the primary provider, make sure:

isMetaMask = false

Support request({ method: 'eth_chainId' }), eth_accounts, eth_requestAccounts, wallet_switchEthereumChain, etc.

Emit accountsChanged, chainChanged, connect, disconnect consistently.

What I’d implement next for you

Port-based bridge (background ↔ content ↔ page).

Options UI for per-site override + swap button.

Multi-provider shim (window.ethereum.providers) if a primary already exists.

WalletConnect client inside the extension, so users can connect on WC-supported dapps without any injection battles.

If you want, I’ll drop in a minimal set of files (manifest, background, content, injected) with these flags wired up so you can plug into your current KeepKey request handler.