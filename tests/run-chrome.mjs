import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { serve } from '../scripts/serve.mjs';

const binary = process.env.CHROME_PATH ?? [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find(existsSync);
if (!binary) throw new Error('请设置 CHROME_PATH 指向 Chrome 或 Chromium。');

const profile = await mkdtemp(join(tmpdir(), 'shopping-test-chrome-'));
const upgradeMode = process.argv.includes('--upgrade');
const recipeMode = process.argv.includes('--recipe') || upgradeMode;
let upgraded = !upgradeMode;
const root = recipeMode ? fileURLToPath(new URL('../../交接包/Codex完整交接包', import.meta.url)) :
  fileURLToPath(new URL('../dist', import.meta.url));
const testDirectory = recipeMode ? resolve(root, 'tests') : fileURLToPath(new URL('./', import.meta.url));
const { server, url } = await serve({ port: 0, root, testFiles: true, testDirectory,
  siteRoot: recipeMode ? () => resolve(root, upgraded ? 'app' : 'work/baseline-v10') : undefined });
const chrome = spawn(binary, [
  '--headless=new', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--user-data-dir=' + profile, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], windowsHide: true });

const responses = new Map();
let sequence = 0;
let buffer = '';
let diagnostics = '';
chrome.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-3000); });
chrome.stdio[3].on('error', () => {});
chrome.stdio[4].setEncoding('utf8');
chrome.stdio[4].on('data', chunk => {
  buffer += chunk;
  for (let offset = buffer.indexOf('\0'); offset >= 0; offset = buffer.indexOf('\0')) {
    const reply = JSON.parse(buffer.slice(0, offset));
    buffer = buffer.slice(offset + 1);
    if (!responses.has(reply.id)) continue;
    const { resolve, reject, timer } = responses.get(reply.id);
    responses.delete(reply.id);
    clearTimeout(timer);
    if (reply.error) reject(new Error(reply.error.message));
    else resolve(reply.result);
  }
});

function stopRequests(error) {
  for (const request of responses.values()) {
    clearTimeout(request.timer);
    request.reject(error);
  }
  responses.clear();
}

chrome.on('error', stopRequests);
chrome.on('exit', code => stopRequests(new Error('Chromium 已退出（' + code + '）。' + diagnostics)));

function cdp(method, params, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      responses.delete(id);
      reject(new Error('Chromium 响应超时：' + method + '\n' + diagnostics));
    }, 12000);
    responses.set(id, { resolve, reject, timer });
    chrome.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
  });
}

async function run(label, viewport) {
  upgraded = !upgradeMode;
  const { browserContextId } = await cdp('Target.createBrowserContext');
  try {
    const { targetId } = await cdp('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
    await cdp('Emulation.setDeviceMetricsOverride', viewport, sessionId);
    if (viewport.mobile) await cdp('Emulation.setTouchEmulationEnabled', { enabled: true }, sessionId);
    const navigation = await cdp('Page.navigate', { url: url + 'tests/' +
      (upgradeMode ? 'shopping-upgrade.html' : recipeMode ? 'shopping-browser.html' : 'browser.html') }, sessionId);
    if (navigation.errorText) throw new Error(navigation.errorText);
    const until = Date.now() + (recipeMode ? 120000 : 40000);
    while (Date.now() < until) {
      const evaluated = await cdp('Runtime.evaluate', {
        expression: 'JSON.stringify(document.querySelector("#result") && [document.querySelector("#result").dataset.state, document.querySelector("#result").textContent])',
        returnByValue: true,
      }, sessionId);
      const outcome = JSON.parse(evaluated.result.value ?? 'null');
      if (outcome?.[0] === 'upgrade') {
        upgraded = true;
        await cdp('Runtime.evaluate', {expression: "window.postMessage('shopping-test-upgrade', location.origin)"}, sessionId);
      }
      if (outcome?.[0] === 'offline') {
        await cdp('Network.enable', {}, sessionId);
        await cdp('Network.emulateNetworkConditions',
          {offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0}, sessionId);
        await cdp('Runtime.evaluate', {expression: "window.postMessage('shopping-test-offline', location.origin)"}, sessionId);
      }
      if (outcome?.[0] === 'fail') throw new Error(label + '\n' + outcome[1]);
      if (outcome?.[0] === 'pass') {
        console.log(label + '\n' + outcome[1]);
        return;
      }
      await pause(100);
    }
    throw new Error(label + ' 浏览器测试超时。');
  } finally {
    await cdp('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
  }
}

try {
  await run('桌面 Chromium', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await run('Chromium 移动视口', { width: 393, height: 852, deviceScaleFactor: 2, mobile: true });
} finally {
  chrome.kill();
  server.close();
}
