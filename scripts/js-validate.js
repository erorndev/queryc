import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { libVersion, parseParams, VERSIONS, declText, parseDecl } from './js-lib.js';

const normalize = (text) => text.replace(/\s+/g, ' ').trim();

function checkFunction(at, fn, object, sources, root, ctx) {
  for (const field of ['summary', 'signature']) {
    if (typeof fn[field] !== 'string' || !fn[field].trim()) ctx.error(at, `${field} is required`);
  }
  if (!fn.returns?.type) ctx.error(at, 'returns needs a type');
  if (!Array.isArray(fn.versions) || fn.versions.length !== 1 || !VERSIONS.includes(fn.versions[0])) {
    ctx.error(at, `versions must hold one of ${VERSIONS.join(', ')}`);
  }
  if (!Array.isArray(fn.evidence) || !fn.evidence.length) {
    ctx.error(at, 'evidence is required');
    return;
  }
  for (const ev of fn.evidence) {
    const source = sources[ev.source];
    if (!source) {
      ctx.error(at, `unknown source "${ev.source}"`);
      continue;
    }
    const path = join(root, source.root, ev.file);
    if (!existsSync(path)) {
      ctx.error(at, `${source.root}/${ev.file} is missing; run bun install`);
      continue;
    }
    const lines = readFileSync(path, 'utf8').split(/\r?\n/);
    const actual = lines.slice(ev.line - 1, ev.line - 1 + ev.lines.length).map(normalize);
    if (actual.join('\n') !== ev.lines.map(normalize).join('\n')) {
      ctx.error(at, `${ev.file}:${ev.line} doesn't match the cited lines`);
    }
    ctx.checked += 1;
  }
  const first = fn.evidence[0];
  if (libVersion(first.file) !== fn.versions?.[0]) {
    ctx.error(at, `versions says ${fn.versions?.[0]} but ${first.file} gives ${libVersion(first.file)}`);
  }
  const declaration = declText(first.lines);
  if (fn.signature !== `${object}.${declaration}`) ctx.error(at, `signature must be "${object}.${declaration}"`);
  const parsed = parseDecl(declaration);
  const expected = parsed ? parseParams(parsed.paramText) : [];
  const params = fn.params || [];
  if (params.length !== expected.length)
    ctx.error(at, `params has ${params.length} entries, declaration has ${expected.length}`);
  expected.forEach((p, i) => {
    const got = params[i];
    if (!got || got.name !== p.name || got.type !== p.type || Boolean(got.optional) !== p.optional) {
      ctx.error(at, `param ${i + 1} must be ${p.name}${p.optional ? '?' : ''}: ${p.type}`);
    } else if (!got.description) ctx.error(at, `param ${p.name} needs a description`);
  });
  if (ctx.runExamples && fn.example) {
    const file = join(ctx.workDir, 'example.js');
    writeFileSync(file, fn.example);
    const run = spawnSync(process.execPath, [file], { encoding: 'utf8' });
    if (run.status !== 0) ctx.error(at, `example fails: ${(run.stderr || '').trim().split('\n')[0]}`);
    else ctx.ran += 1;
  }
}

export function validateJs({ root, workDir, runExamples, error }) {
  const dir = join(root, 'data', 'js');
  const ctx = { error, workDir, runExamples, checked: 0, ran: 0, count: 0 };
  if (!existsSync(dir)) return ctx;
  const sources = JSON.parse(readFileSync(join(dir, 'sources.json'), 'utf8'));
  for (const [id, source] of Object.entries(sources)) {
    if (source.kind !== 'lib' || !source.label || !source.root || !source.library || !source.version) {
      error(`data/js/sources.json ${id}`, 'lib sources need kind "lib", label, root, library, and version');
    }
  }
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'sources.json')
    .sort();
  for (const file of files) {
    const where = `data/js/${file}`;
    const doc = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    const object = file.replace(/\.json$/, '');
    if (doc.object !== object) error(where, `object is "${doc.object}" but the file name says "${object}"`);
    const names = doc.functions.map((f) => f.name);
    if (names.join() !== [...names].sort().join()) error(where, 'functions must be sorted by name');
    for (const fn of doc.functions) {
      ctx.count += 1;
      checkFunction(`${where} ${fn.name}`, fn, object, sources, root, ctx);
    }
  }
  return ctx;
}
