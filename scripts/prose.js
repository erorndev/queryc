import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith('--'));
const [header, prosePath] = positional;
const force = argv.includes('--force');
const todo = argv.includes('--todo');
const template = argv.includes('--template');

if (!header || (!todo && !prosePath)) {
  console.error('usage: bun scripts/prose.js <header> <prose.json> [--force]');
  console.error('       bun scripts/prose.js <header> --todo');
  console.error('       bun scripts/prose.js <header> <prose.json> --template');
  process.exit(2);
}

const docPath = join(repoRoot, 'data', 'functions', `${header}.json`);
if (!existsSync(docPath)) {
  console.error(`${docPath} doesn't exist. Run bun scripts/extract.js ${header} --write first.`);
  process.exit(1);
}
const doc = JSON.parse(readFileSync(docPath, 'utf8'));
const blank = (value) => typeof value !== 'string' || !value.trim();

function missing(fn) {
  const fields = [];
  if (blank(fn.summary)) fields.push('summary');
  fn.params.forEach((p, i) => blank(p.description) && fields.push(`params[${i}] (${p.name})`));
  if (blank(fn.returns?.description)) fields.push('returns');
  if (blank(fn.example)) fields.push('example');
  return fields;
}

if (todo) {
  const pending = doc.functions.map((fn) => [fn.name, missing(fn)]).filter(([, fields]) => fields.length);
  for (const [name, fields] of pending) console.log(`${name}: ${fields.join(', ')}`);
  console.log(`${pending.length} of ${doc.functions.length} functions need prose`);
  process.exit(0);
}

if (template) {
  if (existsSync(prosePath) && !force) {
    console.error(`${prosePath} already exists. Pass --force to replace it.`);
    process.exit(1);
  }
  const skeleton = {};
  for (const fn of doc.functions) {
    if (!missing(fn).length) continue;
    skeleton[fn.name] = {
      summary: fn.summary,
      params: fn.params.map((p) => p.description),
      returns: fn.returns.description,
      example: fn.example,
    };
  }
  writeFileSync(prosePath, `${JSON.stringify(skeleton, null, 2)}\n`);
  console.log(`wrote ${Object.keys(skeleton).length} functions to ${prosePath}`);
  process.exit(0);
}

const prose = JSON.parse(readFileSync(prosePath, 'utf8'));
const byName = new Map(doc.functions.map((fn) => [fn.name, fn]));
const errors = [];
let filled = 0;

function apply(where, current, next, set) {
  if (blank(next)) return;
  if (blank(current) || force) {
    if (current !== next) {
      set(next);
      filled += 1;
    }
  } else if (current !== next) {
    errors.push(`${where} already has different prose. Pass --force to replace it.`);
  }
}

for (const [name, entry] of Object.entries(prose)) {
  const fn = byName.get(name);
  if (!fn) {
    errors.push(`${name}: not in ${header}`);
    continue;
  }
  if (entry.params && entry.params.length !== fn.params.length) {
    errors.push(`${name}: has ${fn.params.length} params, prose gives ${entry.params.length}`);
    continue;
  }
  apply(`${name} summary`, fn.summary, entry.summary, (v) => (fn.summary = v));
  (entry.params || []).forEach((text, i) => {
    const param = fn.params[i];
    apply(`${name} param ${param.name}`, param.description, text, (v) => (param.description = v));
  });
  apply(`${name} returns`, fn.returns.description, entry.returns, (v) => (fn.returns.description = v));
  apply(`${name} example`, fn.example, entry.example, (v) => (fn.example = v));
}

if (errors.length) {
  for (const e of errors) console.error(e);
  console.error(`${errors.length} ${errors.length === 1 ? 'error' : 'errors'}, nothing written`);
  process.exit(1);
}

writeFileSync(docPath, `${JSON.stringify(doc, null, 2)}\n`);
const left = doc.functions.filter((fn) => missing(fn).length).length;
console.log(`filled ${filled} fields in ${docPath}; ${left} functions still need prose`);
