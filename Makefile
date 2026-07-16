# KeepKey Client (browser extension) — make targets.
# Thin wrapper over the project's pnpm scripts so the usual flow
# stays consistent with the stack-wide "use make for everything" rule.

SHELL := /bin/bash

.DEFAULT_GOAL := build

.PHONY: help build build-firefox dev dev-firefox zip zip-firefox \
        install reinstall clean clean-bundle clean-turbo clean-deps \
        lint lint-fix prettier type-check test e2e e2e-firefox \
        test-mcp test-mcp-browser bump

help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "targets:\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  %-18s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

# ---------- build ----------

build: ## Production build (Chrome) → dist/
	pnpm build

build-firefox: ## Production build (Firefox) → dist/
	pnpm build:firefox

zip: ## Build + package extension.zip (Chrome) → dist-zip/
	pnpm zip

zip-firefox: ## Build + package extension.zip (Firefox) → dist-zip/
	pnpm zip:firefox

# ---------- dev ----------

dev: ## Watch-mode dev build (Chrome), HMR on, keeps running
	pnpm dev

dev-firefox: ## Watch-mode dev build (Firefox), HMR on, keeps running
	pnpm dev:firefox

# ---------- deps ----------

install: ## Install deps (frozen lockfile is fine, mirrors CI)
	pnpm install

reinstall: ## Nuke node_modules and reinstall from lockfile
	pnpm clean:install

# ---------- clean ----------

clean: ## Full clean (dist, caches, node_modules)
	pnpm clean

clean-bundle: ## Clean only dist/ and dist-zip/
	pnpm clean:bundle

clean-turbo: ## Clean Turborepo cache
	pnpm clean:turbo

clean-deps: ## Clean node_modules only
	pnpm clean:node_modules

# ---------- quality ----------

lint: ## Lint with autofix + cache
	pnpm lint

lint-fix: ## Lint alias (same behavior as lint)
	pnpm lint:fix

prettier: ## Prettier check across the workspace
	pnpm prettier

type-check: ## Run TypeScript type-check across all packages
	pnpm type-check

# ---------- tests ----------

test: ## Run unit tests (vitest), same as CI
	pnpm test

test-mcp: ## MCP agent-bridge exit test — needs vault on :1646, Agent mode ON, KEEPKEY_API_KEY
	node scripts/test-mcp-bridge.mjs

test-mcp-browser: ## Browser-driving tools exit test — same prereqs; opens/closes one tab
	node scripts/test-browser-tools.mjs

e2e: ## End-to-end tests (Chrome) — needs a connected KeepKey
	pnpm e2e

e2e-firefox: ## End-to-end tests (Firefox)
	pnpm e2e:firefox

# ---------- release ----------

bump: ## Bump version across every package.json. Usage: make bump VERSION=0.0.27
	@if [ -z "$(VERSION)" ]; then \
	  echo "usage: make bump VERSION=<x.y.z>"; exit 1; \
	fi
	./update_version.sh $(VERSION)
