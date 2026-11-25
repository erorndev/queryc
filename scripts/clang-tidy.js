import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

export const TIDY_CHECKS = '-*,bugprone-unsafe-functions,clang-analyzer-security.insecureAPI.*';
const TIDY_FLAGS = ['-std=c11'];
const ANNEX_K_FLAGS = [...TIDY_FLAGS, '-D__STDC_LIB_EXT1__=201112L', '-D__STDC_WANT_LIB_EXT1__=1'];

export function hasClangTidy() {
  return spawnSync('clang-tidy', ['--version'], { encoding: 'utf8' }).status === 0;
}

function arity(fn) {
  return fn.params.filter((p) => p.name !== '...').length;
}

function runProbe(header, functions, flags) {
  const dir = mkdtempSync(join(tmpdir(), 'queryc-tidy-'));
  const lineToName = new Map();
  const lines = [`#include <${header}>`, ''];
  for (const fn of functions) {
    lines.push(`void queryc_probe_${fn.name}(void) {`);
    lineToName.set(lines.length + 1, fn.name);
    lines.push(`  (void)${fn.name}(${Array(arity(fn)).fill('0').join(', ')});`, '}', '');
  }
  const file = join(dir, 'probe.c');
  writeFileSync(file, lines.join('\n'));

  try {
    const result = spawnSync('clang-tidy', [file, `-checks=${TIDY_CHECKS}`, '--', ...flags], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const found = new Map(functions.map((fn) => [fn.name, []]));
    const pattern = /probe\.c:(\d+):\d+: warning: (.+?) \[([^\]]+)\]\s*$/;
    for (const raw of `${result.stdout}\n${result.stderr}`.split(/\r?\n/)) {
      const match = raw.match(pattern);
      if (!match) continue;
      const name = lineToName.get(Number(match[1]));
      if (!name) continue;
      const checks = match[3].split(',').filter((c) => !c.startsWith('clang-diagnostic'));
      if (!checks.length) continue;
      const entry = { by: 'clang-tidy', check: checks.join(', '), message: match[2] };
      const list = found.get(name);
      if (!list.some((w) => w.check === entry.check && w.message === entry.message)) list.push(entry);
    }
    return found;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function runClangTidy(header, functions, explain = new Set()) {
  const found = runProbe(header, functions, TIDY_FLAGS);
  const explained = functions.filter((fn) => explain.has(fn.name));
  if (!explained.length) return found;
  for (const [name, extra] of runProbe(header, explained, ANNEX_K_FLAGS)) {
    const list = found.get(name);
    for (const entry of extra) {
      if (!list.some((w) => w.check === entry.check && w.message === entry.message)) list.push(entry);
    }
  }
  return found;
}
