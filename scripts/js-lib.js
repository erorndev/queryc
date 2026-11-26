import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const VERSIONS = [
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

const LIB_FILE = /^lib\.(es5|es20\d\d)(\.[a-z0-9.]+)?\.d\.ts$/;
const METHOD = /^([A-Za-z_$][\w$]*)(<.+?>)?\((.*)\): (.+)$/;
const START = /^(?:declare )?(?:function )?[A-Za-z_$][\w$]*(<.+?>)?\(/;

export function libVersion(file) {
  const match = LIB_FILE.exec(file);
  if (!match) return null;
  const version = match[1].toUpperCase();
  return VERSIONS.includes(version) ? version : null;
}

export function declText(lines) {
  return lines
    .map((l) => l.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/\( /g, '(')
    .replace(/,? \)/g, ')')
    .replace(/^(declare )?function /, '')
    .replace(/;$/, '');
}

export function parseDecl(text) {
  const match = METHOD.exec(text);
  return match ? { name: match[1], paramText: match[3], returnType: match[4] } : null;
}

export function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if ('([{<'.includes(ch)) depth += 1;
    if (')]}>'.includes(ch) && depth > 0) depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

export function parseParams(paramText) {
  return splitTopLevel(paramText).map((part) => {
    const colon = part.indexOf(':');
    const rawName = part.slice(0, colon).trim();
    return { name: rawName.replace(/\?$/, ''), type: part.slice(colon + 1).trim(), optional: rawName.endsWith('?') };
  });
}

function contextAt(line, ns) {
  const top = /^interface ([A-Za-z0-9]+)(<[^>]*>)? \{$/.exec(line);
  if (top) return { object: top[1].replace(/Constructor$/, ''), indent: 4, close: '}' };
  const space = /^declare namespace ([A-Za-z]+) \{$/.exec(line);
  if (space) return { object: space[1], indent: 4, close: '}', namespace: space[1] };
  const inner = ns && /^ {4}interface ([A-Za-z0-9]+)(<[^>]*>)?( extends [^{]+)? \{$/.exec(line);
  if (inner) return { object: `${ns}.${inner[1].replace(/Constructor$/, '')}`, indent: 8, close: '    }' };
  const value = ns && /^ {4}const ([A-Za-z0-9]+): \{$/.exec(line);
  if (value) return { object: `${ns}.${value[1]}`, indent: 8, close: '    };' };
  return null;
}

export function scanLib(root, objects) {
  const found = new Map();
  const files = readdirSync(root)
    .filter((f) => libVersion(f))
    .sort((a, b) => VERSIONS.indexOf(libVersion(a)) - VERSIONS.indexOf(libVersion(b)) || a.localeCompare(b));
  for (const file of files) {
    const lines = readFileSync(join(root, file), 'utf8').split(/\r?\n/);
    const stack = [{ object: 'globalThis', indent: 0, close: null }];
    let doc = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const ctx = stack[stack.length - 1];
      const open = contextAt(line, ctx.namespace);
      if (open) {
        stack.push(open);
        doc = [];
        continue;
      }
      if (ctx.close !== null && line === ctx.close) {
        stack.pop();
        continue;
      }
      if (!objects.includes(ctx.object)) continue;
      const pad = ' '.repeat(ctx.indent);
      if (!line.startsWith(pad) || line[ctx.indent] === ' ') continue;
      const body = line.slice(ctx.indent);
      if (body.startsWith('/**')) doc = [];
      if (/^(\/\*\*| \*)/.test(body)) {
        doc.push(line);
        continue;
      }
      if (ctx.indent === 0 && !body.startsWith('declare function ')) continue;
      if (ctx.namespace && ctx.object === ctx.namespace && !body.startsWith('function ')) continue;
      if (!START.test(body)) {
        doc = [];
        continue;
      }
      const decl = [line];
      while (!decl[decl.length - 1].trimEnd().endsWith(';') && i + 1 < lines.length) {
        i += 1;
        decl.push(lines[i]);
      }
      const text = declText(decl);
      const parsed = parseDecl(text);
      if (!parsed) {
        doc = [];
        continue;
      }
      const key = `${ctx.object}.${parsed.name}`;
      if (!found.has(key))
        found.set(key, { object: ctx.object, name: parsed.name, version: libVersion(file), declarations: [] });
      found.get(key).declarations.push({
        file,
        line: i + 2 - decl.length,
        lines: decl.map((l) => l.trim()),
        text,
        ...parsed,
        doc: doc.join('\n'),
      });
      doc = [];
    }
  }
  return found;
}
