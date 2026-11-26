import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { scanModule, parseSignature, summaryOf } from './rust-lib.js';

const normalize = (text) => text.replace(/\s+/g, ' ').trim();

export function validateRust({ root, error, warn }) {
  const dir = join(root, 'data', 'rust');
  const ctx = { checked: 0, count: 0 };
  if (!existsSync(dir)) return ctx;
  const sources = JSON.parse(readFileSync(join(dir, 'sources.json'), 'utf8'));
  const [sourceId, source] = Object.entries(sources)[0];
  const envName = `QUERYC_SOURCE_${sourceId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  const srcRoot = process.env[envName] || join(root, source.root);
  const present = existsSync(join(srcRoot, 'library'));
  if (!present) warn(`${source.root} is missing; Rust evidence not checked`);
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'sources.json')) {
    const data = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    const scanned = present ? scanModule(srcRoot, 'core', data.module) : new Map();
    for (const fn of data.functions) {
      const at = `data/rust/${file} ${fn.name}`;
      ctx.count += 1;
      if (!fn.summary?.trim() || !fn.signature || !fn.returns)
        error(at, 'summary, signature, and returns are required');
      if (!Array.isArray(fn.evidence) || fn.evidence.length !== 2)
        error(at, 'evidence needs the fn lines and the stable attribute');
      if (!present) continue;
      for (const ev of fn.evidence || []) {
        const path = join(srcRoot, ev.file);
        const lines = existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/) : [];
        const actual = lines.slice(ev.line - 1, ev.line - 1 + ev.lines.length).map(normalize);
        if (actual.join('\n') !== ev.lines.map(normalize).join('\n')) error(at, `${ev.file}:${ev.line} doesn't match`);
        ctx.checked += 1;
      }
      const decl = scanned.get(fn.name);
      if (!decl || !decl.stable || decl.deprecated || decl.unstable) {
        error(at, `no stable fn ${fn.name} in core::${data.module}`);
        continue;
      }
      if (decl.signature !== fn.signature) error(at, `signature should be ${decl.signature}`);
      if (normalize(summaryOf(decl.doc)) !== normalize(fn.summary)) error(at, "summary doesn't match the doc comment");
      const parsed = parseSignature(decl.signature);
      if (JSON.stringify(parsed.params) !== JSON.stringify(fn.params.map((p) => ({ name: p.name, type: p.type }))))
        error(at, 'params differ from the declaration');
      if (parsed.returns !== fn.returns.type) error(at, `returns should be ${parsed.returns}`);
      const version = `Rust ${decl.stable.version.replace(/\.0$/, '')}`;
      if (fn.versions?.[0] !== version) error(at, `versions should be ${version}`);
    }
  }
  return ctx;
}
