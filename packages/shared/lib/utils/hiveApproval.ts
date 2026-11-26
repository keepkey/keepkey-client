/**
 * Hive approval view model (side panel). Every Hive request — Keychain
 * requestPost / requestVote / requestCustomJson / requestBroadcast /
 * requestSignBuffer / requestTransfer / requestDelegation / requestPowerUp /
 * requestPowerDown / requestSavingsOperation / requestConversion /
 * requestSendToken — becomes a readable title, the key it signs with, rows per
 * operation and the checks the KeepKey will enforce, so nothing lands on an
 * "Unknown Method" card and a request the device would refuse is flagged
 * BEFORE Approve instead of failing on the device.
 *
 * Device rules mirrored here (firmware v7.17.0-alpha-378cf30 strings, vault
 * txbuilder/hive-ops.ts): HiveSignOperations clear-signs comment (op 1) and
 * comment_options (op 19) — "Create post by @%s?", "Reply by @%s to @%s?",
 * "Payout Options" — with 1–4 ops per tx, no posting/active mix,
 * comment_options right after its comment, 1–8 sorted unique beneficiaries
 * summing to ≤ 100 %, serialized tx ≤ 2048 bytes; messages ≤ 1024 bytes of
 * printable text.
 */

export type HiveKeyRole = 'posting' | 'active' | 'memo';
export type HiveCheckStatus = 'ok' | 'warn' | 'block';
/** `deviceOnly`: a KeepKey limit (size, op count, op table…), not a chain rule — the browser posting key is not bound by it. */
export type HiveCheck = { status: HiveCheckStatus; title: string; detail?: string; deviceOnly?: boolean };
export type HiveRow = { label: string; value: string; mono?: boolean; long?: boolean };
export type HiveOpView = { op: string; opNumber?: number; title: string; rows: HiveRow[]; details: HiveRow[] };
export type HiveApprovalView = {
  /** Keychain-level action, e.g. "Reply to @peak.snaps/…" or "Sign a message". */
  title: string;
  description: string;
  account?: string;
  keyRole: HiveKeyRole;
  ops: HiveOpView[];
  /** Message signing only. */
  message?: { text: string; printable: boolean; purpose?: string };
  checks: HiveCheck[];
  /** What the KeepKey screen asks, so the user can compare. */
  deviceHint?: string;
  /** False only for a request type this formatter does not know. */
  known: boolean;
  /** Posting-only batch the KeepKey Client's browser posting key can sign. */
  clientSignable: boolean;
  method: string;
};

/** Operations the device clear-sign table accepts (mirrors background hiveOps.SUPPORTED_OPS). */
export const HIVE_CLEAR_SIGN_OPS = new Set([
  'vote',
  'comment',
  'custom_json',
  'transfer_to_vesting',
  'withdraw_vesting',
  'convert',
  'comment_options',
  'transfer_to_savings',
  'transfer_from_savings',
  'claim_reward_balance',
  'delegate_vesting_shares',
  'account_update2',
  'limit_order_create',
  'limit_order_cancel',
]);

const OP_NUMBER: Record<string, number> = {
  vote: 0,
  comment: 1,
  transfer: 2,
  transfer_to_vesting: 3,
  withdraw_vesting: 4,
  limit_order_create: 5,
  limit_order_cancel: 6,
  convert: 8,
  delete_comment: 17,
  custom_json: 18,
  comment_options: 19,
  transfer_to_savings: 32,
  transfer_from_savings: 33,
  claim_reward_balance: 39,
  delegate_vesting_shares: 40,
  account_update2: 43,
};

/** Ops the browser posting key may sign (mirrors background hiveTx.CLIENT_POSTING_OPS). */
export const HIVE_CLIENT_POSTING_OPS = new Set([
  'vote',
  'comment',
  'comment_options',
  'custom_json',
  'delete_comment',
  'claim_reward_balance',
]);

