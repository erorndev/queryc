import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanLib, parseParams } from './js-lib.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const jsDir = join(repoRoot, 'data', 'js');
const sources = JSON.parse(readFileSync(join(jsDir, 'sources.json'), 'utf8'));
const [sourceId, source] = Object.entries(sources)[0];
const libRoot = join(repoRoot, source.root);

const args = process.argv.slice(2);
const write = args.includes('--write');
const notesAt = args.indexOf('--notes');
const objects = args.filter((a, i) => !a.startsWith('--') && (notesAt < 0 || i !== notesAt + 1));

function readDoc(doc) {
  const text = doc
    .split('\n')
    .map((l) =>
      l
        .replace(/^\s*\/?\*+\/?\s?/, '')
        .replace(/\*\/$/, '')
        .trim(),
    )
    .join(' ');
  const [lead, ...tags] = text.split(/\s(?=@\w)/);
  const params = {};
  let returns = '';
  for (const tag of tags) {
    const param = /^@param\s+(\w+)\s*(.*)$/.exec(tag);
    if (param) params[param[1]] = param[2].trim();
    const ret = /^@returns?\s+(.*)$/.exec(tag);
    if (ret) returns = ret[1].trim();
  }
  return { summary: lead.trim(), params, returns };
}

const found = scanLib(libRoot, objects);
const notes = [];

for (const object of objects) {
  const path = join(jsDir, `${object}.json`);
  const existing = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { object, functions: [] };
  const old = new Map(existing.functions.map((f) => [f.name, f]));
  const functions = [...found.values()]
    .filter((f) => f.object === object)
    .sort((a, b) => Number(a.name > b.name) - Number(a.name < b.name))
    .map((f) => {
      const first = f.declarations[0];
      const prev = old.get(f.name) || {};
      const doc = readDoc(first.doc);
      const params = parseParams(first.paramText).map((p, i) => ({
        ...p,
        description: prev.params?.[i]?.name === p.name ? prev.params[i].description : doc.params[p.name] || '',
      }));
      notes.push(
        `## ${object}.${f.name} (${f.version})\n\n${f.declarations.map((d) => `${d.doc}\n${d.lines.join(' ')}`).join('\n\n')}\n`,
      );
      console.log(`${object}.${f.name} ${f.version} ${first.file}:${first.line}`);
      return {
        name: f.name,
        summary: prev.summary || doc.summary,
        signature: `${object}.${first.text}`,
        params,
        returns: { type: first.returnType, description: prev.returns?.description || doc.returns },
        example: prev.example || '',
        versions: [f.version],
        evidence: f.declarations.map((d) => ({ source: sourceId, file: d.file, line: d.line, lines: d.lines })),
      };
    });
  if (write) {
    mkdirSync(jsDir, { recursive: true });
    writeFileSync(path, `${JSON.stringify({ object, functions }, null, 2)}\n`);
  }
}

if (notesAt >= 0) writeFileSync(args[notesAt + 1], notes.join('\n'));
