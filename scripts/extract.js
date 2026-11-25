import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, isAbsolute, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hasClangTidy, runClangTidy } from './clang-tidy.js';

const STANDARDS = ['C89', 'C95', 'C99', 'C11', 'C17', 'C23'];
const NOT_NAMES = new Set([
  'void',
  'char',
  'short',
  'int',
  'long',
  'float',
  'double',
  'signed',
  'unsigned',
  'const',
  'volatile',
  'restrict',
  'struct',
  'union',
  'enum',
  '_Bool',
  'bool',
  '_Noreturn',
  'static',
  'extern',
  'inline',
]);
const HEADING = /^\s*(\d+(?:\.\d+)+)\s+The\s+(.+?)\s+(generic functions?|functions?)\s*$/;
const ANY_HEADING = /^\s*[A-Z]?\d+(?:\.\d+)+\s+\S/;
const SYNOPSIS = /^\s*Synopsis\s*$/;
const DESCRIPTION = /^\s*(\d+\s+)?Description\s*$/;
const RETURNS = /^\s*(\d+\s+)?Returns\s*$/;
const PAGE_NOISE =
  /(§\s*\d|working draft|Committee Draft|ISO\/IEC\s+9899|^\s*\d+\s+Library\s|Library\s+\d+\s*$|^\s*\d+\s*$|^\s*Page\s+\d+)/i;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(repoRoot, 'data');

const argv = process.argv.slice(2);
const header = argv.find((a) => !a.startsWith('--'));
const write = argv.includes('--write');
const notesIndex = argv.indexOf('--notes');
const notesPath = notesIndex !== -1 ? argv[notesIndex + 1] : null;

if (!header || !/^[a-z0-9_]+\.h$/.test(header)) {
  console.error('Usage: bun scripts/extract.js <header.h> [--write] [--notes <file>]');
  process.exit(2);
}

const normalize = (text) => text.replace(/\s+/g, ' ').trim();
const sources = JSON.parse(readFileSync(join(dataDir, 'sources.json'), 'utf8'));

function sourceRoot(id, source) {
  const override = process.env[`QUERYC_SOURCE_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`];
  const root = override || source.root;
  return isAbsolute(root) ? root : join(repoRoot, root);
}