export const HIVE_MAX_TX_BYTES = 2048;
export const HIVE_MAX_MESSAGE_BYTES = 1024;
const HIVE_CHAIN_ID = 'beeab0de00000000000000000000000000000000000000000000000000000000';
const DEFAULT_MAX_PAYOUT = '1000000.000 HBD';
const DEFAULT_PERCENT_HBD = 10000;

const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;
const pct = (basisPoints: unknown, digits = 1) =>
  `${(Number(basisPoints) / 100).toFixed(digits).replace(/\.0+$/, '')}%`;
const jsonText = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v ?? {}));
const parseJson = (v: unknown): any => {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return undefined;
  }
};
const isZeroVests = (v: unknown) => String(v ?? '').startsWith('0.000000');
const authorPermlink = (author: unknown, permlink: unknown) => `@${author}/${permlink}`;

/** Which key an op needs on Hive. */
export function hiveOpKeyRole(name: string, p: Record<string, any>): HiveKeyRole {
  switch (name) {
    case 'vote':
    case 'comment':
    case 'comment_options':
    case 'claim_reward_balance':
    case 'delete_comment':
      return 'posting';
    case 'custom_json':
      return Array.isArray(p?.required_auths) && p.required_auths.length > 0 ? 'active' : 'posting';
    case 'account_update2':
      return p?.json_metadata ? 'active' : 'posting';
    default:
      return 'active';
  }
}

/** custom_json → a readable action for the ids dApps actually use. */
function describeCustomJson(id: string, json: any): { title: string; rows: HiveRow[] } {
  const rows: HiveRow[] = [];
  if (id === 'follow' && Array.isArray(json)) {
    const [kind, body] = json;
    if (kind === 'follow' && body) {
      const what: string[] = Array.isArray(body.what) ? body.what : [];
      const verb = what.includes('ignore') ? 'Mute' : what.length === 0 ? 'Unfollow' : 'Follow';
      return { title: `${verb} @${body.following}`, rows: [{ label: 'Account', value: `@${body.follower}` }] };
    }
    if (kind === 'reblog' && body) {
      return {
        title: `${body.delete ? 'Undo reblog of' : 'Reblog'} ${authorPermlink(body.author, body.permlink)}`,
        rows: [{ label: 'Account', value: `@${body.account}` }],
      };
    }
  }
  if (id === 'community' && Array.isArray(json)) {
    const [action, body] = json;
    const target = body?.community ? ` ${body.community}` : '';
    const labels: Record<string, string> = {
      subscribe: 'Join community',
      unsubscribe: 'Leave community',
      flagPost: 'Flag post in community',
      setRole: 'Set community role',
      setUserTitle: 'Set community title',
      mutePost: 'Mute post in community',
      unmutePost: 'Unmute post in community',
      pinPost: 'Pin post in community',
      unpinPost: 'Unpin post in community',
      updateProps: 'Update community settings',
    };
    return { title: `${labels[action] ?? `Community: ${action}`}${target}`, rows };
  }
  if (id === 'notify' && Array.isArray(json) && json[0] === 'setLastRead') {
    return { title: 'Mark notifications as read', rows };
  }
  if (id === 'ssc-mainnet-hive' && json && typeof json === 'object' && !Array.isArray(json)) {
    const { contractName, contractAction, contractPayload: pl = {} } = json;
    if (contractName === 'tokens' && contractAction === 'transfer') {
      return {
        title: `Send ${pl.quantity} ${pl.symbol} to @${pl.to}`,
        rows: [
          { label: 'Network', value: 'Hive Engine' },
          ...(pl.memo ? [{ label: 'Memo', value: String(pl.memo) }] : []),
        ],
      };
    }
    if (contractName === 'tokens' && (contractAction === 'stake' || contractAction === 'unstake')) {
      return { title: `Hive Engine: ${contractAction} ${pl.quantity} ${pl.symbol}`, rows };
    }
    return { title: `Hive Engine: ${contractName}.${contractAction}`, rows };
  }
  if (id.startsWith('sm_')) {
    return { title: `Splinterlands: ${id.slice(3).replace(/_/g, ' ')}`, rows };
  }
  return { title: `Custom JSON: ${id}`, rows };
}

