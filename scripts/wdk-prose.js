import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docsRoot = process.env.QUERYC_SOURCE_WDK_DOCS || join(repoRoot, 'sources/wdk-docs/wdk-ddi-src/content');
const header = process.argv[2];
const write = process.argv.includes('--write');
if (!header) {
  console.error('usage: bun scripts/wdk-prose.js <wdm.h|ntddk.h> [--write]');
  process.exit(1);
}
const base = header.replace(/\.h$/, '');
const dataPath = join(repoRoot, 'data/functions', `${header}.json`);
const data = JSON.parse(readFileSync(dataPath, 'utf8'));

function clean(text) {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__/g, '')
    .replace(/\broutines\b/g, 'functions')
    .replace(/\broutine\b/g, 'function')
    .replace(/—|–/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstParagraph(body) {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith('|') && !p.startsWith('#') && !p.startsWith('```'));
  return paragraphs.length ? clean(paragraphs[0]) : '';
}

function sections(md) {
  const out = { params: new Map() };
  const parts = md.split(/^(##+ -[^\n]*)$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const title = parts[i];
    const body = parts[i + 1] || '';
    if (/^## -description/.test(title)) out.description = firstParagraph(body);
    else if (/^## -returns/.test(title)) out.returns = firstParagraph(body);
    else {
      const param = /^### -param (\S+)/.exec(title);
      if (param) out.params.set(param[1].toLowerCase(), firstParagraph(body));
    }
  }
  return out;
}

let filled = 0;
const missing = [];
for (const fn of data.functions) {
  const file = join(docsRoot, base, `nf-${base}-${fn.name.toLowerCase()}.md`);
  if (!existsSync(file)) {
    missing.push(fn.name);
    continue;
  }
  const doc = sections(readFileSync(file, 'utf8'));
  if (doc.description) fn.summary = doc.description;
  for (const p of fn.params) {
    const text = doc.params.get(p.name.toLowerCase());
    if (text) p.description = text;
  }
  if (doc.returns) fn.returns.description = doc.returns;
  fn.docs = `${base}/nf-${base}-${fn.name.toLowerCase()}.md`;
  filled += 1;
}

console.log(`${header}: ${filled} filled from docs, ${missing.length} without a docs page`);
if (missing.length) console.log(missing.join(' '));
if (write) writeFileSync(dataPath, `${JSON.stringify(data, null, 2)}\n`);
