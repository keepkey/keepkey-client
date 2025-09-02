# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

KeepKey Client is a browser extension for the KeepKey hardware wallet, built using React, TypeScript, and Vite with a Turborepo monorepo architecture. The extension supports Chrome and Firefox (Manifest V3).

## Development Commands

### Core Development
```bash
# Install dependencies (requires pnpm 9.9.0+, Node >=18.19.1)
pnpm install

# Development mode with hot reload
pnpm dev         # Chrome
pnpm dev:firefox # Firefox

# Production build
pnpm build         # Chrome
pnpm build:firefox # Firefox

# Create distributable zip
pnpm zip         # Chrome (creates extension.zip)
pnpm zip:firefox # Firefox
```

### Testing & Quality
```bash
# Run E2E tests (builds and zips first)
pnpm e2e         # Chrome
pnpm e2e:firefox # Firefox

# Type checking
pnpm type-check

# Linting & formatting
pnpm lint       # Run ESLint with fixes
pnpm lint:fix   # Fix all linting issues
pnpm prettier   # Format code with Prettier

# Run specific E2E test
pnpm -F @extension/e2e e2e
```

### Clean & Reset
```bash
# Clean build artifacts
pnpm clean:bundle      # Remove dist and dist-zip
pnpm clean:node_modules # Remove all node_modules
pnpm clean:turbo       # Clear Turbo cache
pnpm clean            # Full clean (all above)
pnpm clean:install    # Clean + reinstall dependencies
```

## Architecture & Structure

### Monorepo Layout
The project uses Turborepo with pnpm workspaces:

- **`chrome-extension/`**: Core extension with background script and manifest configuration
- **`packages/`**: Shared packages used across the extension
  - `dev-utils`: Development utilities and manifest parser
  - `hmr`: Custom hot module reload plugin for Vite
  - `i18n`: Internationalization with type safety
  - `shared`: Shared hooks, components, and utilities
  - `storage`: Chrome storage API helpers with TypeScript
  - `ui`: Reusable UI components
  - `vite-config`: Shared Vite configuration
  - `zipper`: Build artifact packaging
- **`pages/`**: Extension pages and entry points
  - `popup`: Main extension popup UI
  - `side-panel`: Chrome side panel (not available in Firefox)
  - `options`: Extension settings page
  - `content`: Content script for page injection
  - `content-ui`: Content script UI components
  - `devtools`: Developer tools integration

### Key Architecture Patterns

**Background Service Worker**: Located at `chrome-extension/src/background/index.ts`, handles:
- KeepKey hardware wallet connection monitoring (polls `http://localhost:1646` every 5 seconds)
- Chain-specific request handlers (Bitcoin, Ethereum, Cosmos, etc.)
- State management and icon updates based on connection status
- RPC request routing and approval flows

**Multi-Chain Support**: Each blockchain has a dedicated handler in `chrome-extension/src/background/chains/`:
- EVM chains (Ethereum, BSC, Avalanche, etc.)
- UTXO chains (Bitcoin, Litecoin, Dogecoin, etc.)
- Cosmos ecosystem (THORChain, Maya, Osmosis)
- Unique chains (Ripple)

**Storage Architecture**: Uses Chrome storage API with TypeScript wrappers:
- `requestStorage`: Pending wallet requests
- `web3ProviderStorage`: Web3 provider configuration
- `exampleSidebarStorage`: UI state persistence

**Message Passing**: The extension uses Chrome runtime messaging for:
- Background ↔ Popup communication
- Content script ↔ Background communication
- State change notifications (KEEPKEY_STATE_CHANGED events)

### Build System

**Vite Configuration**:
- Each package/page has its own `vite.config.mts`
- Shared config via `@extension/vite-config`
- IIFE format for background script and content scripts
- Source maps in dev, minification in production

**Manifest Generation**: Dynamic manifest.js with:
- Conditional features (side panel only for Chrome)
- Localization support via `__MSG_*` placeholders
- All permissions required for hardware wallet interaction

## Environment Variables

Create `.env` from `.example.env` and define types in `vite-env.d.ts`:
```typescript
interface ImportMetaEnv {
  // Add your env var types here
}
```

## Extension Loading

### Chrome
1. Navigate to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `dist` folder

### Firefox  
1. Navigate to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select `manifest.json` from `dist` folder
Note: Firefox extensions are temporary and need reloading after browser restart

## Working with Turborepo

```bash
# Install dependency for root
pnpm i <package> -w

# Install for specific workspace
pnpm i <package> -F @extension/popup

# Run command in specific workspace
pnpm -F @extension/e2e e2e

# Build specific packages
turbo build --filter=@extension/popup
```

## State Management

The extension tracks KeepKey connection states:
- 0: Unknown
- 1: Disconnected
- 2: Connected
- 3: Busy
- 4: Errored
- 5: Paired (address available)

Icon changes based on state (online/offline variants).

## Critical Files & Entry Points

- **Background Script**: `chrome-extension/src/background/index.ts`
- **Popup Entry**: `pages/popup/src/index.tsx`
- **Manifest Config**: `chrome-extension/manifest.js`
- **Chain Handlers**: `chrome-extension/src/background/chains/*.ts`
- **Storage Types**: `packages/storage/lib/types.ts`