/** One operation → title + rows (+ details for the collapsed section). */
export function formatHiveOp(name: string, p: Record<string, any> = {}): HiveOpView {
  const base = { op: name, opNumber: OP_NUMBER[name] };
  switch (name) {
    case 'comment': {
      const reply = !!p.parent_author;
      const meta = parseJson(p.json_metadata);
      const tags: string[] = Array.isArray(meta?.tags) ? meta.tags.map(String) : [];
      const rows: HiveRow[] = [];
      if (p.title) rows.push({ label: 'Title', value: String(p.title) });
      rows.push({ label: 'Body', value: String(p.body ?? ''), long: true });
      if (!reply && p.parent_permlink) rows.push({ label: 'Category', value: String(p.parent_permlink) });
      const details: HiveRow[] = [{ label: 'Permlink', value: String(p.permlink), mono: true }];
      if (tags.length) details.push({ label: 'Tags', value: tags.map(t => `#${t}`).join(' ') });
      if (meta?.app) details.push({ label: 'App', value: String(meta.app) });
      details.push({ label: 'Metadata', value: jsonText(p.json_metadata), mono: true, long: true });
      return {
        ...base,
        title: reply ? `Reply to ${authorPermlink(p.parent_author, p.parent_permlink)}` : 'Publish a post',
        rows,
        details,
      };
    }
    case 'comment_options': {
      const rows: HiveRow[] = [];
      const max = String(p.max_accepted_payout ?? DEFAULT_MAX_PAYOUT);
      rows.push({
        label: 'Max payout',
        value: /^0\.000 /.test(max)
          ? `${max} (declines payout)`
          : max === DEFAULT_MAX_PAYOUT
            ? `${max} (default)`
            : max,
      });
      const percentHbd = Number(p.percent_hbd ?? p.percent_steem_dollars ?? DEFAULT_PERCENT_HBD);
      rows.push({
        label: 'HBD split',
        value: `${pct(percentHbd)}${percentHbd === DEFAULT_PERCENT_HBD ? ' (default)' : ''}`,
      });
      rows.push({ label: 'Votes', value: p.allow_votes === false ? 'Not allowed' : 'Allowed' });
      rows.push({ label: 'Curation', value: p.allow_curation_rewards === false ? 'Not allowed' : 'Allowed' });
      const bens: any[] = p.extensions?.[0]?.[1]?.beneficiaries ?? [];
      bens.forEach((b, i) =>
        rows.push({ label: `Beneficiary ${i + 1}/${bens.length}`, value: `@${b.account} gets ${pct(b.weight)}` }),
      );
      return { ...base, title: `Payout options for ${authorPermlink(p.author, p.permlink)}`, rows, details: [] };
    }
    case 'vote': {
      const w = Number(p.weight);
      const title =
        w === 0
          ? `Remove vote on ${authorPermlink(p.author, p.permlink)}`
          : `${w < 0 ? 'Downvote' : 'Vote on'} ${authorPermlink(p.author, p.permlink)}`;
      return {
        ...base,
        title,
        rows: [
          { label: 'Voter', value: `@${p.voter}` },
          { label: 'Weight', value: pct(Math.abs(w)) },
        ],
        details: [],
      };
    }
    case 'custom_json': {
      const id = String(p.id ?? '');
      const json = parseJson(p.json);
      const described = describeCustomJson(id, json);
      const active = Array.isArray(p.required_auths) && p.required_auths.length > 0;
      const signers = (active ? p.required_auths : p.required_posting_auths) ?? [];
      const rows: HiveRow[] = [
        ...described.rows,
        { label: 'ID', value: id, mono: true },
        {
          label: 'Authority',
          value: `${active ? 'Active' : 'Posting'} (${signers.map((a: string) => `@${a}`).join(', ')})`,
        },
      ];
      const pretty = json !== undefined ? JSON.stringify(json, null, 2) : jsonText(p.json);
      return {
        ...base,
        title: described.title,
        rows,
        details: [{ label: 'JSON', value: pretty, mono: true, long: true }],
      };
    }
    case 'delete_comment':
      return {
        ...base,
        title: `Delete ${authorPermlink(p.author, p.permlink)}`,
        rows: [{ label: 'Author', value: `@${p.author}` }],
        details: [],
      };
    case 'transfer_to_vesting':
      return {
        ...base,
        title: `Power up ${p.amount}`,
        rows: [
          { label: 'From', value: `@${p.from}` },
          { label: 'To', value: `@${p.to}` },
        ],
        details: [],
      };
    case 'withdraw_vesting':
      return {
        ...base,
        title: isZeroVests(p.vesting_shares) ? 'Stop power down' : `Power down ${p.vesting_shares}`,
        rows: [{ label: 'Account', value: `@${p.account}` }],
        details: [],
      };
    case 'delegate_vesting_shares':
      return {
        ...base,
        title: isZeroVests(p.vesting_shares) ? `Remove delegation to @${p.delegatee}` : `Delegate ${p.vesting_shares}`,
        rows: [
          { label: 'From', value: `@${p.delegator}` },
          { label: 'To', value: `@${p.delegatee}` },
        ],
        details: [],
      };
    case 'transfer_to_savings':
    case 'transfer_from_savings':
      return {
        ...base,
        title: `${name === 'transfer_to_savings' ? 'Savings deposit' : 'Savings withdraw'} ${p.amount}`,
        rows: [
          { label: 'From', value: `@${p.from}` },
          { label: 'To', value: `@${p.to}` },
          ...(p.memo ? [{ label: 'Memo', value: String(p.memo) }] : []),
        ],
        details: [],
      };
    case 'convert':
      return {
        ...base,
        title: `Convert ${p.amount} to HIVE`,
        rows: [
          { label: 'Account', value: `@${p.owner}` },
          { label: 'Request', value: `#${p.requestid}`, mono: true },
        ],
        details: [],
      };
    case 'claim_reward_balance':
      return {
        ...base,
        title: 'Claim rewards',
        rows: [
          { label: 'Account', value: `@${p.account}` },
          { label: 'Rewards', value: [p.reward_hive, p.reward_hbd, p.reward_vests].filter(Boolean).join(' · ') },
        ],
        details: [],
      };
    case 'account_update2':
      return {
        ...base,
        title: `Update profile of @${p.account}`,
        rows: [],
        details: [
          ...(p.json_metadata
            ? [{ label: 'Account metadata', value: jsonText(p.json_metadata), mono: true, long: true }]
            : []),
          ...(p.posting_json_metadata
            ? [{ label: 'Profile metadata', value: jsonText(p.posting_json_metadata), mono: true, long: true }]
            : []),
        ],
      };
    case 'limit_order_create':
      return {
        ...base,
        title: `Sell ${p.amount_to_sell} for at least ${p.min_to_receive}`,
        rows: [
          { label: 'Account', value: `@${p.owner}` },
          { label: 'Order', value: `#${p.orderid}${p.fill_or_kill ? ' · fill or kill' : ''}`, mono: true },
        ],
        details: [],
      };
    case 'limit_order_cancel':
      return {
        ...base,
        title: `Cancel order #${p.orderid}`,
        rows: [{ label: 'Account', value: `@${p.owner}` }],
        details: [],
      };
    default: {
      // Not in the device table: show every top-level field, never just a name.
      const rows = Object.entries(p)
        .filter(([, v]) => v === null || ['string', 'number', 'boolean'].includes(typeof v))
        .map(([k, v]) => ({ label: k, value: String(v) }));
      return {
        ...base,
        title: `Operation: ${name}`,
        rows,
        details: [{ label: 'Params', value: JSON.stringify(p, null, 2), mono: true, long: true }],
      };
    }
  }
}

