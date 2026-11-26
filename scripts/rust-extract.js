import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanModule, parseSignature, summaryOf } from './rust-lib.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rustDir = join(repoRoot, 'data', 'rust');
const sources = JSON.parse(readFileSync(join(rustDir, 'sources.json'), 'utf8'));
const [sourceId, source] = Object.entries(sources)[0];
const root =
  process.env[`QUERYC_SOURCE_${sourceId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`] || join(repoRoot, source.root);

const args = process.argv.slice(2);
const write = args.includes('--write');

for (const module of args.filter((a) => !a.startsWith('--'))) {
  const functions = [...scanModule(root, 'core', module).values()]
    .filter((f) => f.stable && !f.deprecated && !f.unstable)
    .sort((a, b) => Number(a.name > b.name) - Number(a.name < b.name))
    .map((f) => {
      const parsed = parseSignature(f.signature);
      return {
        name: f.name,
        summary: summaryOf(f.doc),
        signature: f.signature,
        params: parsed.params,
        returns: { type: parsed.returns },
        versions: [`Rust ${f.stable.version.replace(/\.0$/, '')}`],
        evidence: [
          { source: sourceId, file: f.file, line: f.line, lines: f.lines },
          { source: sourceId, file: f.file, line: f.stable.line, lines: [f.stable.text] },
        ],
      };
    });
  for (const f of functions) console.log(`${module}::${f.name} ${f.versions[0]} ${f.signature}`);
  if (write) {
    mkdirSync(rustDir, { recursive: true });
    writeFileSync(join(rustDir, `${module}.json`), `${JSON.stringify({ module, functions }, null, 2)}\n`);
  }
}
