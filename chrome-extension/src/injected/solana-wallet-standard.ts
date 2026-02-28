/**
 * KeepKey Solana Wallet Standard implementation.
 *
 * Completely isolated from Ethereum EIP-1193 / EIP-6963 code.
 * Registers via the Wallet Standard registry so dApps discover the wallet
 * without touching window.solana.
 */

import type { ChainType } from './types';

// ---------- Base58 (inline, no external dep) ----------

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Decode(str: string): Uint8Array {
  const bytes: number[] = [0];
  for (const char of str) {
    const idx = BASE58_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error('Invalid base58 character');
    let carry = idx;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Leading zeros
  for (const char of str) {
    if (char !== '1') break;
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

// ---------- Types (wallet-standard shapes) ----------

interface WalletAccount {
  address: string;
  publicKey: Uint8Array;
  chains: readonly string[];
  features: readonly string[];
}

type ChangeListener = (props: { accounts?: readonly WalletAccount[]; features?: Record<string, unknown> }) => void;

// ---------- Wallet class ----------

export class KeepKeySolanaWallet {
  readonly #walletRequest: (
    method: string,
    params: any[],
    chain: ChainType,
    callback: (error: any, result?: any) => void,
  ) => void;

  #accounts: WalletAccount[] = [];
  #cachedAddress: string | null = null;
  readonly #listeners = new Set<ChangeListener>();

  // Wallet Standard required fields
  readonly version = '1.0.0' as const;
  readonly name = 'KeepKey';
  readonly icon =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACshmLzAAADUklEQVRYCb1XTUgUYRie3bXEWhVLQaUsgwVLoUtEQjUJiZX0A0GX7BIZXurkOTSvdo2kvETHAsOshFgqOqhlRD9C7SGS1JTCsj1krU7PM+w7zMzOzuzMqi88+73v9z7vz3zzzTeziuIgmqbFgG5gBPguFOgq4CXLIMwCo0AXEJN4zxHkEuA6kAIMkUBMqMZk7so/UG8AUcnjOIKwFXgHZIgEwKFmOHOfYO4aySVjmAoc7O4R0EB7lYS5h9K1jBJ6A7CuAfXG7OopbKLXkh4dccNZ7jlsi0gAJlWLI5jBPWFsTK5AGxCRImswFqDGWanDBo6IsYbjUanFbmrFWIHxD3IsmfJsgB4y2aJuF4UrUC5GnuNtxJeEQqEoAb3LJV+F4ctlHwkZXDULv8fEKQCHB4+rCJ9ngKcIGUTVRubT027y8yR9bOM4mhKTTwNJZD4miaDXAG8dqzlMShw3YRCZRVAr7vU4g5F/D4ZBoJK2H+Em9CsfEdBoKn4K9jPAd3G9sMPqZEzpRPzAwRfWJpN9EfZSRkAOE5LD7wrw8dkpwRh55VMm27fqt4FiVBjGBTaxEm4Db8d+4BPtIOK3AdbYCPC1qh/haGIS9gHgDeBbgjTAIkXAfTRxkgaamMNwCHgB+BMk4Decq0hGkFQbka/WMyZ/EeyHNo6TuSwx3Nn8gHQVIYOkOhB5Gp4zcdbBHiDvZ2pRuzozru2euKuDOucg/KliTAjKKMa9ksBpxBLrbzRwVfifOnB4RR2g3QSH3Cfx5FRdc2KoGstroUeQKh47vnAwWvUKjsPcA/wWdBUkjRAgZdsznO8D5xLGC/Opxc3NiQeV9uIsgkNDaUoMFpNDLleAn0cTQNBjGaFW6fn2Wrky/dI6abPOl9eN9deoWhjLloCv3+bPy7w3/9kzfvjX120g1cuSdsJ47xm1CgS9AaxCErlbV6qJ02W1nq22lG75AtIHWQEeJpOYaAT6gBQQWC5XNCjc7dkkHFKWe6v3FcLfbzRAMlcC6IC6C+gGxgCectZnCRMuopVG1v+Nx04sYINlxLH4wI6W52UFhT+Q41b2Nl0qeLnwZPGQucNHrXN6ZDG94RQuO688XbwNFzvjlSuwH03wEW8H+Bf/dxrUOWdc+H8mKXtEpGpY3AAAAABJRU5ErkJggg==' as `data:image/png;base64,${string}`;

  readonly chains = ['solana:mainnet'] as const;

  static readonly ACCOUNT_FEATURES = [
    'solana:signTransaction',
    'solana:signAndSendTransaction',
    'solana:signMessage',
  ] as const;

  get accounts(): readonly WalletAccount[] {
    return this.#accounts;
  }

  readonly features = {
    'standard:connect': {
      version: '1.0.0' as const,
      connect: async () => {
        // If already connected, just return
        if (this.#accounts.length > 0) {
          return { accounts: this.#accounts };
        }
        // Use cached address (from silent connect or localStorage) for instant response,
        // otherwise fetch from vault
        const address = this.#cachedAddress || (await this.#rpc('solana_connect', []));
        if (address) {
          this.#setConnected(address);
        }
        return { accounts: this.#accounts };
      },
    },

    'standard:disconnect': {
      version: '1.0.0' as const,
      disconnect: async () => {
        await this.#rpc('solana_disconnect', []).catch(() => {});
        this.#accounts = [];
        try {
          localStorage.removeItem('keepkey-solana');
        } catch {
          /* ignore */
        }
        this.#emitChange();
      },
    },

    'standard:events': {
      version: '1.0.0' as const,
      on: (event: string, listener: ChangeListener) => {
        if (event === 'change') {
          this.#listeners.add(listener);
        }
        return () => {
          this.#listeners.delete(listener);
        };
      },
    },

    'solana:signMessage': {
      version: '1.0.0' as const,
      signMessage: async (...inputs: { message: Uint8Array; account: WalletAccount }[]) => {
        const outputs: { signedMessage: Uint8Array; signature: Uint8Array }[] = [];
        for (const { message } of inputs) {
          const sigArray: number[] = await this.#rpc('solana_signMessage', [Array.from(message)]);
          outputs.push({
            signedMessage: message,
            signature: new Uint8Array(sigArray),
          });
        }
        return outputs;
      },
    },

    'solana:signTransaction': {
      version: '1.0.0' as const,
      supportedTransactionVersions: new Set(['legacy', 0] as const),
      signTransaction: async (...inputs: { transaction: Uint8Array; account: WalletAccount; chain?: string }[]) => {
        const outputs: { signedTransaction: Uint8Array }[] = [];
        for (const { transaction } of inputs) {
          const signedArray: number[] = await this.#rpc('solana_signTransaction', [Array.from(transaction)]);
          outputs.push({
            signedTransaction: new Uint8Array(signedArray),
          });
        }
        return outputs;
      },
    },

    'solana:signAndSendTransaction': {
      version: '1.0.0' as const,
      supportedTransactionVersions: new Set(['legacy', 0] as const),
      signAndSendTransaction: async (
        ...inputs: { transaction: Uint8Array; account: WalletAccount; chain?: string; options?: any }[]
      ) => {
        const outputs: { signature: Uint8Array }[] = [];
        for (const { transaction } of inputs) {
          const txSig: string = await this.#rpc('solana_signAndSendTransaction', [Array.from(transaction)]);
          // txSig is a base58 transaction signature string — decode to bytes
          outputs.push({
            signature: base58Decode(txSig),
          });
        }
        return outputs;
      },
    },

    'solana:signIn': {
      version: '1.0.0' as const,
      signIn: async (...inputs: any[]) => {
        const outputs: { account: WalletAccount; signedMessage: Uint8Array; signature: Uint8Array }[] = [];
        for (const input of inputs) {
          // Ensure connected
          if (this.#accounts.length === 0) {
            const address = this.#cachedAddress || (await this.#rpc('solana_connect', []));
            if (address) this.#setConnected(address);
          }
          const account = this.#accounts[0];
          if (!account) throw new Error('Not connected');

          // Build SIWS message per CAIP-122 / EIP-4361
          const domain = input?.domain || location.host;
          const address = input?.address || account.address;
          const uri = input?.uri || location.href;
          const version = input?.version || '1';
          const chainId = input?.chainId || 'mainnet';
          const nonce = input?.nonce || Math.random().toString(36).substring(2);
          const issuedAt = input?.issuedAt || new Date().toISOString();
          const statement = input?.statement || '';

          let msg = `${domain} wants you to sign in with your Solana account:\n${address}`;
          if (statement) msg += `\n\n${statement}`;
          msg += `\n\nURI: ${uri}`;
          msg += `\nVersion: ${version}`;
          msg += `\nChain ID: ${chainId}`;
          msg += `\nNonce: ${nonce}`;
          msg += `\nIssued At: ${issuedAt}`;
          if (input?.expirationTime) msg += `\nExpiration Time: ${input.expirationTime}`;
          if (input?.notBefore) msg += `\nNot Before: ${input.notBefore}`;
          if (input?.requestId) msg += `\nRequest ID: ${input.requestId}`;
          if (input?.resources?.length) {
            msg += `\nResources:`;
            for (const r of input.resources) msg += `\n- ${r}`;
          }

          const messageBytes = new TextEncoder().encode(msg);
          const sigArray: number[] = await this.#rpc('solana_signMessage', [Array.from(messageBytes)]);

          outputs.push({
            account,
            signedMessage: messageBytes,
            signature: new Uint8Array(sigArray),
          });
        }
        return outputs;
      },
    },
  };

  constructor(
    walletRequest: (
      method: string,
      params: any[],
      chain: ChainType,
      callback: (error: any, result?: any) => void,
    ) => void,
  ) {
    this.#walletRequest = walletRequest;

    // Restore cached address from previous session for instant connect
    try {
      const cached = localStorage.getItem('keepkey-solana');
      if (cached) {
        const { address } = JSON.parse(cached);
        if (address && typeof address === 'string') {
          this.#cachedAddress = address;
        }
      }
    } catch {
      /* ignore */
    }

    // Silent connect: pre-fetch address from vault (no popup needed).
    // Only caches the address — does NOT set accounts (adapter needs to
    // go through its own connect() flow for proper React event emission).
    this.#silentConnect();
  }

  // ---------- Internal helpers ----------

  #makeAccount(address: string): WalletAccount {
    return {
      address,
      publicKey: base58Decode(address),
      chains: ['solana:mainnet'] as readonly string[],
      features: [...KeepKeySolanaWallet.ACCOUNT_FEATURES] as readonly string[],
    };
  }

  #setConnected(address: string) {
    this.#accounts = [this.#makeAccount(address)];
    try {
      localStorage.setItem('keepkey-solana', JSON.stringify({ address }));
    } catch {
      /* ignore */
    }
    this.#emitChange();
  }

  async #silentConnect() {
    try {
      const address: string = await this.#rpc('solana_connect', []);
      if (address && typeof address === 'string') {
        this.#cachedAddress = address;
        try {
          localStorage.setItem('keepkey-solana', JSON.stringify({ address }));
        } catch {
          /* ignore */
        }
      }
    } catch {
      // Vault not ready or device not connected — ignore.
      // User can manually connect later via standard:connect.
    }
  }

  #emitChange() {
    const accounts = this.#accounts;
    const features = this.features;
    this.#listeners.forEach(fn => {
      try {
        fn({ accounts, features });
      } catch {
        // swallow listener errors
      }
    });
  }

  #rpc(method: string, params: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
      this.#walletRequest(method, params, 'solana' as ChainType, (error, result) => {
        if (error) reject(error);
        else resolve(result);
      });
    });
  }
}
