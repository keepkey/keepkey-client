/**
 * Side-panel surfacing helpers shared between the approval flow
 * (methods.ts) and chain handlers that need to surface info-only
 * notifications without going through the requireApproval path
 * (e.g. wallet_switchEthereumChain on an unknown chain — must
 * still throw 4902 to the dApp per EIP-3326, but the user should
 * see *why* nothing happened).
 *
 * Lives in its own module to break the methods.ts ↔ chain-handler
 * circular import that would otherwise form.
 */

const TAG = ' | popup | ';

const findTargetWindowId = async (preferred?: number | null): Promise<number | null> => {
  try {
    // ALWAYS prefer the sender tab's own window when we know it — that's
    // the browser window the dApp is running in, and the side panel
    // MUST open there.
    if (preferred != null) {
      try {
        const w = await chrome.windows.get(preferred);
        if (w?.id != null) return w.id;
      } catch {
        // Window closed between request and surface — fall through.
      }
    }
    const current = await chrome.windows.getLastFocused({});
    return current?.id ?? null;
  } catch {
    return null;
  }
};

export const openSidePanel = async (requestInfo: any): Promise<void> => {
  const tag = TAG + ' | openSidePanel | ';
  if (!chrome.sidePanel?.open) return;
  try {
    const windowId = await findTargetWindowId(requestInfo?.__senderWindowId);
    if (windowId == null) {
      console.warn(tag, 'No target window found — user must click the extension icon to open the panel');
      return;
    }
    try {
      await chrome.sidePanel.open({ windowId });
      console.log(tag, 'Side panel opened for windowId:', windowId);
    } catch (e) {
      console.warn(tag, 'sidePanel.open failed (likely no user gesture), falling back to badge', e);
    }
  } catch (e) {
    console.error(tag, e);
  }
};

export const setApprovalBadge = (pending: boolean) => {
  try {
    chrome.action.setBadgeText({ text: pending ? '!' : '' });
    if (pending) chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' });
  } catch (e) {
    console.warn(TAG, 'setApprovalBadge failed', e);
  }
};
