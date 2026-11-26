import { withBase } from './base.js';
import sourceRegistry from '../data/sources.json';
import jsSources from '../data/js/sources.json';
import goSources from '../data/go/sources.json';
import rustSources from '../data/rust/sources.json';
import files from 'virtual:queryc-index';

const fullFiles = import.meta.glob(
  [
    '../data/functions/*.json',
    '../data/js/*.json',
    '!../data/js/sources.json',
    '../data/go/*.json',
    '!../data/go/sources.json',
    '../data/rust/*.json',
    '!../data/rust/sources.json',
  ],
  {
    import: 'default',
  },
);

export const STANDARDS = ['C89', 'C95', 'C99', 'C11', 'C17', 'C23'];
const JS_VERSIONS = [
  'ES5',
  'ES2015',
  'ES2016',
  'ES2017',
  'ES2018',
  'ES2019',
  'ES2020',
  'ES2021',
  'ES2022',
  'ES2023',
  'ES2024',
];
const GO_VERSIONS = Array.from({ length: 26 }, (_, i) => `Go 1.${i}`);
const RUST_VERSIONS = Array.from({ length: 101 }, (_, i) => `Rust 1.${i}`);
export const sources = { ...sourceRegistry, ...jsSources, ...goSources, ...rustSources };

const availableStandards = new Set(
  Object.values(sources)
    .filter((s) => s.kind === 'standard')
    .map((s) => s.standard),
);

function compilersFor(fn) {
  const labels = fn.sources
    .map((id) => sources[id])
    .filter((s) => s && s.kind === 'headers')
    .map((s) => (s.library === 'WDK' ? 'WDK' : s.compiler));
  return [...new Set(labels)];
}

function removedIn(fn) {
  const last = STANDARDS.indexOf(fn.standards.at(-1));
  if (last === -1) return null;
  return STANDARDS.slice(last + 1).find((s) => availableStandards.has(s)) || null;
}

function advisory(fn) {
  const warnings = fn.warnings || [];
  const removed = removedIn(fn);
  const fromStandard = warnings.some(
    (w) =>
      (w.by === 'standard' && /obsolescent|deprecated|behavior is undefined/.test(w.message)) ||
      (w.by === 'go' && w.message.startsWith('Deprecated:')),
  );
  const msvcUnsafe = warnings.some((w) => w.by === 'msvc' && /may be unsafe/.test(w.message));
  const tidy = warnings.some((w) => w.by === 'clang-tidy');
  let level = null;
  if (removed || fromStandard || (msvcUnsafe && tidy)) level = 'avoid';
  else if (warnings.length) level = 'care';
  return { level, removedIn: removed, warnings };
}

export const functions = files
  .flatMap((file) =>
    file.functions.map((fn) => ({
      ...fn,
      header: file.header,
      lang: file.lang || 'c',
      compilers: compilersFor(fn),
      advisory: advisory(fn),
      path: withBase(
        file.lang && file.lang !== 'c' ? `${file.lang}/${file.header}/${fn.name}/` : `${file.header}/${fn.name}/`,
      ),
      nameLower: fn.name.toLowerCase(),
      summaryLower: fn.summary.toLowerCase(),
      signatureLower: fn.signature.toLowerCase(),
    })),
  )
  .sort((a, b) => a.name.localeCompare(b.name));

export const headers = [...new Set(functions.filter((f) => f.lang === 'c').map((f) => f.header))].sort();

export const standardOptions = [...STANDARDS, ...JS_VERSIONS, ...GO_VERSIONS, ...RUST_VERSIONS].filter((s) =>
  functions.some((f) => f.standards.includes(s)),
);

export const compilerOptions = [...new Set(functions.flatMap((f) => f.compilers))].sort();

export function findByName(name) {
  return functions.find((f) => f.name === name) || null;
}

export function findFunction(header, name, lang = 'c') {
  return functions.find((f) => f.lang === lang && f.header === header && f.name === name) || null;
}

export async function loadFunction(fn) {
  const dir = fn.lang === 'c' ? 'functions' : fn.lang;
  const file = await fullFiles[`../data/${dir}/${fn.header.replaceAll('/', '-')}.json`]();
  const full = file.functions.find((f) => f.name === fn.name);
  return { ...fn, ...full };
}
