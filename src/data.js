import sourceRegistry from '../data/sources.json';

const files = import.meta.glob('../data/functions/*.json', { eager: true, import: 'default' });

export const STANDARDS = ['C89', 'C95', 'C99', 'C11', 'C17', 'C23'];
export const sources = sourceRegistry;

const availableStandards = new Set(
  Object.values(sources)
    .filter((s) => s.kind === 'standard')
    .map((s) => s.standard),
);

function compilersFor(fn) {
  const labels = fn.evidence
    .map((e) => sources[e.source])
    .filter((s) => s && s.kind === 'headers')
    .map((s) => s.compiler);
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
  const fromStandard = warnings.some((w) => w.by === 'standard' && /obsolescent|deprecated/.test(w.message));
  const msvcUnsafe = warnings.some((w) => w.by === 'msvc' && /may be unsafe/.test(w.message));
  const tidy = warnings.some((w) => w.by === 'clang-tidy');
  let level = null;
  if (removed || fromStandard || (msvcUnsafe && tidy)) level = 'avoid';
  else if (warnings.length) level = 'care';
  return { level, removedIn: removed, warnings };
}

export const functions = Object.values(files)
  .flatMap((file) =>
    file.functions.map((fn) => ({
      ...fn,
      header: file.header,
      compilers: compilersFor(fn),
      advisory: advisory(fn),
      path: `/${file.header}/${fn.name}/`,
      nameLower: fn.name.toLowerCase(),
      summaryLower: fn.summary.toLowerCase(),
      signatureLower: fn.signature.toLowerCase(),
    })),
  )
  .sort((a, b) => a.name.localeCompare(b.name));

export const headers = [...new Set(functions.map((f) => f.header))].sort();

export const standardOptions = STANDARDS.filter((s) => functions.some((f) => f.standards.includes(s)));

export const compilerOptions = [...new Set(functions.flatMap((f) => f.compilers))].sort();

export function findByName(name) {
  return functions.find((f) => f.name === name) || null;
}

export function findFunction(header, name) {
  return functions.find((f) => f.header === header && f.name === name) || null;
}
