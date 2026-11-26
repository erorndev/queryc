import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const FN = /^pub (?:const )?(?:unsafe )?fn (\w+)/;
const STABLE = /#\[stable\(feature = "[^"]+", since = "([\d.]+)"\)\]/;

export function moduleFile(root, crate, path) {
  const base = ['library', crate, 'src', ...path.split('::')].join('/');
  for (const rel of [`${base}/mod.rs`, `${base}.rs`]) if (existsSync(join(root, rel))) return rel;
  return null;
}

function splitTop(text) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if ('([{<'.includes(ch)) depth += 1;
    if (')]}>'.includes(ch) && !(ch === '>' && cur.endsWith('-'))) depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

export function parseSignature(signature) {
  const name = FN.exec(signature)[1];
  let i = signature.indexOf(name) + name.length;
  if (signature[i] === '<') {
    let depth = 0;
    for (; i < signature.length; i += 1) {
      if (signature[i] === '<') depth += 1;
      if (signature[i] === '>') depth -= 1;
      if (depth === 0) break;
    }
    i += 1;
  }
  let depth = 0;
  let end = i;
  for (; end < signature.length; end += 1) {
    if (signature[end] === '(') depth += 1;
    if (signature[end] === ')') depth -= 1;
    if (depth === 0) break;
  }
  const params = splitTop(signature.slice(i + 1, end)).map((p) => {
    const at = p.indexOf(':');
    return { name: p.slice(0, at).trim(), type: p.slice(at + 1).trim() };
  });
  const ret = /^\s*->\s*(.+?)(?:\s+where\b.*)?$/.exec(signature.slice(end + 1));
  return { name, params, returns: ret ? ret[1].trim() : '()' };
}

function readDecl(lines, i) {
  const sig = [];
  for (let j = i; j < lines.length; j += 1) {
    sig.push(lines[j]);
    if (/[{;]\s*$/.test(lines[j])) break;
  }
  const signature = sig
    .join(' ')
    .replace(/\s*[{;]\s*$/, '')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/,?\s+\)/g, ')')
    .trim()
    .replace(/,$/, '');
  let k = i - 1;
  let stable = null;
  let deprecated = false;
  let unstable = false;
  while (k >= 0 && !/^\s*\/\/\//.test(lines[k]) && /^(\s|#|\)|\/\/)/.test(lines[k])) {
    const m = STABLE.exec(lines[k]);
    if (m) stable = { line: k + 1, text: lines[k], version: m[1] };
    if (/^#\[deprecated/.test(lines[k])) deprecated = true;
    if (/^#\[unstable/.test(lines[k])) unstable = true;
    k -= 1;
  }
  const doc = [];
  for (; k >= 0 && /^\/\/\//.test(lines[k]); k -= 1) doc.unshift(lines[k].replace(/^\/\/\/ ?/, ''));
  return { signature, lines: sig, stable, deprecated, unstable, doc: doc.join('\n') };
}

export function scanModule(root, crate, path) {
  const file = moduleFile(root, crate, path);
  const found = new Map();
  if (!file) return found;
  const lines = readFileSync(join(root, file), 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    const m = FN.exec(line);
    if (m && !found.has(m[1])) found.set(m[1], { ...readDecl(lines, i), name: m[1], file, line: i + 1 });
    const use = /^pub use crate::(\w+)::(\w+);/.exec(line);
    if (use && !found.has(use[2])) {
      const other = scanModule(root, crate, use[1]).get(use[2]);
      if (other) found.set(use[2], other);
    }
  });
  return found;
}

export function summaryOf(doc) {
  return doc
    .split(/\n\s*\n/)[0]
    .replace(/\s+/g, ' ')
    .trim();
}
