import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const FUNC = /^func ([A-Z]\w*)(\[[^\]]*\])?\((.*)$/;

export function apiVersions(root) {
  const versions = new Map();
  const files = readdirSync(join(root, 'api')).filter((f) => /^go1(\.\d+)?\.txt$/.test(f));
  const minor = (f) => Number(/^go1(?:\.(\d+))?\.txt$/.exec(f)[1] || 0);
  for (const file of files.sort((a, b) => minor(a) - minor(b))) {
    const lines = readFileSync(join(root, 'api', file), 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const m = /^pkg ([\w/]+), func ([A-Z]\w*)\(/.exec(line);
      if (!m) return;
      const key = `${m[1]}.${m[2]}`;
      if (!versions.has(key))
        versions.set(key, { version: `Go 1.${minor(file)}`, file: `api/${file}`, line: i + 1, text: line });
    });
  }
  return versions;
}

export function splitTop(text) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if ('([{'.includes(ch)) depth += 1;
    if (')]}'.includes(ch)) depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

export function closeParen(text) {
  let depth = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    if (text[i] === ')') depth -= 1;
    if (depth === 0) return i;
  }
  return -1;
}

export function parseGoParams(text) {
  const parts = splitTop(text);
  const out = [];
  let pending = [];
  for (const part of parts) {
    const m = /^(\w+)\s+(.+)$/.exec(part);
    if (!m) {
      pending.push(part);
      continue;
    }
    for (const name of pending) out.push({ name, type: m[2] });
    pending = [];
    out.push({ name: m[1], type: m[2] });
  }
  for (const t of pending) out.push({ name: '', type: t });
  return out;
}

export function parseFunc(line) {
  const m = FUNC.exec(line);
  if (!m) return null;
  const end = closeParen(m[3]);
  if (end < 0) return null;
  const params = m[3].slice(0, end);
  const returns = m[3]
    .slice(end + 1)
    .replace(/\{\s*(\}\s*)?$/, '')
    .trim();
  return {
    name: m[1],
    typeParams: m[2] || '',
    params,
    returns,
    signature: `func ${m[1]}${m[2] || ''}(${params})${returns ? ` ${returns}` : ''}`,
  };
}

export function scanExamples(root, pkg) {
  const dir = join(root, 'src', pkg);
  const found = new Map();
  const files = readdirSync(dir)
    .filter((f) => /^example.*_test\.go$/.test(f))
    .sort();
  for (const file of files) {
    const lines = readFileSync(join(dir, file), 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const match = /^func Example([A-Z]\w*?)(?:_[a-z]\w*)?\(\) \{$/.exec(line);
      if (!match || found.has(match[1])) return;
      const end = lines.indexOf('}', i);
      if (end === -1) return;
      found.set(match[1], { file: `src/${pkg}/${file}`, line: i + 1, lines: lines.slice(i, end + 1) });
    });
  }
  return found;
}

export function deprecation(decl) {
  const doc = decl.doc.split('\n');
  const start = doc.findIndex((l) => l.startsWith('Deprecated:'));
  if (start === -1) return null;
  let end = start;
  while (end + 1 < doc.length && doc[end + 1].trim()) end += 1;
  return {
    line: decl.docLine + start,
    message: doc
      .slice(start, end + 1)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),
  };
}

export function scanPackage(root, pkg) {
  const dir = join(root, 'src', pkg);
  const found = new Map();
  const texts = readdirSync(dir)
    .filter((f) => f.endsWith('.go') && !f.endsWith('_test.go'))
    .sort()
    .map((file) => ({ file, text: readFileSync(join(dir, file), 'utf8') }));
  const tagged = ({ text }) => Number(/^\/\/go:build /m.test(text));
  for (const { file, text } of texts.sort((a, b) => tagged(a) - tagged(b))) {
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      const parsed = parseFunc(line);
      if (!parsed || found.has(parsed.name)) return;
      const doc = [];
      for (let j = i - 1; j >= 0 && lines[j].startsWith('//'); j -= 1) doc.unshift(lines[j].replace(/^\/\/ ?/, ''));
      found.set(parsed.name, {
        ...parsed,
        file: `src/${pkg}/${file}`,
        line: i + 1,
        text: line,
        doc: doc.join('\n'),
        docLine: i + 1 - doc.length,
      });
    });
  }
  return found;
}
