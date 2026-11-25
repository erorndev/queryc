import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sources = JSON.parse(readFileSync(join(repoRoot, 'data', 'sources.json'), 'utf8'));
const force = process.argv.includes('--force');

function sourceRoot(id, source) {
  const override = process.env[`QUERYC_SOURCE_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`];
  const root = override || source.root;
  return isAbsolute(root) ? root : join(repoRoot, root);
}

async function download(url, path) {
  const response = await fetch(url, { headers: { 'User-Agent': 'QueryC-fetch-sources' } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
}

let failed = 0;
for (const [id, source] of Object.entries(sources)) {
  if (source.kind !== 'standard') continue;
  const root = sourceRoot(id, source);
  const target = join(root, source.file);
  if (existsSync(target) && !force) {
    console.log(`${id}: ${source.file} already present`);
    continue;
  }
  mkdirSync(root, { recursive: true });
  try {
    if (source.url.endsWith('.pdf')) {
      const pdf = target.replace(/\.txt$/, '.pdf');
      if (!existsSync(pdf) || force) {
        console.log(`${id}: downloading ${source.url}`);
        await download(source.url, pdf);
      }
      const result = spawnSync('pdftotext', ['-layout', pdf, target], { encoding: 'utf8' });
      if (result.error) throw new Error('pdftotext not found; install poppler-utils or Git for Windows');
      if (result.status !== 0) throw new Error(`pdftotext failed: ${result.stderr.trim()}`);
    } else {
      console.log(`${id}: downloading ${source.url}`);
      await download(source.url, target);
    }
    console.log(`${id}: wrote ${source.file}`);
  } catch (e) {
    failed += 1;
    console.error(`${id}: ${e.message}`);
  }
}

process.exit(failed ? 1 : 0);
