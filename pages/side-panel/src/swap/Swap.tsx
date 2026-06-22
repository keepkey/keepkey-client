// Swap — orchestrates the native side-panel swap flow against vault's headless
// swap REST (via the background SWAP_REQUEST bridge). Owns asset list, from/to,
// amount, debounced quote, execute, and submitted-status polling. The visual is
// a faithful port of the BEX design (SwapScreen + SwapProgress).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Spinner } from '@chakra-ui/react';
import { T, SWAP_KEYFRAMES, colorForSymbol } from './theme';
import type { SwapAsset, UiAsset, SwapQuote, SwapHistoryRecord, SwapTrackingStatus, ExecuteSwapParams } from './types';
import { fetchSwapAssets, fetchSwapQuote, executeSwap, fetchSwapStatus } from './swapApi';
import { SwapScreen } from './SwapScreen';
import { SwapReview } from './SwapReview';
import { SwapHistory } from './SwapHistory';
import { SwapProgress } from './SwapProgress';
import { AssetPicker } from './AssetPicker';
import { PrimaryBtn } from './ui';
import { Icon, I } from './icons';

const toUi = (a: SwapAsset): UiAsset => ({ ...a, color: colorForSymbol(a.symbol) });

// Default "to" asset when swapping from a given chain — BTC-like default to ETH,
// everything else to BTC. Ported verbatim from vault SwapDialog's DEFAULT_OUTPUT.
const DEFAULT_OUTPUT: Record<string, string> = {
  bitcoin: 'ETH.ETH',
  ethereum: 'BTC.BTC',
  litecoin: 'BTC.BTC',
  dogecoin: 'BTC.BTC',
  bitcoincash: 'BTC.BTC',
  dash: 'BTC.BTC',
  zcash: 'ETH.ETH',
  cosmos: 'ETH.ETH',
  thorchain: 'ETH.ETH',
  mayachain: 'ETH.ETH',
  avalanche: 'ETH.ETH',
  bsc: 'ETH.ETH',
  base: 'ETH.ETH',
  arbitrum: 'ETH.ETH',
  optimism: 'ETH.ETH',
  polygon: 'ETH.ETH',
  ripple: 'ETH.ETH',
  solana: 'ETH.ETH',
  tron: 'ETH.ETH',
  ton: 'ETH.ETH',
};

type Screen = 'loading' | 'load-error' | 'input' | 'review' | 'history' | 'submitting' | 'submitted';

