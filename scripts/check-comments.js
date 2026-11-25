import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skipDirs = new Set(['node_modules', 'dist', 'sources', 'data', '.git', '.claude']);
const patterns = {
  '.scss': [/(^|[^:"'])\/\/(?![^'"]*['"])/, /\/\*/],
  '.html': [/<!--/],
};

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (skipDirs.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (patterns[extname(entry)]) out.push(path);
  }
  return out;
}

const problems = [];
for (const file of walk(repoRoot)) {
  const checks = patterns[extname(file)];
  readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .forEach((line, index) => {
      if (checks.some((check) => check.test(line))) {
        problems.push(`${relative(repoRoot, file)}:${index + 1}: ${line.trim()}`);
      }
    });
}

for (const problem of problems) console.log(problem);
console.log(
  problems.length
    ? `\n${problems.length} comments found. QueryC has no code comments.`
    : 'No comments in HTML or SCSS.',
);
process.exit(problems.length ? 1 : 0);
