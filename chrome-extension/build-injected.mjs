#!/usr/bin/env node

import * as esbuild from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isDev = process.env.NODE_ENV === 'development';

async function build() {
  try {
    await esbuild.build({
      entryPoints: [resolve(__dirname, 'src/injected/injected.ts')],
      bundle: true,
      outfile: resolve(__dirname, 'public/injected.js'),
      format: 'iife',
      platform: 'browser',
      target: ['chrome90', 'firefox90'],
      minify: !isDev,
      sourcemap: isDev ? 'inline' : false,
      define: {
        'process.env.NODE_ENV': JSON.stringify(isDev ? 'development' : 'production'),
      },
      logLevel: 'info',
    });
    
    console.log('✅ Injected script built successfully');
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

build();