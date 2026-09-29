#!/usr/bin/env node
/**
 * make-artifact.mjs — turn the single-file build into a host *fragment*.
 *
 *   vite build --mode artifact && node scripts/make-artifact.mjs [in.html] [out.html]
 *   (defaults: dist-artifact/index.html → dist-artifact/sidereal.html)
 *
 * The artifact host wraps every page in its own `<!doctype html><html><head>…<body>` skeleton, so
 * the fragment must carry no document tags of its own. Output order:
 *   1. the <title> element (first, as the host requires),
 *   2. the remaining <head> children in their original order (meta description, font links,
 *      styles, inline scripts) — minus <meta charset>, which the host skeleton provides,
 *   3. the <body> content.
 * Fails (exit 1) if a document tag survives or the result reaches 16 MB.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LIMIT_BYTES = 16 * 1024 * 1024;
const input = resolve(process.argv[2] ?? 'dist-artifact/index.html');
const output = resolve(process.argv[3] ?? 'dist-artifact/sidereal.html');

function fail(message) {
  console.error(`make-artifact: ${message}`);
  process.exit(1);
}

let html;
try {
  html = readFileSync(input, 'utf8');
} catch (err) {
  fail(`cannot read ${input} (${err.message}) — run \`vite build --mode artifact\` first`);
}

// One leftmost-first scan drops comments and masks raw-text elements, so tag matching can never be
// fooled by their contents (an inlined bundle may well contain "</head>" in a string literal;
// vite-plugin-singlefile already escapes "</script").
const RAW_OR_COMMENT =
  /<!--[\s\S]*?-->|<(script|style|title|textarea|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const raw = [];
const masked = html.replace(RAW_OR_COMMENT, (m) => {
  if (m.startsWith('<!--')) return '';
  raw.push(m);
  return `\uE000${raw.length - 1}\uE001`;
});
const unmask = (s) => s.replace(/\uE000(\d+)\uE001/g, (_, i) => raw[Number(i)]);

const head = /<head\b[^>]*>([\s\S]*?)<\/head\s*>/i.exec(masked)?.[1];
const body = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(masked)?.[1];
if (head === undefined || body === undefined) fail(`${input} has no <head> or <body>`);

// Top-level head children: masked raw elements and (void) tags, in document order.
const children = head.match(/\uE000\d+\uE001|<[a-z](?:[^>"']|"[^"]*"|'[^']*')*>/gi) ?? [];
const isTitle = (node) => /^<title\b/i.test(unmask(node));
const title = children.find(isTitle);
if (!title) fail(`${input} has no <title> — the host needs it first`);

const rest = children.filter((node) => node !== title && !/^<meta\s[^>]*charset/i.test(node));

const fragment = `${[title, ...rest].map(unmask).join('\n')}\n${unmask(body.trim())}\n`;

// Verify: no document-level tags outside raw text.
const check = fragment.replace(RAW_OR_COMMENT, '');
const stray = /<!doctype|<\/?html[\s>]|<\/?head[\s>]|<\/?body[\s>]/i.exec(check);
if (stray) fail(`document tag "${stray[0]}" left in the fragment`);
if (!fragment.startsWith('<title')) fail('fragment does not start with <title>');

const bytes = Buffer.byteLength(fragment, 'utf8');
writeFileSync(output, fragment);
const mb = (bytes / 1024 / 1024).toFixed(2);
console.log(`make-artifact: ${output}  ${bytes.toLocaleString('en-US')} bytes (${mb} MB of 16 MB)`);
if (bytes >= LIMIT_BYTES) fail(`fragment is ${mb} MB — the host limit is 16 MB`);
