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

type ChangeListener = (props: { accounts: readonly WalletAccount[] }) => void;

// ---------- Wallet class ----------

export class KeepKeySolanaWallet {
  readonly #walletRequest: (
    method: string,
    params: any[],
    chain: ChainType,
    callback: (error: any, result?: any) => void,
  ) => void;

  #accounts: WalletAccount[] = [];
  readonly #listeners = new Set<ChangeListener>();

  // Wallet Standard required fields
  readonly version = '1.0.0' as const;
  readonly name = 'KeepKey';
  readonly icon =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACshmLzAAADUklEQVRYCb1XTUgUYRie3bXEWhVLQaUsgwVLoUtEQjUJiZX0A0GX7BIZXurkOTSvdo2kvETHAsOshFgqOqhlRD9C7SGS1JTCsj1krU7PM+w7zMzOzuzMqi88+73v9z7vz3zzzTeziuIgmqbFgG5gBPguFOgq4CXLIMwCo0AXEJN4zxHkEuA6kAIMkUBMqMZk7so/UG8AUcnjOIKwFXgHZIgEwKFmOHOfYO4aySVjmAoc7O4R0EB7lYS5h9K1jBJ6A7CuAfXG7OopbKLXkh4dccNZ7jlsi0gAJlWLI5jBPWFsTK5AGxCRImswFqDGWanDBo6IsYbjUanFbmrFWIHxD3IsmfJsgB4y2aJuF4UrUC5GnuNtxJeEQqEoAb3LJV+F4ctlHwkZXDULv8fEKQCHB4+rCJ9ngKcIGUTVRubT027y8yR9bOM4mhKTTwNJZD4miaDXAG8dqzlMShw3YRCZRVAr7vU4g5F/D4ZBoJK2H+Em9CsfEdBoKn4K9jPAd3G9sMPqZEzpRPzAwRfWJpN9EfZSRkAOE5LD7wrw8dkpwRh55VMm27fqt4FiVBjGBTaxEm4Db8d+4BPtIOK3AdbYCPC1qh/haGIS9gHgDeBbgjTAIkXAfTRxkgaamMNwCHgB+BMk4Decq0hGkFQbka/WMyZ/EeyHNo6TuSwx3Nn8gHQVIYOkOhB5Gp4zcdbBHiDvZ2pRuzozru2euKuDOucg/KliTAjKKMa9ksBpxBLrbzRwVfifOnB4RR2g3QSH3Cfx5FRdc2KoGstroUeQKh47vnAwWvUKjsPcA/wWdBUkjRAgZdsznO8D5xLGC/Opxc3NiQeV9uIsgkNDaUoMFpNDLleAn0cTQNBjGaFW6fn2Wrky/dI6abPOl9eN9deoWhjLloCv3+bPy7w3/9kzfvjX120g1cuSdsJ47xm1CgS9AaxCErlbV6qJ02W1nq22lG75AtIHWQEeJpOYaAT6gBQQWC5XNCjc7dkkHFKWe6v3FcLfbzRAMlcC6IC6C+gGxgCectZnCRMuopVG1v+Nx04sYINlxLH4wI6W52UFhT+Q41b2Nl0qeLnwZPGQucNHrXN6ZDG94RQuO688XbwNFzvjlSuwH03wEW8H+Bf/dxrUOWdc+H8mKXtEpGpY3AAAAABJRU5ErkJggg==' as `data:image/png;base64,${string}`;

  readonly chains = ['solana:mainnet'] as const;

  get accounts(): readonly WalletAccount[] {
    return this.#accounts;
  }

  readonly features = {
    'standard:connect': {
      version: '1.0.0' as const,
      connect: async () => {
        const address = await this.#rpc('solana_connect', []);
        if (address) {
          const publicKey = base58Decode(address);
          this.#accounts = [
            {
              address,
              publicKey,
              chains: ['solana:mainnet'] as readonly string[],
              features: ['solana:signTransaction', 'solana:signMessage'] as readonly string[],
            },
          ];
          this.#emit();
        }
        return { accounts: this.#accounts };
      },
    },

    'standard:disconnect': {
      version: '1.0.0' as const,
      disconnect: async () => {
        await this.#rpc('solana_disconnect', []).catch(() => {});
        this.#accounts = [];
        this.#emit();
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
      supportedTransactionVersions: ['legacy', 0] as const,
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
  }

  // ---------- Internal helpers ----------

  #emit() {
    const accounts = this.#accounts;
    this.#listeners.forEach(fn => {
      try {
        fn({ accounts });
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
