import { readFileSync, readdirSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, isAbsolute, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hasClangTidy, runClangTidy } from './clang-tidy.js';
import { draftSections } from './draft.js';
import { validateGo } from './go-validate.js';

const STANDARDS = ['C89', 'C95', 'C99', 'C11', 'C17', 'C23'];
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADING_WINDOW = 30;
const WARNING_SOURCES = ['standard', 'msvc', 'clang-tidy'];
const RETURN_VALUES = [
  ['a null pointer', /\breturns? a null pointer\b|\bnull pointer is returned\b/i, /\bnull pointer\b|\bNULL\b/],
  ['EOF', /\bEOF\b/, /\bEOF\b/],
  ['HUGE_VAL', /\bHUGE_VAL/, /\bHUGE_VAL/],
  ['zero', /\breturns? zero\b|\bzero (is returned|if)\b/i, /\bzero\b|\b0\b/i],
  ['nonzero', /\breturns? (a )?nonzero\b|\bnonzero (value )?(is returned|if)\b/i, /\bnonzero\b/i],
];

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(repoRoot, 'data');
const functionsDir = join(dataDir, 'functions');

const args = new Set(process.argv.slice(2));
const strict = args.has('--strict');
const compileExamples = !args.has('--no-compile');

const errors = [];
const warnings = [];
const fileCache = new Map();
let checkedEvidence = 0;
let skippedEvidence = 0;
let compiledExamples = 0;
let uncompiledExamples = 0;
let checkedWarnings = 0;

const normalize = (text) => text.replace(/\s+/g, ' ').trim();
const tight = (text) => normalize(text).replace(/\( /g, '(').replace(/ \)/g, ')');
const error = (where, message) => errors.push(`${where}: ${message}`);
const warn = (where, message) => warnings.push(`${where}: ${message}`);

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    error(path, `can't read JSON (${e.message})`);
    return null;
  }
}

function sourceRoot(id, source) {
  const override = process.env[`QUERYC_SOURCE_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`];
  const root = override || source.root;
  return isAbsolute(root) ? root : join(repoRoot, root);
}

function fileLines(path) {
  if (!fileCache.has(path)) {
    fileCache.set(path, existsSync(path) ? readFileSync(path, 'latin1').split(/\r?\n/) : null);
  }
  return fileCache.get(path);
}

function validateSources(sources) {
  const where = 'data/sources.json';
  if (!sources || typeof sources !== 'object') {
    error(where, 'must be an object keyed by source id');
    return {};
  }
  for (const [id, source] of Object.entries(sources)) {
    const at = `${where} ${id}`;
    if (!['standard', 'headers'].includes(source.kind)) error(at, 'kind must be "standard" or "headers"');
    if (typeof source.label !== 'string' || !source.label) error(at, 'label is required');
    if (typeof source.root !== 'string' || !source.root) error(at, 'root is required');
    if (source.kind === 'standard' && !STANDARDS.includes(source.standard)) {
      error(at, `standard must be one of ${STANDARDS.join(', ')}`);
    }
    if (source.kind === 'headers' && (!source.compiler || !source.library)) {
      error(at, 'headers sources need compiler and library');
    }
  }
  return sources;
}

