import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = join(mkdtempSync(join(tmpdir(), 'keepkey-password-browser-')), 'fixture.js');
const entry = fileURLToPath(new URL('../tests/fixtures/password-secrets-entry.ts', import.meta.url));
const built = spawnSync('bun', ['build', entry, '--target=browser', '--format=iife', '--outfile', output], { stdio: 'inherit' });
if (built.status !== 0) throw new Error('Could not build browser security fixture');
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE,headless:true});
try {
 const page=await browser.newPage();
 await page.route('https://accounts.google.com/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><form><input type="password" name="current" autocomplete="current-password"><input type="password" name="new" autocomplete="new-password"><input type="password" disabled><button>Submit</button></form>'}));
 await page.goto('https://accounts.google.com/fixture');
 await page.addScriptTag({path:output});
 const results=await page.evaluate(()=>{
   const m=globalThis.__passwordSecrets;
   const asserts=[];
   function check(name,fn){fn();asserts.push(name)}
   function fails(fn){let threw=false;try{fn()}catch{threw=true}if(!threw)throw new Error('Expected rejection')}
   check('foreign origin refused',()=>fails(()=>m.passwordTargets('https://accounts.google.com.evil.invalid')));
   let target=m.passwordTargets(location.origin);
   check('disabled fields excluded',()=>{if(target.targets.length!==2)throw new Error('wrong field count')});
   const msg=()=>({origin:location.origin,documentToken:target.documentToken,ref:target.targets[0].ref,password:'SYNTHETIC-TEST-PASSWORD',expiresAt:Date.now()+30000});
   check('document swap refused',()=>fails(()=>m.fillPassword({...msg(),documentToken:'stale'})));
   check('expired fill refused',()=>fails(()=>m.fillPassword({...msg(),expiresAt:Date.now()-1})));
   document.querySelector('form').action='https://attacker.invalid/collect';
   check('foreign form action refused',()=>fails(()=>m.fillPassword(msg())));
   document.querySelector('form').action=location.href;
   target=m.passwordTargets(location.origin);
   let submits=0;document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();submits++});
   const result=m.fillPassword(msg());
   check('fills selected password only and never submits',()=>{if(!result.filled||result.submitted||submits||document.querySelector('input').value!=='SYNTHETIC-TEST-PASSWORD'||document.querySelectorAll('input')[1].value)throw new Error('unsafe fill')});
   check('one-use field reference',()=>fails(()=>m.fillPassword(msg())));
   check('redacts nested tool results',()=>{const text=JSON.stringify(m.redactPasswordResult({nodes:[{name:'Echo SYNTHETIC-TEST-PASSWORD'}]}));if(text.includes('SYNTHETIC-TEST-PASSWORD'))throw new Error('leak')});
   check('enables protected-page mode',()=>{if(!m.passwordProtected)throw new Error('not protected')});
   check('password and OTP fields classified as secret',()=>{const i=document.querySelector('input');if(!m.isSecretField(i))throw new Error('not secret');const otp=document.createElement('input');otp.autocomplete='one-time-code';if(!m.isSecretField(otp))throw new Error('OTP not secret')});
   return asserts;
 });
 assert.equal(results.length,10);
 console.log(JSON.stringify({bexBrowserSecurityChecks:results,realAccountRequests:false},null,2));
} finally {await browser.close()}