/** Rough serialized size: strings dominate (varint length + bytes); numbers/assets ≤ 16 bytes. */
export function estimateHiveTxBytes(ops: [string, Record<string, any>][]): number {
  let n = 16; // ref block, prefix, expiration, op count, extensions
  const walk = (v: unknown) => {
    if (typeof v === 'string') n += utf8Bytes(v) + 2;
    else if (typeof v === 'number' || typeof v === 'boolean') n += 4;
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  for (const [, p] of ops) {
    n += 1;
    walk(p);
  }
  return n;
}

/** What the KeepKey will refuse, decided before Approve. */
export function hiveOpsChecks(ops: [string, Record<string, any>][]): HiveCheck[] {
  const checks: HiveCheck[] = [];
  if (ops.length < 1 || ops.length > 4) {
    checks.push({
      status: 'block',
      title: `KeepKey signs 1–4 operations at a time (this has ${ops.length})`,
      deviceOnly: true,
    });
  }
  const unsupported = ops.map(([name]) => name).filter(n => !HIVE_CLEAR_SIGN_OPS.has(n));
  if (unsupported.length) {
    checks.push({
      status: 'block',
      title: `KeepKey can't sign ${[...new Set(unsupported)].join(', ')}`,
      deviceOnly: true,
    });
  }
  const roles = new Set(ops.map(([name, p]) => hiveOpKeyRole(name, p)));
  if (roles.has('posting') && roles.has('active')) {
    checks.push({
      status: 'block',
      title: 'Mixes posting-key and active-key operations',
      detail: 'KeepKey signs them in separate transactions.',
      deviceOnly: true,
    });
  }
  ops.forEach(([name, p], i) => {
    if (name !== 'comment_options') return;
    const prev = ops[i - 1];
    if (!prev || prev[0] !== 'comment' || prev[1]?.author !== p.author || prev[1]?.permlink !== p.permlink) {
      checks.push({
        status: 'block',
        title: 'Payout options must follow their post',
        detail: 'comment_options has to come right after the comment with the same author and permlink.',
      });
    }
    const bens: any[] = p.extensions?.[0]?.[1]?.beneficiaries;
    if (bens) {
      const names = bens.map(b => String(b?.account));
      const sorted = names.every((a, k) => k === 0 || a > names[k - 1]);
      const sum = bens.reduce((s, b) => s + Number(b?.weight ?? 0), 0);
      if (bens.length < 1 || bens.length > 8)
        checks.push({ status: 'block', title: `Beneficiaries: 1–8 allowed (got ${bens.length})` });
      if (!sorted) checks.push({ status: 'block', title: 'Beneficiaries must be sorted by name, without repeats' });
      if (sum > 10000) checks.push({ status: 'block', title: `Beneficiaries add up to ${pct(sum)} (max 100%)` });
    }
  });
  const bytes = estimateHiveTxBytes(ops);
  let stringBytes = 0;
  const strings = (v: unknown) => {
    if (typeof v === 'string') stringBytes += utf8Bytes(v);
    else if (Array.isArray(v)) v.forEach(strings);
    else if (v && typeof v === 'object') Object.values(v).forEach(strings);
  };
  ops.forEach(([, p]) => strings(p));
  if (stringBytes > HIVE_MAX_TX_BYTES) {
    checks.push({
      status: 'block',
      title: `Too long for KeepKey: about ${bytes} bytes (limit ${HIVE_MAX_TX_BYTES})`,
      detail: 'Shorten the text, or sign with the browser posting key.',
      deviceOnly: true,
    });
  } else if (bytes > HIVE_MAX_TX_BYTES - 150) {
    checks.push({
      status: 'warn',
      title: `Close to KeepKey's size limit: about ${bytes} of ${HIVE_MAX_TX_BYTES} bytes`,
      detail: 'If signing fails, shorten the text.',
      deviceOnly: true,
    });
  }
  if (checks.length === 0) {
    checks.push({
      status: 'ok',
      title: 'KeepKey can clear-sign this',
      detail: 'Check the same details on the device screen.',
    });
  }
  return checks;
}

function messageChecks(text: string | undefined, printable: boolean): HiveCheck[] {
  if (text === undefined || !printable) {
    return [
      { status: 'block', title: 'KeepKey signs readable text only', detail: 'This request asks to sign raw bytes.' },
    ];
  }
  const checks: HiveCheck[] = [];
  if (utf8Bytes(text) > HIVE_MAX_MESSAGE_BYTES) {
    checks.push({
      status: 'block',
      title: `Message too long for KeepKey (${utf8Bytes(text)} of ${HIVE_MAX_MESSAGE_BYTES} bytes)`,
    });
  }
  if (text.toLowerCase().startsWith(HIVE_CHAIN_ID)) {
    checks.push({
      status: 'block',
      title: 'Looks like a transaction, not a message',
      detail: 'It starts with the Hive chain ID.',
    });
  }
  if (!checks.length) checks.push({ status: 'ok', title: 'KeepKey shows this message before signing' });
  return checks;
}

/** Printable text: no C0 controls except tab/LF/CR, no DEL, no U+FFFD replacement char. */
const isPrintableText = (s: string) => {
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0x7f || c === 0xfffd) return false;
  }
  return true;
};

