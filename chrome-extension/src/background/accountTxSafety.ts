import type { TxBuildResponse } from './chains/buildViaDesktop';
import {
  ACCOUNT_NETWORKS,
  COSMOS_REST,
  XRP_NETWORK,
  XRP_RPC,
  readChainJson,
  unsignedInteger,
  xrpRead,
} from './accountChainReads';

function displayUnits(value: string, decimals: number): bigint {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) throw new Error('Invalid transaction amount');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new Error('Invalid transaction precision');
  return BigInt(whole + fraction.padEnd(decimals, '0'));
}

const cannotVerify = (symbol: string) =>
  new Error(
    `Cannot verify live ${symbol} spendable funds and fees. Nothing was signed. Try again when the network is available.`,
  );

/** Before approval: compare the exact signed amounts and fees with live funds.
 * Missing/malformed reads fail closed. A verified empty balance stays zero. */
export async function assertAffordableDesktopBuild(networkId: string, build: TxBuildResponse): Promise<void> {
  const chain = ACCOUNT_NETWORKS[networkId];
  const xrp = networkId === XRP_NETWORK;
  if (!chain && !xrp) {
    if (networkId.startsWith('cosmos:') || networkId.startsWith('ripple:')) throw cannotVerify(build.summary.symbol);
    return;
  }
  const { signBody: body, summary } = build;
  const tx = xrp ? body.tx?.value : body.signDoc;
  const messages = xrp ? tx?.msg : tx?.msgs;
  const msg = messages?.[0]?.value;
  const decimals = xrp ? 6 : chain.decimals;
  const denom = xrp ? 'drop' : chain.denom;
  const badBuild = () => new Error('KeepKey Desktop returned an inconsistent transaction. Nothing was signed.');
  if (
    build.signRoute !== (xrp ? '/xrp/sign-transaction' : chain.route) ||
    !Array.isArray(messages) ||
    messages.length !== 1 ||
    typeof msg?.from_address !== 'string' ||
    !msg.from_address ||
    msg.to_address !== summary.to ||
    !Array.isArray(msg.amount) ||
    msg.amount.length !== 1 ||
    msg.amount[0].denom !== denom ||
    (!xrp && (body.signerAddress !== msg.from_address || tx.chain_id !== networkId.slice(7)))
  )
    throw badBuild();
  const amount = unsignedInteger(msg.amount[0].amount);
  if (amount <= 0n || amount !== displayUnits(summary.amount, decimals)) throw badBuild();
  if (xrp && (unsignedInteger(body.payment?.amount) !== amount || body.payment?.destination !== summary.to))
    throw badBuild();
  if (!Array.isArray(tx.fee?.amount)) throw badBuild();
  let fee = 0n;
  for (const coin of tx.fee.amount) {
    if (coin.denom !== denom) throw badBuild();
    fee += unsignedInteger(coin.amount);
  }
  const bankFee = !xrp && (chain.id === 'thorchain' || chain.id === 'mayachain');
  if (!bankFee && fee !== displayUnits(summary.fee, decimals)) throw badBuild();

  const endpoints = xrp ? XRP_RPC : COSMOS_REST[chain.id];
  for (const endpoint of endpoints) {
    let balance: bigint;
    let reserve = 0n;
    let actualFee = fee;
    try {
      if (xrp) {
        const state = await xrpRead(endpoint, 'server_state', {});
        const ledger = state?.result?.state?.validated_ledger;
        const base = unsignedInteger(ledger?.reserve_base);
        const increment = unsignedInteger(ledger?.reserve_inc);
        if (base <= 0n || increment <= 0n || unsignedInteger(ledger?.seq) <= 0n) continue;
        const info = await xrpRead(endpoint, 'account_info', {
          account: msg.from_address,
          ledger_index: Number(ledger.seq),
        });
        const result = info?.result;
        const account = result?.account_data;
        if (
          result?.validated !== true ||
          unsignedInteger(result.ledger_index) !== unsignedInteger(ledger.seq) ||
          account?.Account !== msg.from_address
        )
          continue;
        balance = unsignedInteger(account.Balance);
        reserve = base + unsignedInteger(account.OwnerCount) * increment;
      } else {
        const data = await readChainJson(
          `${endpoint}/cosmos/bank/v1beta1/spendable_balances/${encodeURIComponent(msg.from_address)}?pagination.limit=1000`,
        );
        if (!Array.isArray(data?.balances) || data.pagination?.next_key) continue;
        const balances = new Map<string, bigint>();
        for (const coin of data.balances) {
          if (typeof coin?.denom !== 'string' || balances.has(coin.denom)) throw new Error('Invalid balances');
          balances.set(coin.denom, unsignedInteger(coin.amount));
        }
        balance = balances.get(denom) ?? 0n;
        if (bankFee) {
          // These chains charge outside the amino fee. Pull current parameters,
          // rather than trusting Desktop's static RUNE/CACAO fee template.
          const params = await readChainJson(
            `${endpoint}/${chain.id}/${chain.id === 'thorchain' ? 'network' : 'mimir'}`,
          );
          const nativeFee = unsignedInteger(
            chain.id === 'thorchain' ? params.native_tx_fee_rune : params.NATIVETRANSACTIONFEE,
          );
          if (nativeFee <= 0n) continue;
          actualFee += nativeFee;
        }
      }
    } catch {
      continue;
    }
    if (amount + actualFee + reserve > balance) {
      throw new Error(
        `Insufficient ${summary.symbol} spendable funds for the amount and network fee${xrp ? ' after account reserves' : ''}. Nothing was signed.`,
      );
    }
    if (bankFee) {
      // The bank fee is not encoded in the signDoc; show the current cost in
      // approval without altering the transaction Desktop built.
      const scale = 10n ** BigInt(decimals);
      summary.fee = `${actualFee / scale}.${(actualFee % scale).toString().padStart(decimals, '0')}`;
    }
    return;
  }
  throw cannotVerify(summary.symbol);
}