function declName(text) {
  for (const match of text.matchAll(/([A-Za-z_]\w*)\s*\(/g)) {
    if (!NOT_NAMES.has(match[1])) return match[1];
  }
  return null;
}

function parseDraft(id, source) {
  const path = join(sourceRoot(id, source), source.file);
  if (!existsSync(path)) return new Map();
  const lines = readFileSync(path, 'latin1').split(/\r?\n/);
  const found = new Map();

  for (let i = 0; i < lines.length; i += 1) {
    const heading = lines[i].match(HEADING);
    if (!heading) continue;
    let s = i + 1;
    while (s < Math.min(lines.length, i + 20) && !SYNOPSIS.test(lines[s]) && !HEADING.test(lines[s])) s += 1;
    if (!SYNOPSIS.test(lines[s] || '')) continue;

    let end = s + 1;
    while (end < lines.length && end - s < 80 && !DESCRIPTION.test(lines[end]) && !ANY_HEADING.test(lines[end]))
      end += 1;

    const region = lines.slice(s + 1, end);
    const includes = region
      .map((l) => l.match(/#\s*include\s*<([^>]+)>/))
      .filter(Boolean)
      .map((m) => m[1]);
    if (includes.at(-1) !== header) continue;
    if (region.some((l) => /#\s*define\s+__STDC_WANT_LIB_EXT1__/.test(l))) continue;

    let current = null;
    for (let k = s + 1; k < end; k += 1) {
      const raw = lines[k];
      if (!raw.trim()) continue;
      if (/#\s*(include|define|if|ifdef|ifndef|elif|else|endif)\b/.test(raw)) continue;
      if (PAGE_NOISE.test(raw)) {
        current = null;
        continue;
      }
      if (!current) current = { line: k + 1, lines: [] };
      current.lines.push(normalize(raw));
      if (current.lines.join(' ').trim().endsWith(';')) {
        const text = normalize(current.lines.join(' '));
        const name = declName(text);
        if (name && !found.has(name)) {
          found.set(name, {
            source: id,
            file: source.file,
            heading: normalize(lines[i]),
            line: current.line,
            lines: current.lines,
            synopsis: text,
            notes: draftNotes(lines, end),
          });
        }
        current = null;
      }
    }
  }
  return found;
}

function draftNotes(lines, start) {
  const out = [];
  for (let k = start; k < Math.min(lines.length, start + 60); k += 1) {
    if (k > start && ANY_HEADING.test(lines[k]) && !DESCRIPTION.test(lines[k]) && !RETURNS.test(lines[k])) break;
    if (PAGE_NOISE.test(lines[k])) continue;
    if (lines[k].trim()) out.push(normalize(lines[k]));
  }
  return out.join(' ');
}

function topLevelObjects(text) {
  const objects = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) objects.push(JSON.parse(text.slice(start, i + 1)));
    }
  }
  return objects;
}

const pick = (loc) => {
  if (!loc?.expansionLoc) return loc;
  return { ...loc.expansionLoc, file: loc.expansionLoc.file || loc.spellingLoc?.file };
};

function headerSources() {
  return Object.entries(sources)
    .filter(([, s]) => s.kind === 'headers')
    .map(([id, s]) => ({ id, root: sourceRoot(id, s).replace(/\\/g, '/').toLowerCase() }));
}

function locateInHeaders(names, workDir) {
  const found = new Map();
  const file = join(workDir, 'probe.c');
  writeFileSync(file, `#include <${header}>\n`);
  const roots = headerSources();
  const fileCache = new Map();

  for (const name of names) {
    const result = spawnSync(
      'clang',
      ['-fsyntax-only', '-std=c23', '-Xclang', '-ast-dump=json', '-Xclang', `-ast-dump-filter=${name}`, file],
      {
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
      },
    );
    if (result.error) {
      console.error('clang not found; skipping header sources');
      return found;
    }
    const decls = topLevelObjects(result.stdout || '').filter(
      (d) => d.kind === 'FunctionDecl' && d.name === name && !d.isImplicit,
    );
    for (const decl of decls) {
      const loc = pick(decl.loc);
      const begin = pick(decl.range?.begin);
      const endLoc = pick(decl.range?.end);
      if (!loc?.file || begin?.offset === undefined) continue;
      const path = loc.file;
      const normalized = path.replace(/\\/g, '/').toLowerCase();
      const owner = roots.find((r) => normalized.startsWith(`${r.root}/`));
      if (!owner) continue;

      if (!fileCache.has(path)) fileCache.set(path, readFileSync(path, 'latin1'));
      const text = fileCache.get(path);
      let depth = 0;
      let i = text.indexOf('(', loc.offset);
      for (; i < text.length; i += 1) {
        if (text[i] === '(') depth += 1;
        else if (text[i] === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      const endOffset = Math.max(i + 1, (endLoc?.offset ?? 0) + 1);
      const lineAt = (offset) => text.slice(0, offset).split('\n').length;
      const startLine = lineAt(begin.offset);
      const endLine = lineAt(endOffset);
      const allLines = text.split(/\r?\n/);
      const lines = allLines
        .slice(startLine - 1, endLine)
        .map((l) => l.trimEnd().trim())
        .filter(Boolean);
      if (!lines.join(' ').includes(name)) continue;
      const rel = relative(sourceRoot(owner.id, sources[owner.id]), path).replace(/\\/g, '/');
      const firstNonBlank = allLines.slice(startLine - 1).findIndex((l) => l.trim()) + startLine;
      found.set(name, { source: owner.id, file: rel, line: firstNonBlank, lines });
      for (const candidate of decls) {
        const warning = msvcWarning(candidate, pick(candidate.loc)?.file || path, roots, fileCache);
        if (warning) {
          const named = warning.message.match(/Consider using (\w+) instead|conformant name: (\w+)/);
          const replacement = named && (named[1] || named[2]);
          if (replacement && !warning.lines.join(' ').includes(replacement)) {
            const declaration = found.get(name);
            Object.assign(warning, { file: declaration.file, line: declaration.line, lines: declaration.lines });
          }
          msvcWarnings.set(name, warning);
          break;
        }
      }
      break;
    }
  }
  return found;
}

const msvcWarnings = new Map();

function msvcWarning(decl, declPath, roots, fileCache) {
  const attr = (decl.inner || []).find((node) => node.kind === 'DeprecatedAttr' && node.message);
  if (!attr) return null;
  const begin = attr.range?.begin;
  const at = begin?.expansionLoc || begin;
  if (at?.offset === undefined) return null;
  const path = at.file || declPath;
  const owner = roots.find((r) => path.replace(/\\/g, '/').toLowerCase().startsWith(`${r.root}/`));
  if (!owner) return null;
  if (!fileCache.has(path)) fileCache.set(path, readFileSync(path, 'latin1'));
  const text = fileCache.get(path);
  const line = text.slice(0, at.offset).split('\n').length;
  const lineText = text.split(/\r?\n/)[line - 1].trim();
  return {
    by: 'msvc',
    message: attr.message,
    source: owner.id,
    file: relative(sourceRoot(owner.id, sources[owner.id]), path).replace(/\\/g, '/'),
    line,
    lines: [lineText],
  };
}

const draftCache = new Map();

function joinWrapped(lines) {
  return lines.join(' ').replace(/(\w)- (\w)/g, '$1$2');
}

function standardWarnings(name) {
  const errnoClause = `\\bThe functions [\\w, ]*\\b${name}\\b[\\w, ]* (need not|are not required to) affect`;
  const pattern = new RegExp(
    `\\bThe ${name} function is (obsolescent|deprecated)|\\bThe ${name} function is not required to avoid data\\b|\\bCalls to the ${name} function .*may introduce data races|${errnoClause}`,
  );
  const byMessage = new Map();
  for (const [id, source] of Object.entries(sources)) {
    if (source.kind !== 'standard') continue;
    const path = join(sourceRoot(id, source), source.file);
    if (!existsSync(path)) continue;
    if (!draftCache.has(path)) draftCache.set(path, readFileSync(path, 'latin1').split(/\r?\n/));
    const lines = draftCache.get(path);
    const index = lines.findIndex((l) => pattern.test(l));
    if (index === -1) continue;
    const cited = [normalize(lines[index])];
    const start = new RegExp(`\\b(The|Calls to the) ${name} function|${errnoClause}`);
    const count = new RegExp(errnoClause).test(lines[index]) ? 2 : 1;
    const fromStart = () => {
      const joined = joinWrapped(cited);
      return joined.slice(Math.max(0, joined.search(start)));
    };
    const ends = () => (fromStart().match(/\.(?=\d+\)|\s|$)/g) || []).length;
    for (let next = index + 1; ends() < count && next < index + 4; next += 1) {
      if (lines[next].trim()) cited.push(normalize(lines[next]));
    }
    const message = fromStart().match(new RegExp(`^(?:.*?\\.(?=\\d+\\)|\\s|$)){${count}}`))[0];
    let key = message;
    if (/data races/.test(message)) key = 'race';
    if (count === 2) key = 'errno';
    byMessage.set(key, {
      by: 'standard',
      message,
      source: id,
      file: source.file,
      line: index + 1,
      lines: cited,
    });
  }
  return [...byMessage.values()];
}

function splitParams(list) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of list) {
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseSignature(signature, name) {
  const at =
    signature.indexOf(`${name}(`) !== -1
      ? signature.indexOf(`${name}(`)
      : signature.search(new RegExp(`\\b${name}\\s*\\(`));
  const open = signature.indexOf('(', at);
  let depth = 0;
  let close = open;
  for (; close < signature.length; close += 1) {
    if (signature[close] === '(') depth += 1;
    else if (signature[close] === ')') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const returnType = normalize(signature.slice(0, at).replace(/\[\[[^\]]*\]\]/g, ''));
  const list = signature.slice(open + 1, close);
  const params = splitParams(list)
    .filter((p) => p && p !== 'void')
    .map((p) => {
      if (p === '...') return { name: '...', type: '', description: '' };
      const pointer = p.match(/\(\s*\*\s*([A-Za-z_]\w*)\s*\)/);
      if (pointer) return { name: pointer[1], type: normalize(p.replace(pointer[0], '(*)')), description: '' };
      const named = p.match(/([A-Za-z_]\w*)\s*(\[[^\]]*\])?$/);
      if (named && !NOT_NAMES.has(named[1])) {
        return { name: named[1], type: normalize(p.slice(0, named.index) + (named[2] || '')), description: '' };
      }
      return { name: '', type: normalize(p), description: '' };
    });
  return { returnType, params };
}

const isGeneric = (text) => /\bQ(Char|Void|WChar)\b/.test(text);

const standardSources = Object.entries(sources).filter(([, s]) => s.kind === 'standard');
const perStandard = new Map();
for (const [id, source] of standardSources) perStandard.set(source.standard, parseDraft(id, source));

const names = [...new Set([...perStandard.values()].flatMap((m) => [...m.keys()]))].sort();
const workDir = mkdtempSync(join(tmpdir(), 'queryc-extract-'));
let headerDecls;
try {
  headerDecls = locateInHeaders(names, workDir);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

const docPath = join(dataDir, 'functions', `${header}.json`);
const doc = existsSync(docPath) ? JSON.parse(readFileSync(docPath, 'utf8')) : { header, functions: [] };
const existing = new Map(doc.functions.map((f) => [f.name, f]));
const notes = [];
const report = [];

const functions = names.map((name) => {
  const claims = STANDARDS.filter((s) => perStandard.get(s)?.has(name));
  const standardEvidence = claims.map((s) => perStandard.get(s).get(name));
  const plain = [...standardEvidence].reverse().find((e) => !isGeneric(e.synopsis)) || standardEvidence.at(-1);
  const signature = plain.synopsis;
  const parsed = parseSignature(signature, name);
  const previous = existing.get(name);
  const keepParams = previous && previous.params.map((p) => p.name).join() === parsed.params.map((p) => p.name).join();

  const evidence = standardEvidence.map(({ source, file, heading, line, lines }) => ({
    source,
    file,
    heading,
    line,
    lines,
  }));
  if (headerDecls.has(name)) evidence.push(headerDecls.get(name));

  const newest = standardEvidence.at(-1);
  notes.push(`## ${name}\n${newest.heading}\n${newest.synopsis}\n${newest.notes}\n`);
  report.push(
    `${name.padEnd(18)} ${claims.join(' ').padEnd(20)} ${headerDecls.has(name) ? headerDecls.get(name).source : '-'}${previous ? '' : '  (new)'}`,
  );

  return {
    name,
    summary: previous?.summary || '',
    signature,
    params: keepParams ? previous.params.map((p, i) => ({ ...p, type: parsed.params[i].type })) : parsed.params,
    returns: { type: parsed.returnType, description: previous?.returns?.description || '' },
    example: previous?.example || '',
    warnings: [...standardWarnings(name), ...(msvcWarnings.has(name) ? [msvcWarnings.get(name)] : [])],
    standards: claims,
    evidence,
  };
});

if (hasClangTidy()) {
  const declared = functions.filter((fn) => headerDecls.has(fn.name));
  const tidy = runClangTidy(header, declared, new Set(msvcWarnings.keys()));
  for (const fn of functions) fn.warnings.push(...(tidy.get(fn.name) || []));
} else {
  console.error('clang-tidy not found; clang-tidy warnings skipped');
}
for (const fn of functions) {
  if (!fn.warnings.length) delete fn.warnings;
}

const dropped = doc.functions.filter((f) => !names.includes(f.name)).map((f) => f.name);
console.log(report.join('\n'));
console.log(`\n${functions.length} functions in <${header}>, ${headerDecls.size} found in header sources.`);
if (dropped.length) console.log(`Not found in any draft (kept): ${dropped.join(', ')}`);

if (notesPath) writeFileSync(notesPath, notes.join('\n'));
if (write) {
  const kept = doc.functions.filter((f) => !names.includes(f.name));
  const all = [...functions, ...kept].sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(docPath, `${JSON.stringify({ header, functions: all }, null, 2)}\n`);
  console.log(`Wrote ${relative(repoRoot, docPath)}`);
}
