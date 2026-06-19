// Swap — orchestrates the native side-panel swap flow against vault's headless
// swap REST (via the background SWAP_REQUEST bridge). Owns asset list, from/to,
// amount, debounced quote, execute, and submitted-status polling. The visual is
// a faithful port of the BEX design (SwapScreen + SwapProgress).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Spinner } from '@chakra-ui/react';
import { T, SWAP_KEYFRAMES, colorForSymbol } from './theme';
import type { SwapAsset, UiAsset, SwapQuote, SwapHistoryRecord, ExecuteSwapParams } from './types';
import { fetchSwapAssets, fetchSwapQuote, executeSwap, fetchSwapStatus } from './swapApi';
import { SwapScreen } from './SwapScreen';
import { SwapProgress } from './SwapProgress';
import { AssetPicker } from './AssetPicker';
import { PrimaryBtn } from './ui';

const toUi = (a: SwapAsset): UiAsset => ({ ...a, color: colorForSymbol(a.symbol) });

type Screen = 'loading' | 'load-error' | 'input' | 'submitting' | 'submitted';

export function Swap({ onClose }: { onClose: () => void }) {
  const [screen, setScreen] = useState<Screen>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [assets, setAssets] = useState<UiAsset[]>([]);
  const [balances, setBalances] = useState<any[]>([]);

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

  const quoteSeq = useRef(0);

  // Load assets + balances on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchSwapAssets();
        if (cancelled) return;
        const ui = list.map(toUi);
        setAssets(ui);
        // default from = a held asset if possible, to = a different one (prefer BTC)
        const heldCaips = new Set(balances.map((b: any) => b.caip).filter(Boolean));
        const defFrom = ui.find(a => a.caip && heldCaips.has(a.caip)) || ui[0] || null;
        const defTo =
          ui.find(a => a.symbol === 'BTC' && a.caip !== defFrom?.caip) ||
          ui.find(a => a.caip !== defFrom?.caip) ||
          null;
        setFrom(defFrom);
        setTo(defTo);
        setScreen('input');
      } catch (e: any) {
        if (!cancelled) {
          setLoadError(e?.message || 'Could not load swap assets');
          setScreen('load-error');
        }
      }
    })();
    // balances (best-effort, for from-balance + Max)
    try {
      chrome.runtime.sendMessage({ type: 'GET_APP_BALANCES' }, (resp: any) => {
        if (!cancelled && resp?.balances) setBalances(resp.balances);
      });
    } catch {
      /* ignore */
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fromBalance = useMemo<number | undefined>(() => {
    if (!from?.caip) return undefined;
    const b = balances.find((x: any) => x.caip === from.caip);
    const v = b?.balance ?? b?.amount;
    const n = v != null ? parseFloat(v) : NaN;
    return Number.isFinite(n) ? n : undefined;
  }, [from, balances]);

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

  const review = async () => {
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

  // Poll status on the submitted screen.
  useEffect(() => {
    if (screen !== 'submitted' || !txid) return;
    let cancelled = false;
    const tick = async () => {
      const rec = await fetchSwapStatus(txid);
      if (cancelled) return;
      if (rec) setStatus(rec);
    };
    tick();
    const t = setInterval(() => {
      if (
        status &&
        (status.status === 'completed' ||
          status.status === 'failed' ||
          status.status === 'refunded' ||
          status.status === 'output_confirmed')
      ) {
        return;
      }
      tick();
    }, 1500);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [screen, txid, status]);

  const newSwap = () => {
    setTxid('');
    setStatus(null);
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
          <Spinner color="green.300" />
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
            gap: 14,
            height: '100%',
            minHeight: 320,
            padding: 24,
            textAlign: 'center',
          }}>
          <div style={{ fontSize: 14, color: T.text }}>Swap unavailable</div>
          <div style={{ fontSize: 12, color: T.faint }}>{loadError}</div>
          <div style={{ width: 160 }}>
            <PrimaryBtn T={T} onClick={onClose}>
              Close
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
            onReview={review}
          />
        </>
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
          <Spinner color="green.300" />
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
          onSelect={pickAsset}
          onClose={() => setPickerSide(null)}
        />
      )}
    </div>
  );
}

export default Swap;
