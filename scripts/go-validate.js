import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { apiVersions, scanPackage, parseGoParams } from './go-lib.js';

const normalize = (text) => text.replace(/\s+/g, ' ').trim();

export function validateGo({ root, error, warn }) {
  const dir = join(root, 'data', 'go');
  const ctx = { checked: 0, count: 0 };
  if (!existsSync(dir)) return ctx;
  const sources = JSON.parse(readFileSync(join(dir, 'sources.json'), 'utf8'));
  const [sourceId, source] = Object.entries(sources)[0];
  const envName = `QUERYC_SOURCE_${sourceId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  const srcRoot = process.env[envName] || join(root, source.root);
  const present = existsSync(join(srcRoot, 'api'));
  if (!present) warn(`${source.root} is missing; Go evidence not checked`);
  const versions = present ? apiVersions(srcRoot) : new Map();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'sources.json')) {
    const data = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    const scanned = present ? scanPackage(srcRoot, data.package) : new Map();
    for (const fn of data.functions) {
      const at = `data/go/${file} ${fn.name}`;
      ctx.count += 1;
      if (!fn.summary?.trim() || !fn.signature || !fn.returns)
        error(at, 'summary, signature, and returns are required');
      if (!Array.isArray(fn.evidence) || fn.evidence.length !== 2)
        error(at, 'evidence needs the func line and the api line');
      if (!present) continue;
      for (const ev of fn.evidence || []) {
        const path = join(srcRoot, ev.file);
        const lines = existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/) : [];
        const actual = lines.slice(ev.line - 1, ev.line - 1 + ev.lines.length).map(normalize);
        if (actual.join('\n') !== ev.lines.map(normalize).join('\n')) error(at, `${ev.file}:${ev.line} doesn't match`);
        ctx.checked += 1;
      }
      const decl = scanned.get(fn.name);
      if (!decl) {
        error(at, `no func ${fn.name} in src/${data.package}`);
        continue;
      }
      if (decl.signature !== fn.signature) error(at, `signature should be ${decl.signature}`);
      if (normalize(decl.doc.split(/\n\s*\n/)[0]) !== normalize(fn.summary))
        error(at, "summary doesn't match the doc comment");
      const params = parseGoParams(decl.params);
      if (
        JSON.stringify(params.map((p) => [p.name, p.type])) !== JSON.stringify(fn.params.map((p) => [p.name, p.type]))
      ) {
        error(at, 'params differ from the declaration');
      }
      const api = versions.get(`${data.package}.${fn.name}`);
      if (!api || api.version !== fn.versions?.[0]) error(at, `versions should be ${api?.version}`);
    }
  }
  return ctx;
}
