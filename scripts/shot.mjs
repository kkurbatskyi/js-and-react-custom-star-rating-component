#!/usr/bin/env node
/**
 * shot.mjs — the team's eyes: render a page in headless Chromium (SwiftShader WebGL2) and save a PNG.
 *
 *   node scripts/shot.mjs <url> <out.png> [options]
 *
 *   --size=WxH       viewport in CSS px            (default 960x540; --mobile: 390x844)
 *   --dpr=N          device scale factor           (default 1)
 *   --mobile         phone emulation: isMobile + hasTouch, 390x844 unless --size is given
 *   --wait=MS        extra delay after ready        (default 300)
 *   --timeout=MS     max wait for window.__READY__  (default 120000)
 *   --eval=JS        expression evaluated after ready (awaited; result printed as JSON)
 *   --fullpage       capture the full scrollable page
 *
 * Waits until `window.__READY__ === true` (set by dev/harness.ts and the app), then --eval, then
 * --wait, then shoots. If the page never becomes ready it warns and shoots anyway. Console
 * errors/warnings, page errors and failed requests are printed (deduplicated). Exits 1 only when
 * navigation fails.
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const USAGE =
  'usage: node scripts/shot.mjs <url> <out.png> [--size=960x540] [--dpr=1] [--mobile] ' +
  '[--wait=300] [--timeout=120000] [--eval=<js>] [--fullpage]';

/** @returns {{ url: string, out: string, flags: Map<string, string | true> }} */
function parseArgs(argv) {
  const positional = [];
  const flags = new Map();
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq === -1) flags.set(arg.slice(2), true);
      else flags.set(arg.slice(2, eq), arg.slice(eq + 1));
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 2 || flags.has('help')) {
    console.error(USAGE);
    process.exit(2);
  }
  return { url: positional[0], out: resolve(positional[1]), flags };
}

function numberFlag(flags, name, fallback) {
  const raw = flags.get(name);
  if (raw === undefined || raw === true) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`shot: --${name} must be a non-negative number (got "${raw}")`);
    process.exit(2);
  }
  return n;
}

function sizeFlag(flags, fallback) {
  const raw = flags.get('size');
  if (raw === undefined || raw === true) return fallback;
  const m = /^(\d+)x(\d+)$/.exec(raw);
  if (!m) {
    console.error(`shot: --size must look like 960x540 (got "${raw}")`);
    process.exit(2);
  }
  return { width: Number(m[1]), height: Number(m[2]) };
}

const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

/** Deduplicating log collector: message → count, in first-seen order. */
class Log {
  entries = new Map();
  add(line) {
    this.entries.set(line, (this.entries.get(line) ?? 0) + 1);
  }
  print(title) {
    if (this.entries.size === 0) return;
    console.log(`${title} (${this.entries.size} unique):`);
    for (const [line, count] of this.entries) {
      console.log(`  ${line}${count > 1 ? `  (x${count})` : ''}`);
    }
  }
}

async function main() {
  const t0 = performance.now();
  const { url, out, flags } = parseArgs(process.argv.slice(2));
  const mobile = flags.has('mobile');
  const viewport = sizeFlag(
    flags,
    mobile ? { width: 390, height: 844 } : { width: 960, height: 540 },
  );
  const dpr = numberFlag(flags, 'dpr', 1);
  const waitMs = numberFlag(flags, 'wait', 300);
  const timeoutMs = numberFlag(flags, 'timeout', 120_000);
  const evalJs = typeof flags.get('eval') === 'string' ? flags.get('eval') : null;
  const fullPage = flags.has('fullpage');

  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--enable-webgl',
    ],
  });

  const console_ = new Log();
  const pageErrors = new Log();
  const network = new Log();

  try {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: dpr,
      isMobile: mobile,
      hasTouch: mobile,
    });
    const page = await context.newPage();
    page.on('console', (msg) => {
      const type = msg.type();
      // SwiftShader/ANGLE performance hints ("GPU stall due to ReadPixels") are noise, not bugs.
      if (type === 'warning' && msg.text().includes('GL Driver Message (OpenGL, Performance'))
        return;
      if (type === 'error' || type === 'warning') {
        const loc = msg.location();
        const where = loc.url
          ? ` (${loc.url.replace(/^https?:\/\/[^/]+/, '')}:${loc.lineNumber})`
          : '';
        console_.add(`[${type}] ${msg.text()}${where}`);
      }
    });
    page.on('pageerror', (err) =>
      pageErrors.add(err.stack?.split('\n').slice(0, 3).join(' | ') ?? String(err)),
    );
    page.on('requestfailed', (req) => {
      // ERR_ABORTED is a cancelled fetch (navigation, deduplicated module request): not a failure.
      if (req.failure()?.errorText === 'net::ERR_ABORTED') return;
      network.add(`FAILED ${req.url()} — ${req.failure()?.errorText ?? 'unknown error'}`);
    });
    page.on('response', (res) => {
      if (res.status() >= 400) network.add(`HTTP ${res.status()} ${res.url()}`);
    });

    console.log(
      `shot: ${url} → ${out} (${viewport.width}x${viewport.height} @${dpr}x${mobile ? ', mobile' : ''})`,
    );

    let response;
    try {
      response = await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
    } catch (err) {
      console.error(`shot: navigation failed: ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
      return;
    }
    if (response && !response.ok()) {
      console.error(`shot: navigation failed: HTTP ${response.status()} for ${url}`);
      process.exitCode = 1;
      return;
    }

    const readyStart = performance.now();
    const remaining = Math.max(1000, timeoutMs - (readyStart - t0));
    try {
      await page.waitForFunction(() => window.__READY__ === true, null, {
        timeout: remaining,
        polling: 100,
      });
      console.log(`ready after ${seconds(performance.now() - t0)}`);
    } catch {
      console.warn(
        `shot: WARNING window.__READY__ not true after ${seconds(remaining)} — shooting anyway`,
      );
    }

    if (evalJs !== null) {
      try {
        const result = await page.evaluate(evalJs);
        if (result !== undefined) console.log(`eval → ${JSON.stringify(result, null, 2)}`);
      } catch (err) {
        console.warn(`shot: --eval threw: ${err instanceof Error ? err.message : err}`);
      }
    }

    if (waitMs > 0) await page.waitForTimeout(waitMs);

    mkdirSync(dirname(out), { recursive: true });
    await page.screenshot({ path: out, fullPage, timeout: Math.max(30_000, timeoutMs) });
    console.log(`saved ${out}`);
  } finally {
    console_.print('console');
    pageErrors.print('page errors');
    network.print('network');
    await browser.close();
    console.log(`done in ${seconds(performance.now() - t0)}`);
  }
}

main().catch((err) => {
  console.error('shot: fatal:', err);
  process.exit(1);
});
