import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiVersions, scanPackage, parseGoParams } from './go-lib.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const goDir = join(repoRoot, 'data', 'go');
const sources = JSON.parse(readFileSync(join(goDir, 'sources.json'), 'utf8'));
const [sourceId, source] = Object.entries(sources)[0];
const root =
  process.env[`QUERYC_SOURCE_${sourceId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`] || join(repoRoot, source.root);

const args = process.argv.slice(2);
const write = args.includes('--write');
const packages = args.filter((a) => !a.startsWith('--'));
const versions = apiVersions(root);

function summaryOf(doc) {
  const para = doc
    .split(/\n\s*\n/)[0]
    .replace(/\s+/g, ' ')
    .trim();
  return para;
}

for (const pkg of packages) {
  const found = scanPackage(root, pkg);
  const functions = [...found.values()]
    .filter((f) => versions.has(`${pkg}.${f.name}`) && f.doc.trim())
    .sort((a, b) => Number(a.name > b.name) - Number(a.name < b.name))
    .map((f) => {
      const api = versions.get(`${pkg}.${f.name}`);
      return {
        name: f.name,
        summary: summaryOf(f.doc),
        signature: f.signature,
        params: parseGoParams(f.params).map((p) => ({ name: p.name, type: p.type })),
        returns: { type: f.returns },
        versions: [api.version],
        evidence: [
          { source: sourceId, file: f.file, line: f.line, lines: [f.text] },
          { source: sourceId, file: api.file, line: api.line, lines: [api.text] },
        ],
      };
    });
  for (const f of functions)
    console.log(`${pkg}.${f.name} ${f.versions[0]} ${f.evidence[0].file}:${f.evidence[0].line}`);
  const missing = [...versions.keys()].filter((k) => k.startsWith(`${pkg}.`) && !found.has(k.slice(pkg.length + 1)));
  if (missing.length) console.log(`missing from source: ${missing.join(', ')}`);
  if (write) {
    mkdirSync(goDir, { recursive: true });
    writeFileSync(
      join(goDir, `${pkg.replaceAll('/', '-')}.json`),
      `${JSON.stringify({ package: pkg, functions }, null, 2)}\n`,
    );
  }
}