function checkEvidence(at, fn, header, evidence, sources, { declaration = true } = {}) {
  const source = sources[evidence.source];
  if (!source) {
    error(at, `unknown source "${evidence.source}"`);
    return;
  }
  if (typeof evidence.file !== 'string' || !evidence.file) error(at, 'file is required');
  if (!Number.isInteger(evidence.line) || evidence.line < 1) error(at, 'line must be a positive integer');
  if (
    !Array.isArray(evidence.lines) ||
    evidence.lines.length === 0 ||
    evidence.lines.some((l) => typeof l !== 'string' || !l.trim())
  ) {
    error(at, 'lines must be a non-empty array of non-blank strings');
    return;
  }
  if (declaration && source.kind === 'standard' && typeof evidence.heading !== 'string') {
    error(at, 'standard evidence needs the section heading, like "7.21.6.3 The printf function"');
  }
  if (declaration && !new RegExp(`\\b${fn.name}\\b`).test(evidence.lines.join(' '))) {
    error(at, `lines don't mention ${fn.name}`);
  }

  const path = join(sourceRoot(evidence.source, source), evidence.file);
  const lines = fileLines(path);
  if (!lines) {
    skippedEvidence += 1;
    (strict ? error : warn)(
      at,
      `skipped, ${path} isn't available on this machine${source.kind === 'standard' ? '. Run bun run fetch-sources.' : ''}`,
    );
    return;
  }
  checkedEvidence += 1;

  let index = evidence.line - 1;
  for (const [i, expected] of evidence.lines.entries()) {
    while (index < lines.length && !lines[index].trim()) index += 1;
    const found = index < lines.length ? lines[index] : '(end of file)';
    if (normalize(found) !== normalize(expected)) {
      const first = normalize(evidence.lines[0]);
      const hits = lines.flatMap((l, n) => (normalize(l) === first ? [n + 1] : []));
      const hint = hits.length
        ? ` The first line appears at line ${hits.join(', ')}.`
        : ' The first line is nowhere in the file.';
      error(
        at,
        `line ${index + 1} of ${evidence.file} doesn't match lines[${i}]. Expected "${normalize(expected)}", found "${normalize(found)}".${i === 0 ? hint : ''}`,
      );
      return;
    }
    index += 1;
  }

  if (declaration && source.kind === 'standard') {
    const start = Math.max(0, evidence.line - 1 - HEADING_WINDOW);
    const window = lines.slice(start, evidence.line - 1).map(normalize);
    if (typeof evidence.heading === 'string' && !window.includes(normalize(evidence.heading))) {
      error(at, `heading "${evidence.heading}" isn't within ${HEADING_WINDOW} lines above line ${evidence.line}`);
    }
    if (!window.some((l) => l.replace(/^\d+\s+/, '') === `#include <${header}>`)) {
      error(at, `the synopsis above line ${evidence.line} doesn't include <${header}>`);
    }
  }
}

function checkExample(at, fn, workDir) {
  if (!compileExamples || !clang) return;
  const path = join(workDir, `${fn.name}.c`);
  writeFileSync(path, fn.example);
  const extra = [];
  for (const id of new Set(fn.evidence.map((e) => e.source))) {
    const source = sources[id];
    if (source?.kind !== 'headers' || !source.includes) continue;
    for (const dir of source.includes) extra.push('-I', join(sourceRoot(id, source), dir));
    for (const define of source.defines || []) extra.push(`-D${define}`);
  }
  const result = spawnSync(clang, ['-fsyntax-only', '-std=c23', '-w', ...extra, path], {
    encoding: 'utf8',
  });
  compiledExamples += 1;
  if (result.status !== 0) {
    const firstError = (result.stderr || '').split('\n').find((l) => l.includes('error')) || 'clang failed';
    error(at, `example doesn't compile: ${firstError.replace(path, `${fn.name}.c`)}`);
  }
}