/** Login challenges: a "login"/"sign in" title or message, or a bare token. */
function messagePurpose(text: string, title: string, site?: string): string | undefined {
  const where = site ? ` to ${site}` : '';
  if (/log\s?-?in|sign\s?-?in|auth/i.test(`${title} ${text}`) || /^[\w#:.\-]{6,128}$/.test(text.trim())) {
    return `Log in${where}. No funds move.`;
  }
  return undefined;
}

const KNOWN_TYPES: Record<string, { title: string; description: string }> = {
  vote: { title: 'Vote', description: 'Votes with your posting key.' },
  post: { title: 'Publish', description: 'Publishes with your posting key.' },
  custom_json: { title: 'Custom JSON', description: 'Broadcasts app data.' },
  broadcast: { title: 'Broadcast operations', description: 'Signs and broadcasts these operations.' },
  sendToken: { title: 'Send Hive Engine tokens', description: 'Signs with your active key.' },
  powerUp: { title: 'Power up', description: 'Stakes HIVE as Hive Power.' },
  powerDown: { title: 'Power down', description: 'Unstakes Hive Power over 13 weeks.' },
  delegation: { title: 'Delegate Hive Power', description: 'Lends Hive Power to another account.' },
  savings: { title: 'Savings', description: 'Moves funds in or out of savings.' },
  conversion: { title: 'Convert HBD', description: 'Converts HBD to HIVE over 3.5 days.' },
};

/** Event (as stored by hiveHandler) → view. */
export function buildHiveApprovalView(event: { type?: string; unsignedTx?: any; siteUrl?: string }): HiveApprovalView {
  const method = String(event?.type ?? 'unknown');
  const tx = event?.unsignedTx ?? {};
  const account = tx.from ? String(tx.from) : undefined;
  let site: string | undefined;
  try {
    site = event?.siteUrl ? new URL(event.siteUrl).hostname : undefined;
  } catch {
    site = undefined;
  }

  if (method === 'signBuffer') {
    const text: string | undefined = typeof tx.messageUtf8 === 'string' ? tx.messageUtf8 : undefined;
    const printable = text !== undefined && isPrintableText(text);
    const role = (['posting', 'active', 'memo'].includes(tx.role) ? tx.role : 'posting') as HiveKeyRole;
    const purpose = text !== undefined ? messagePurpose(text, String(tx.title ?? ''), site) : undefined;
    return {
      title: purpose ? `Log in${site ? ` to ${site}` : ''}` : 'Sign a message',
      description: purpose ?? 'Signs a message. No funds move.',
      account,
      keyRole: role,
      ops: [],
      message: { text: text ?? String(tx.message ?? ''), printable, purpose },
      checks: messageChecks(text, printable),
      deviceHint: 'Sign Hive Message',
      known: true,
      clientSignable: false,
      method,
    };
  }

  if (method === 'requestAccount') {
    return {
      title: `Connect ${site ?? 'this site'} to your Hive account`,
      description: 'Shares your account name only. No signing, no funds move. You can revoke it on the Hive screen.',
      account,
      keyRole: 'posting',
      ops: [
        {
          op: 'requestAccount',
          title: 'Share account name',
          rows: [
            { label: 'Account', value: account ? `@${account}` : '—' },
            ...(site ? [{ label: 'Site', value: site }] : []),
          ],
          details: [],
        },
      ],
      checks: [{ status: 'ok', title: 'Nothing is signed' }],
      known: true,
      clientSignable: false,
      method,
    };
  }

  if (method === 'transfer' && tx.payment) {
    const pay = tx.payment;
    const decimals = Number(pay.decimals ?? 3);
    const raw = String(pay.amount ?? '0');
    const amount = /^\d+$/.test(raw)
      ? `${raw.length > decimals ? raw.slice(0, -decimals) : '0'}.${raw.padStart(decimals, '0').slice(-decimals)}`
      : raw;
    const rows: HiveRow[] = [
      { label: 'To', value: `@${pay.destination}` },
      { label: 'Amount', value: `${amount} ${pay.symbol ?? 'HIVE'}` },
    ];
    if (tx.memo) rows.push({ label: 'Memo', value: String(tx.memo), long: true });
    return {
      title: `Send ${amount} ${pay.symbol ?? 'HIVE'} to @${pay.destination}`,
      description: 'Transfers funds with your active key.',
      account,
      keyRole: 'active',
      ops: [{ op: 'transfer', opNumber: 2, title: 'Transfer', rows, details: [] }],
      checks: [
        {
          status: 'ok',
          title: 'KeepKey can clear-sign this',
          detail: 'Check recipient and amount on the device screen.',
        },
      ],
      deviceHint: 'Send Hive',
      known: true,
      clientSignable: false,
      method,
    };
  }

  const rawOps: [string, Record<string, any>][] = Array.isArray(tx.operations)
    ? tx.operations.map((o: any) => [String(o?.op ?? 'unknown'), (o?.params ?? {}) as Record<string, any>])
    : [];

  if (rawOps.length) {
    const ops = rawOps.map(([name, p]) => formatHiveOp(name, p));
    const roles = new Set(rawOps.map(([name, p]) => hiveOpKeyRole(name, p)));
    const keyRole: HiveKeyRole = roles.has('active') ? 'active' : 'posting';
    const known = KNOWN_TYPES[method];
    const main = ops[0];
    // A single action reads best as its own title ("Reply to @x/y");
    // comment + comment_options is still one action.
    const single =
      ops.length === 1 || (ops.length === 2 && rawOps[0][0] === 'comment' && rawOps[1][0] === 'comment_options');
    const comment = rawOps.find(([n]) => n === 'comment')?.[1];
    const deviceHint = comment
      ? comment.parent_author
        ? `Reply by @${comment.author} to @${comment.parent_author}?`
        : `Create post by @${comment.author}?`
      : `Sign ${rawOps.length} Hive operation${rawOps.length === 1 ? '' : 's'} with the ${keyRole === 'active' ? 'Active' : 'Posting'} key?`;
    return {
      title: single ? main.title : (known?.title ?? `${ops.length} Hive operations`),
      description: `Signs with your ${keyRole} key.${keyRole === 'active' ? ' Can move funds.' : ' No funds move.'}`,
      account,
      keyRole,
      ops,
      checks: hiveOpsChecks(rawOps),
      deviceHint,
      known: true,
      clientSignable: keyRole === 'posting' && rawOps.every(([name]) => HIVE_CLIENT_POSTING_OPS.has(name)),
      method,
    };
  }

  // A request type this formatter does not know: name it, keep Raw complete.
  return {
    title: `Hive request: ${method}`,
    description: 'KeepKey does not recognize this request. Check the Raw tab before approving.',
    account,
    keyRole: 'active',
    ops: [],
    checks: [{ status: 'warn', title: `Unrecognized request "${method}"`, detail: 'Review the raw data.' }],
    known: false,
    clientSignable: false,
    method,
  };
}