export function Swap({ onClose, initialFromCaip }: { onClose: () => void; initialFromCaip?: string }) {
  const [screen, setScreen] = useState<Screen>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [assets, setAssets] = useState<UiAsset[]>([]);
  const [balances, setBalances] = useState<any[]>([]);
  const [balancesLoading, setBalancesLoading] = useState(true);

  const [from, setFrom] = useState<UiAsset | null>(null);
  const [to, setTo] = useState<UiAsset | null>(null);
  const [amount, setAmount] = useState('');
  const [pickerSide, setPickerSide] = useState<'from' | 'to' | null>(null);

  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const [execError, setExecError] = useState<string | null>(null);
  const [txid, setTxid] = useState('');
  const [submittedFrom, setSubmittedFrom] = useState<UiAsset | null>(null);
  const [submittedTo, setSubmittedTo] = useState<UiAsset | null>(null);
  const [submittedAmount, setSubmittedAmount] = useState('');
  const [status, setStatus] = useState<SwapHistoryRecord | null>(null);
  const [statusChecking, setStatusChecking] = useState(false);
  const [statusCheckedAt, setStatusCheckedAt] = useState<number | null>(null);
  const [sseLive, setSseLive] = useState(false);

  const quoteSeq = useRef(0);
  // Latest status in a ref so the poll interval can read it without re-subscribing
  // (depending on `status` would tear down + rebuild the interval every tick).
  const statusRef = useRef<SwapHistoryRecord | null>(status);
  statusRef.current = status;
  const [reloadTick, setReloadTick] = useState(0);

  // Load assets + balances on mount (and on Retry).
  useEffect(() => {
    let cancelled = false;
    setScreen('loading');
    setLoadError(null);
    (async () => {
      try {
        const list = await fetchSwapAssets();
        if (cancelled) return;
        setAssets(list.map(toUi));
        // Default from/to are chosen in a separate effect once balances land
        // (we can't swap from an asset the user doesn't own).
        setScreen('input');
      } catch (e: any) {
        if (!cancelled) {
          setLoadError(e?.message || 'Could not load swap assets');
          setScreen('load-error');
        }
      }
    })();
    // balances (best-effort, for from-balance + Max)
    setBalancesLoading(true);
    try {
      chrome.runtime.sendMessage({ type: 'GET_APP_BALANCES' }, (resp: any) => {
        if (cancelled) return;
        if (resp?.balances) setBalances(resp.balances);
        setBalancesLoading(false);
      });
    } catch {
      if (!cancelled) setBalancesLoading(false);
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadTick]);

  // Map the raw load error to friendlier copy for the error screen.
  const lowerErr = (loadError || '').toLowerCase();
  const isConnErr =
    lowerErr.includes('not connected') ||
    lowerErr.includes('pair') ||
    lowerErr.includes('connection failed') ||
    lowerErr.includes('timed out');
  const isNotWired = lowerErr.includes('not available') || lowerErr.includes('not wired');
  const loadErrorTitle = isConnErr
    ? 'Waiting for the vault'
    : isNotWired
      ? 'Swap not available yet'
      : "Couldn't load swap";
  const loadErrorHint = isConnErr
    ? "Make sure the KeepKey desktop app is running and your device is unlocked, then retry. (It's still starting up if you just opened it.)"
    : isNotWired
      ? 'This version of the KeepKey desktop app doesn’t expose swaps yet. Update it, then retry.'
      : loadError || 'Something went wrong loading swap assets.';

  // swap-asset caip → held amount + USD. Drives the FROM picker's "only what you
  // own" filter and per-row balance display. Keyed by the swap asset's caip so
  // AssetPicker can look it up directly.
  //
  // Native balances (esp. UTXO like BTC) often arrive from Pioneer with an EMPTY
  // caip — only `networkId` is set — so a pure caip match misses them. We index
  // balances by caip AND by networkId (for native rows), then resolve each swap
  // asset by caip first, falling back to its chain's native balance.
  const balanceByCaip = useMemo(() => {
    const byCaip = new Map<string, { amount: number; usd: number }>();
    const nativeByNet = new Map<string, { amount: number; usd: number }>();
    const accumulate = (m: Map<string, { amount: number; usd: number }>, key: string, amt: number, usd: number) => {
      const prev = m.get(key);
      m.set(key, {
        amount: (prev?.amount ?? 0) + (Number.isFinite(amt) ? amt : 0),
        usd: (prev?.usd ?? 0) + (Number.isFinite(usd) ? usd : 0),
      });
    };
    for (const b of balances) {
      const amt = parseFloat(b?.balance ?? b?.amount ?? '0');
      const usd = parseFloat(b?.valueUsd ?? b?.balanceUsd ?? '0');
      if (b?.caip) accumulate(byCaip, b.caip, amt, usd);
      // Native rows (isNative true, or a row with a networkId but no caip) key by chain.
      const net: string = b?.networkId || (b?.caip ? String(b.caip).split('/')[0] : '');
      if (net && (b?.isNative ?? !b?.caip)) accumulate(nativeByNet, net, amt, usd);
    }
    const out = new Map<string, { amount: number; usd: number }>();
    for (const a of assets) {
      if (!a.caip) continue;
      let bal = byCaip.get(a.caip);
      if (!bal) {
        const isNative = a.caip.includes('/slip44:') || a.caip.includes('/native:') || !a.contractAddress;
        if (isNative) bal = nativeByNet.get(a.caip.split('/')[0]);
      }
      if (bal && bal.amount > 0) out.set(a.caip, bal);
    }
    return out;
  }, [balances, assets]);

  // Pick the default from/to pair once assets + balances are ready. From = the
  // highest-value held asset; To = DEFAULT_OUTPUT for that chain (fallback BTC).
  // Guarded so it never overrides a user's pick.
  useEffect(() => {
    if (from || to || assets.length === 0 || balancesLoading) return;
    const held = assets
      .filter(a => a.caip && (balanceByCaip.get(a.caip)?.amount ?? 0) > 0)
      .sort((a, b) => (balanceByCaip.get(b.caip!)?.usd ?? 0) - (balanceByCaip.get(a.caip!)?.usd ?? 0));
    // When launched from an asset's page, preselect that asset as "from" if held;
    // otherwise fall back to the highest-value holding.
    const preset = initialFromCaip ? held.find(a => a.caip === initialFromCaip) : undefined;
    const defFrom = preset || held[0] || null;
    if (!defFrom) return; // empty wallet — picker will show the empty state
    const wantOut = DEFAULT_OUTPUT[defFrom.chainId];
    const defTo =
      (wantOut && assets.find(a => a.asset === wantOut && a.caip !== defFrom.caip)) ||
      assets.find(a => a.symbol === 'BTC' && a.caip !== defFrom.caip) ||
      assets.find(a => a.caip !== defFrom.caip) ||
      null;
    setFrom(defFrom);
    setTo(defTo);
  }, [assets, balanceByCaip, balancesLoading, from, to, initialFromCaip]);

  const fromBalance = useMemo<number | undefined>(() => {
    if (!from?.caip) return undefined;
    return balanceByCaip.get(from.caip)?.amount;
  }, [from, balanceByCaip]);

  // Debounced quote whenever from/to/amount change.
  useEffect(() => {
    if (!from?.caip || !to?.caip) return;
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setQuote(null);
      setQuoteError(null);
      setQuoteLoading(false);
      return;
    }
    const seq = ++quoteSeq.current;
    setQuoteLoading(true);
    setQuoteError(null);
    const handle = setTimeout(async () => {
      try {
        const q = await fetchSwapQuote({
          fromCaip: from.caip!,
          toCaip: to.caip!,
          amount,
          slippageBps: 300,
        });
        if (seq !== quoteSeq.current) return;
        setQuote(q);
        setQuoteLoading(false);
      } catch (e: any) {
        if (seq !== quoteSeq.current) return;
        setQuote(null);
        setQuoteError(e?.message || 'No quote available');
        setQuoteLoading(false);
      }
    }, 600);
    return () => clearTimeout(handle);
  }, [from, to, amount]);

  const flip = () => {
    setFrom(to);
    setTo(from);
    setQuote(null);
  };

  const pickAsset = (a: UiAsset) => {
    if (pickerSide === 'from') {
      if (to && a.caip === to.caip) setTo(from);
      setFrom(a);
    } else if (pickerSide === 'to') {
      if (from && a.caip === from.caip) setFrom(to);
      setTo(a);
    }
    setQuote(null);
    setPickerSide(null);
  };

  // "Review Swap" → confirmation stage (no device interaction yet).
  const goToReview = () => {
    if (!from || !to || !quote) return;
    setExecError(null);
    setScreen('review');
  };

  // Confirm on the review screen → headless execute (drives the device to sign).
  const confirm = async () => {
    if (!from || !to || !quote) return;
    setExecError(null);
    setSubmittedFrom(from);
    setSubmittedTo(to);
    setSubmittedAmount(amount);
    setScreen('submitting');
    const params: ExecuteSwapParams = {
      fromChainId: from.chainId,
      toChainId: to.chainId,
      fromCaip: from.caip || from.asset,
      toCaip: to.caip || to.asset,
      amount,
      memo: quote.memo,
      inboundAddress: quote.inboundAddress,
      router: quote.router,
      expiry: quote.expiry,
      expectedOutput: quote.expectedOutput,
      slippageBps: quote.slippageBps,
      integration: quote.integration,
      swapper: quote.swapper,
      tokenDecimals: from.decimals,
      // Full-quote pass-through → vault /execute is stateless (doesn't rely on its
      // in-process quote cache). relayTx drives relay/0x/chainflip EVM routes;
      // netFromAmount is the NEAR-Intents sendMax correctness field.
      relayTx: quote.relayTx,
      netFromAmount: quote.netFromAmount,
      minimumOutput: quote.minimumOutput,
      fees: quote.fees,
      estimatedTime: quote.estimatedTime,
      nearIntentsDepositAddress: quote.nearIntentsDepositAddress,
      minAmountIn: quote.minAmountIn,
    };
    try {
      const result = await executeSwap(params);
      setTxid(result.txid);
      setStatus(null);
      setScreen('submitted');
    } catch (e: any) {
      setExecError(e?.message || 'Swap failed');
      setScreen('input');
    }
  };

  // Fetch the tracked status once. Shared by the poll loop and the manual
  // Refresh button. Returns null until the vault tracker has written the record
  // (404 right after submit), so we keep polling and surface "checking".
  const isTerminal = (s?: SwapTrackingStatus) =>
    s === 'completed' || s === 'failed' || s === 'refunded' || s === 'output_confirmed';

  const checkStatus = useCallback(async () => {
    if (!txid) return;
    setStatusChecking(true);
    try {
      const rec = await fetchSwapStatus(txid);
      if (rec) setStatus(rec);
    } finally {
      setStatusChecking(false);
      setStatusCheckedAt(Date.now());
    }
  }, [txid]);

  // Poll status on the submitted screen. The interval itself only depends on
  // screen+txid; terminal state is read from statusRef so it never restarts.
  useEffect(() => {
    if (screen !== 'submitted' || !txid) return;
    let cancelled = false;
    checkStatus();
    const t = setInterval(() => {
      if (cancelled || isTerminal(statusRef.current?.status)) return;
      checkStatus();
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [screen, txid, checkStatus]);

  // Accelerator: subscribe to Pioneer's SSE feed (via the background) for the
  // swap's addresses. A tx:incoming on the destination fires an instant status
  // refresh so "output arrived" shows in real time. The poll above is the
  // source of truth; this only nudges it (and lights the "Live" indicator).
  useEffect(() => {
    if (screen !== 'submitted' || !txid || !submittedFrom || !submittedTo) return;
    setSseLive(false);
    const listener = (msg: any) => {
      if (msg?.type !== 'SWAP_EVENT' || msg.txid !== txid) return;
      if (msg.event?.type === 'connected') setSseLive(true);
      if (msg.event?.type === 'tx:incoming' || msg.event?.type === 'tx:confirmed') checkStatus();
    };
    try {
      chrome.runtime.onMessage.addListener(listener);
      chrome.runtime.sendMessage({
        type: 'SWAP_WATCH',
        txid,
        fromCaip: submittedFrom.caip,
        toCaip: submittedTo.caip,
      });
    } catch {
      /* ignore — poll still drives the UI */
    }
    return () => {
      try {
        chrome.runtime.onMessage.removeListener(listener);
        chrome.runtime.sendMessage({ type: 'SWAP_UNWATCH' });
      } catch {
        /* ignore */
      }
      setSseLive(false);
    };
  }, [screen, txid, submittedFrom, submittedTo, checkStatus]);

  const newSwap = () => {
    setTxid('');
    setStatus(null);
    setStatusCheckedAt(null);
    setStatusChecking(false);
    setSseLive(false);
    setAmount('');
    setQuote(null);
    setExecError(null);
    setScreen('input');
  };

  return (
    <div style={{ position: 'relative', minHeight: '100%', height: '100%', background: T.bg, color: T.text }}>
      <style>{SWAP_KEYFRAMES}</style>

      {screen === 'loading' && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            height: '100%',
            minHeight: 320,
          }}>
          <Spinner color="kk.accent" />
          <div style={{ fontSize: 13, color: T.faint }}>Loading swap…</div>
        </div>
      )}

      {screen === 'load-error' && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            height: '100%',
            minHeight: 320,
            padding: 28,
            textAlign: 'center',
          }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: '50%',
              background: T.surface,
              border: `1px solid ${T.line}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: T.faint,
              marginBottom: 2,
            }}>
            <Icon d={I.shield} size={22} />
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: T.text }}>{loadErrorTitle}</div>
          <div style={{ fontSize: 12.5, color: T.dim, lineHeight: 1.5, maxWidth: 260 }}>{loadErrorHint}</div>
          <div style={{ display: 'flex', gap: 8, width: '100%', maxWidth: 260, marginTop: 6 }}>
            <PrimaryBtn T={T} ghost onClick={onClose} icon={<Icon d={I.left} size={13} />}>
              Back
            </PrimaryBtn>
            <PrimaryBtn T={T} onClick={() => setReloadTick(t => t + 1)} icon={<Icon d={I.refresh} size={13} />}>
              Retry
            </PrimaryBtn>
          </div>
        </div>
      )}

      {screen === 'input' && from && to && (
        <>
          {execError && (
            <div
              style={{
                margin: '10px 14px 0',
                padding: '10px 14px',
                borderRadius: 12,
                background: 'rgba(224,80,80,0.08)',
                border: `1px solid ${T.bad}`,
                color: T.bad,
                fontSize: 12,
              }}>
              {execError}
            </div>
          )}
          <SwapScreen
            T={T}
            from={from}
            to={to}
            amount={amount}
            fromBalance={fromBalance}
            quote={quote}
            quoteLoading={quoteLoading}
            quoteError={quoteError}
            onAmount={setAmount}
            onPickFrom={() => setPickerSide('from')}
            onPickTo={() => setPickerSide('to')}
            onFlip={flip}
            onBack={onClose}
            onReview={goToReview}
            onHistory={() => setScreen('history')}
          />
        </>
      )}

      {screen === 'input' && (!from || !to) && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            height: '100%',
            minHeight: 320,
            padding: 24,
            textAlign: 'center',
          }}>
          {balancesLoading ? (
            <>
              <Spinner color="kk.accent" />
              <div style={{ fontSize: 13, color: T.faint }}>Checking your KeepKey balances…</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 14, color: T.text }}>Nothing to swap</div>
              <div style={{ fontSize: 12, color: T.faint }}>
                Your KeepKey has no swappable balances yet. Receive funds, then come back to swap.
              </div>
              <div style={{ width: 160 }}>
                <PrimaryBtn T={T} onClick={onClose}>
                  Close
                </PrimaryBtn>
              </div>
            </>
          )}
        </div>
      )}

      {screen === 'history' && <SwapHistory T={T} onBack={() => setScreen('input')} />}

      {screen === 'review' && from && to && quote && (
        <SwapReview
          T={T}
          from={from}
          to={to}
          amount={amount}
          quote={quote}
          onBack={() => setScreen('input')}
          onConfirm={confirm}
        />
      )}

      {screen === 'submitting' && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 14,
            height: '100%',
            minHeight: 320,
            padding: 24,
            textAlign: 'center',
          }}>
          <Spinner color="kk.accent" />
          <div style={{ fontSize: 14, color: T.text }}>Confirm on your KeepKey</div>
          <div style={{ fontSize: 12, color: T.faint }}>
            Review the swap details on the device and press the button to sign.
          </div>
        </div>
      )}

      {screen === 'submitted' && submittedFrom && submittedTo && (
        <SwapProgress
          T={T}
          from={submittedFrom}
          to={submittedTo}
          fromAmount={submittedAmount}
          expectedOutput={quote?.expectedOutput || ''}
          provider={quote?.swapper || quote?.integration}
          txid={txid}
          status={status}
          estimatedTime={quote?.estimatedTime}
          checking={statusChecking}
          checkedAt={statusCheckedAt}
          live={sseLive}
          onRefresh={checkStatus}
          onNewSwap={newSwap}
          onClose={onClose}
        />
      )}

      {pickerSide && (
        <AssetPicker
          T={T}
          assets={assets}
          excludeCaip={pickerSide === 'from' ? to?.caip : from?.caip}
          title={pickerSide === 'from' ? 'Swap from' : 'Swap to'}
          side={pickerSide}
          balanceByCaip={balanceByCaip}
          balancesLoading={balancesLoading}
          onSelect={pickAsset}
          onClose={() => setPickerSide(null)}
        />
      )}
    </div>
  );
}

export default Swap;
