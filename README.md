# KeepKey Client Browser Extension

<div align="center">

<picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://pioneers.dev/coins/keepkey.png" />
    <source media="(prefers-color-scheme: light)" srcset="https://pioneers.dev/coins/keepkey.png" />
    <img alt="KeepKey Logo" src="https://pioneers.dev/coins/keepkey.png" />
</picture>

![](https://img.shields.io/badge/React-61DAFB?style=flat-square&logo=react&logoColor=black)
![](https://img.shields.io/badge/Typescript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![](https://badges.aleen42.com/src/vitejs.svg)

![GitHub action badge](https://github.com/Jonghakseo/chrome-extension-boilerplate-react-vite/actions/workflows/build-zip.yml/badge.svg)
![GitHub action badge](https://github.com/Jonghakseo/chrome-extension-boilerplate-react-vite/actions/workflows/lint.yml/badge.svg)

<img src="https://hits.seeyoufarm.com/api/count/incr/badge.svg?url=https://github.com/Jonghakseo/chrome-extension-boilerplate-react-viteFactions&count_bg=%23#222222&title_bg=%23#454545&title=😀&edge_flat=true" alt="hits"/>
<a href="https://discord.gg/4ERQ6jgV9a" target="_blank"><img src="https://discord.com/api/guilds/1263404974830915637/widget.png"/></a>

</div>

## Table of Contents

- [Intro](#intro)
- [Features](#features)
- [Structure](#structure)
    - [ChromeExtension](#structure-chrome-extension)
    - [Packages](#structure-packages)
    - [Pages](#structure-pages)
- [Getting started](#getting-started)
    - [Chrome](#getting-started-chrome)
    - [Firefox](#getting-started-firefox)
- [Install dependency](#install-dependency)
    - [For root](#install-dependency-for-root)
    - [For module](#install-dependency-for-module)
- [Community](#community)
- [Reference](#reference)
- [Star History](#star-history)
- [Contributors](#contributors)

## Intro <a name="intro"></a>

This extension is designed for building browser-based applications integrated with the KeepKey hardware wallet using modern web technologies like React, Typescript, and Vite. The main goal is to provide seamless development and build processes tailored to KeepKey.

For more information, visit [KeepKey's website](https://keepkey.com) or contact the development team at [highlander@keepkey.com](mailto:highlander@keepkey.com).

## Features <a name="features"></a>

- [React18](https://reactjs.org/)
- [TypeScript](https://www.typescriptlang.org/)
- [Tailwindcss](https://tailwindcss.com/)
- [Vite](https://vitejs.dev/)
- [Turborepo](https://turbo.build/repo)
- [Prettier](https://prettier.io/)
- [ESLint](https://eslint.org/)
- [Chrome Extension Manifest Version 3](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [Custom I18n Package](/packages/i18n/)
- [Custom HMR(Hot Module Rebuild) Plugin](/packages/hmr/)
- [End to End Testing with WebdriverIO](https://webdriver.io/)

## Getting started: <a name="getting-started"></a>

1. When you're using Windows run this:
   - `git config --global core.eol lf`
   - `git config --global core.autocrlf input`
   #### This will change eol(End of line) to the same as on Linux/Mac, without this, you will have conflicts with your teammates with those systems and our bash script won't work
2. Clone this repository.
3. Change `extensionDescription` and `extensionName` in the `messages.json` file.
4. Install pnpm globally: `npm install -g pnpm` (check your node version >= 18.19.1)
5. Run `pnpm install`

### For Chrome: <a name="getting-started-chrome"></a>

1. Run:
    - Dev: `pnpm dev` (On windows, you should run as administrator.)
    - Prod: `pnpm build`
2. Open in browser - `chrome://extensions`
3. Check - `Developer mode`
4. Find and Click - `Load unpacked extension`
5. Select - `dist` folder at root

### For Firefox: <a name="getting-started-firefox"></a>

1. Run:
    - Dev: `pnpm dev:firefox`
    - Prod: `pnpm build:firefox`
2. Open in browser - `about:debugging#/runtime/this-firefox`
3. Find and Click - `Load Temporary Add-on...`
4. Select - `manifest.json` from the `dist` folder at root

<h3><i>Remember in Firefox, you add the plugin in temporary mode, meaning it will disappear after each browser close. You'll need to repeat this on every browser launch.</i></h3>

## Install dependency for Turborepo: <a name="install-dependency"></a>

### For root: <a name="install-dependency-for-root"></a>

1. Run `pnpm i <package> -w`

### For module: <a name="install-dependency-for-module"></a>

1. Run `pnpm i <package> -F <module name>`

`package` - Name of the package you want to install, e.g., `nodemon` \
`module-name` - You can find it inside each `package.json` under the key `name`, e.g., `@extension/content-script`

## Env Variables

1. Copy `.example.env` and paste it as `.env` in the same path.
2. Add a new record inside `.env`.
3. Add this key with type for value to `vite-env.d.ts` (root) in `ImportMetaEnv`.
4. Then you can use it with `import.meta.env.{YOUR_KEY}` as with standard [Vite Env](https://vitejs.dev/guide/env-and-mode).

#### If you want to set it for each package independently:

1. Create `.env` inside that package.
2. Open the related `vite.config.mts` and add `envDir: '.'` at the end of the config.
3. Follow the same steps as above.

#### Remember you can't use global and local env for the same package simultaneously (It will be overwritten).

## Structure <a name="structure"></a>

### ChromeExtension <a name="structure-chrome-extension"></a>

Main app with background script and manifest:

- `manifest.js` - manifest for the Chrome extension.
- `lib/background` - [background script](https://developer.chrome.com/docs/extensions/mv3/background_pages/) for the Chrome extension (`background.service_worker` in manifest.json).
- `public/content.css` - content CSS for page injection.

### Packages <a name="structure-packages"></a>

Some shared packages:

- `dev-utils` - utils for Chrome extension development (manifest-parser, logger).
- `i18n` - custom i18n package with type safety and validation.
- `hmr` - custom HMR plugin for Vite.
- `shared` - shared code (types, constants, custom hooks, components, etc.).
- `storage` - helpers for [Chrome storage API](https://developer.chrome.com/docs/extensions/reference/api/storage).
- `tailwind-config` - shared Tailwind config.
- `tsconfig` - shared TypeScript config.
- `ui` - components and functions for UI integration.
- `vite-config` - shared Vite config.
- `zipper` - packs the `dist` folder into `extension.zip`.
- `e2e` - End-to-end tests with WebdriverIO.

### Pages <a name="structure-pages"></a>

- `content` - [Content script](https://developer.chrome.com/docs/extensions/mv3/content_scripts/) for page interactions.
- `devtools` - [DevTools](https://developer.chrome.com/docs/extensions/mv3/devtools/) for Chrome extension.
- `new-tab` - [New tab](https://developer.chrome.com/docs/extensions/mv3/override/) for the extension.
- `options` - [Options page](https://developer.chrome.com/docs/extensions/mv3/options/).
- `popup` - [Popup page](https://developer.chrome.com/docs/extensions/reference/browserAction/) for the extension.

## Community <a name="community"></a>

Join the [KeepKey Discord](https://discord.gg/4ERQ6jgV9a) to connect with other developers and share your experiences, suggest features, or get support.

## Reference <a name="reference"></a>

- [Vite Plugin](https://vitejs.dev/guide/api-plugin.html)
- [Chrome Extension Docs](https://developer.chrome.com/docs/extensions/mv3/)
- [Rollup](https://rollupjs.org/guide/en/)
- [Turborepo](https://turbo.build/repo/docs)
- [Rollup-plugin-chrome-extension](https://www.extend-chrome.dev/rollup-plugin)

---

For more information, visit [KeepKey's website](https://keepkey.com) or reach out at [highlander@keepkey.com](mailto:highlander@keepkey.com).