function synopsisParams(signature) {
  const ptrReturn = /\(\*\s*\w+\s*\(/.exec(signature);
  const open = ptrReturn ? ptrReturn.index + ptrReturn[0].length - 1 : signature.indexOf('(');
  let depth = 0;
  let current = '';
  const parts = [];
  for (const ch of signature.slice(open + 1)) {
    if (ch === '(') depth += 1;
    if (ch === ')') {
      if (depth === 0) break;
      depth -= 1;
    }
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else current += ch;
  }
  parts.push(current.trim());
  return parts.filter((p) => p && p !== 'void');
}

function checkProse(at, fn, sources, evidence) {
  const declared = synopsisParams(fn.signature);
  if (declared.length !== fn.params.length) {
    error(at, `signature has ${declared.length} parameters but params has ${fn.params.length}`);
  }
  declared.forEach((text, i) => {
    const param = fn.params[i];
    if (!param) return;
    const named = param.name === '...' ? text === '...' : new RegExp(`\\b${param.name}\\b`).test(text);
    if (!named) error(at, `params[${i}] is "${param.name}" but the signature's parameter ${i + 1} is "${text}"`);
    if (!param.description?.trim()) error(at, `params[${i}] (${param.name}) has no description`);
  });

  const source = evidence && sources[evidence.source];
  if (!source) return;
  const sections = draftSections(
    fileLines(join(sourceRoot(evidence.source, source), evidence.file)),
    evidence.line - 1,
  );
  if (!sections?.returns) return;
  for (const [name, inDraft, inProse] of RETURN_VALUES) {
    if (inDraft.test(sections.returns) && !inProse.test(fn.returns.description)) {
      error(at, `returns.description doesn't mention ${name}, which the ${source.standard} Returns paragraph names`);
    }
  }
}

function validateFunction(at, fn, header, sources, workDir) {
  for (const key of ['name', 'summary', 'signature', 'example']) {
    if (typeof fn[key] !== 'string' || !fn[key].trim()) error(at, `${key} is required`);
  }
  if (typeof fn.name === 'string' && !IDENTIFIER.test(fn.name)) error(at, 'name must be a C identifier');
  if (!Array.isArray(fn.params)) error(at, 'params must be an array');
  if (!fn.returns || typeof fn.returns.type !== 'string' || typeof fn.returns.description !== 'string') {
    error(at, 'returns needs type and description');
  }
  if (!Array.isArray(fn.standards)) error(at, 'standards must be an array');
  if (!Array.isArray(fn.evidence) || fn.evidence.length === 0) {
    error(at, 'evidence must list at least one declaration');
    return;
  }
  if (
    !Array.isArray(fn.params) ||
    !Array.isArray(fn.standards) ||
    typeof fn.signature !== 'string' ||
    typeof fn.name !== 'string'
  )
    return;

  for (const param of fn.params) {
    if (typeof param.name !== 'string' || typeof param.type !== 'string' || typeof param.description !== 'string') {
      error(at, 'each param needs name, type, and description');
    } else if (param.name !== '...' && !new RegExp(`\\b${param.name}\\b`).test(fn.signature)) {
      error(at, `param "${param.name}" isn't in the signature`);
    }
  }
  if (
    fn.returns &&
    !normalize(fn.signature)
      .replace(/^(\[\[[^\]]*\]\]\s*)+/, '')
      .startsWith(normalize(fn.returns.type))
  ) {
    error(at, `signature doesn't start with the return type "${fn.returns.type}"`);
  }

  const claimed = fn.standards;
  const unknown = claimed.filter((s) => !STANDARDS.includes(s));
  if (unknown.length) error(at, `unknown standards ${unknown.join(', ')}`);
  const ordered = STANDARDS.filter((s) => claimed.includes(s));
  if (ordered.join() !== claimed.join()) error(at, `standards must be unique and in order: ${ordered.join(', ')}`);

  const evidenced = new Map();
  fn.evidence.forEach((evidence, i) => {
    const where = `${at} evidence[${i}] (${evidence.source})`;
    checkEvidence(where, fn, header, evidence, sources);
    const source = sources[evidence.source];
    if (source?.kind === 'standard') evidenced.set(source.standard, evidence);
  });

  for (const standard of claimed) {
    if (!evidenced.has(standard)) error(at, `claims ${standard} without evidence from a ${standard} source`);
  }
  for (const standard of evidenced.keys()) {
    if (!claimed.includes(standard)) error(at, `has ${standard} evidence but doesn't list ${standard} in standards`);
  }

  if (ordered.length) {
    const first = STANDARDS.indexOf(ordered[0]);
    const last = STANDARDS.indexOf(ordered.at(-1));
    for (const standard of STANDARDS.slice(first, last + 1)) {
      if (claimed.includes(standard)) continue;
      const available = Object.values(sources).some((s) => s.kind === 'standard' && s.standard === standard);
      if (available) warn(at, `skips ${standard} even though a ${standard} source exists`);
    }
    const synopses = ordered.filter((s) => evidenced.has(s)).map((s) => tight(evidenced.get(s).lines.join(' ')));
    if (synopses.length && !synopses.includes(tight(fn.signature))) {
      error(at, `signature doesn't match any claimed standard's synopsis, for example "${synopses.at(-1)}"`);
    }
  } else {
    warn(at, 'claims no standard, so the signature is unchecked');
  }

  checkProse(
    at,
    fn,
    sources,
    ordered
      .filter((s) => evidenced.has(s))
      .map((s) => evidenced.get(s))
      .at(-1),
  );

  if (fn.caution !== undefined) error(at, 'caution is no longer used; warnings come from scripts/extract.js');
  validateWarnings(at, fn, header, sources);

  const declared = fn.evidence.some((e) => sources[e.source]?.kind === 'headers');
  if (declared) checkExample(at, fn, workDir);
  else uncompiledExamples += 1;
}

function validateWarnings(at, fn, header, sources) {
  if (fn.warnings === undefined) return;
  if (!Array.isArray(fn.warnings) || !fn.warnings.length) {
    error(at, 'warnings must be a non-empty array when present');
    return;
  }
  fn.warnings.forEach((w, i) => {
    const where = `${at} warnings[${i}] (${w.by})`;
    if (!WARNING_SOURCES.includes(w.by)) {
      error(where, `by must be one of ${WARNING_SOURCES.join(', ')}`);
      return;
    }
    if (typeof w.message !== 'string' || !w.message.trim()) error(where, 'message is required');
    if (w.by === 'clang-tidy') {
      if (typeof w.check !== 'string' || !w.check) error(where, 'clang-tidy warnings need the check name');
      return;
    }
    const kind = sources[w.source]?.kind;
    if (w.by === 'msvc' && kind !== 'headers') error(where, 'msvc warnings must cite a headers source');
    if (w.by === 'standard' && kind !== 'standard') error(where, 'standard warnings must cite a standard source');
    checkEvidence(where, fn, header, w, sources, { declaration: false });
    checkedWarnings += 1;
    if (w.by === 'msvc') {
      const named = w.message.match(/Consider using (\w+) instead|conformant name: (\w+)/);
      const replacement = named && (named[1] || named[2]);
      const cited = (w.lines || []).join(' ');
      const pasted = replacement === `${fn.name}_s` && new RegExp(`\\b${fn.name}\\b`).test(cited);
      if (replacement && !cited.includes(replacement) && !pasted) {
        error(where, `the cited line doesn't name the replacement ${replacement}`);
      }
    }
    const quoted = normalize((w.lines || []).join(' ')).replace(/(\w)- (\w)/g, '$1$2');
    if (w.by === 'standard' && !quoted.includes(w.message)) {
      error(where, 'message must be the text of the cited line');
    }
  });
}

function checkClangTidy(where, header, functions, sources) {
  if (!tidy) return;
  const declared = functions.filter(
    (fn) => Array.isArray(fn.evidence) && fn.evidence.some((e) => sources[e.source]?.kind === 'headers'),
  );
  const explain = new Set(
    declared.filter((fn) => (fn.warnings || []).some((w) => w.by === 'msvc')).map((fn) => fn.name),
  );
  const actual = runClangTidy(header, declared, explain);
  const key = (w) => `${w.check} | ${w.message}`;
  for (const fn of declared) {
    const claimed = (fn.warnings || [])
      .filter((w) => w.by === 'clang-tidy')
      .map(key)
      .sort();
    const reported = (actual.get(fn.name) || []).map(key).sort();
    checkedWarnings += reported.length;
    if (claimed.join('\n') !== reported.join('\n')) {
      error(
        `${where} ${fn.name}`,
        `clang-tidy warnings don't match the data; run bun scripts/extract.js ${header} --write. clang-tidy reports: ${reported.join('; ') || 'nothing'}`,
      );
    }
  }
}

function findClang() {
  const result = spawnSync('clang', ['--version'], { encoding: 'utf8' });
  if (result.status === 0) return 'clang';
  if (compileExamples) warn('examples', 'clang not found, examples not compiled');
  return null;
}

const clang = compileExamples ? findClang() : null;
const tidy = hasClangTidy();
if (!tidy) (strict ? error : warn)('warnings', 'clang-tidy not found, clang-tidy warnings not re-checked');
const sources = validateSources(readJson(join(dataDir, 'sources.json')));
const workDir = mkdtempSync(join(tmpdir(), 'queryc-'));
const seen = new Map();
let functionCount = 0;

try {
  const files = existsSync(functionsDir)
    ? readdirSync(functionsDir)
        .filter((f) => f.endsWith('.json'))
        .sort()
    : [];
  if (!files.length) error('data/functions', 'no function files found');

  for (const file of files) {
    const where = `data/functions/${file}`;
    const doc = readJson(join(functionsDir, file));
    if (!doc) continue;
    const header = file.replace(/\.json$/, '');
    if (doc.header !== header) error(where, `header is "${doc.header}" but the file name says "${header}"`);
    if (!Array.isArray(doc.functions)) {
      error(where, 'functions must be an array');
      continue;
    }
    const names = doc.functions.map((f) => f.name);
    const sorted = [...names].sort();
    if (names.join() !== sorted.join()) error(where, 'functions must be sorted by name');

    for (const fn of doc.functions) {
      const at = `${where} ${fn.name ?? '(unnamed)'}`;
      if (seen.has(fn.name)) error(at, `also defined in ${seen.get(fn.name)}`);
      seen.set(fn.name, where);
      functionCount += 1;
      validateFunction(at, fn, header, sources, workDir);
    }
    checkClangTidy(where, header, doc.functions, sources);
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

const go = validateGo({ root: repoRoot, error, warn: (m) => warnings.push(m) });

for (const w of warnings) console.log(`WARN  ${w}`);
for (const e of errors) console.log(`ERROR ${e}`);
console.log(
  `\n${functionCount} functions, ${checkedEvidence} declarations checked against files, ${skippedEvidence} skipped, ${checkedWarnings} warnings re-checked, ${compiledExamples} examples compiled, ${uncompiledExamples} not compiled because no header source on this machine declares the function.`,
);
console.log(`${go.count} Go functions, ${go.checked} lines checked.`);
console.log(`${errors.length} errors, ${warnings.length} warnings.`);
process.exit(errors.length ? 1 : 0);
