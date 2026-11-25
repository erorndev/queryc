import { functions, headers } from './data.js';

const RANK = {
  exact: 0,
  prefix: 1,
  header: 2,
  substring: 3,
  headerPrefix: 4,
  fuzzy: 5,
  summary: 6,
  signature: 7,
};

const MAX_PATTERN_LENGTH = 100;

const escapeRegExp = (text) => text.replace(/[.+^${}()|[\]\\]/g, '\\$&');

function parsePattern(trimmed) {
  if (trimmed.startsWith('/') && trimmed.length > 1) {
    let body = trimmed.slice(1);
    const close = body.lastIndexOf('/');
    if (close > 0 && /^[a-z]*$/.test(body.slice(close + 1))) body = body.slice(0, close);
    if (body.length > MAX_PATTERN_LENGTH) {
      return { mode: 'regex', text: body, error: 'too long', tooLong: MAX_PATTERN_LENGTH };
    }
    try {
      return { mode: 'regex', text: body, regex: new RegExp(body, 'i'), matchHeaders: /\.h/.test(body) };
    } catch (e) {
      return {
        mode: 'regex',
        text: body,
        error: e.message.replace(/^Invalid regular expression: (\/.*\/[a-z]*: )?/, ''),
      };
    }
  }
  if (/[*?]/.test(trimmed)) {
    const glob = trimmed.slice(0, MAX_PATTERN_LENGTH).replace(/\*+/g, '*');
    const source = `^${escapeRegExp(glob).replace(/\*/g, '.*').replace(/\?/g, '.')}$`;
    return { mode: 'wildcard', text: trimmed, regex: new RegExp(source, 'i'), matchHeaders: /\.h/.test(trimmed) };
  }
  return null;
}

function parseQuery(raw) {
  const trimmed = raw.trim();
  const pattern = parsePattern(trimmed);
  if (pattern) return pattern;
  const text = trimmed.toLowerCase().replace(/^#include\s*/, '');
  const bracketed = /^<.*>?$/.test(text);
  const bare = text.replace(/^<|>$/g, '').trim();
  return { mode: 'text', text: bare, wantsHeader: bracketed || bare.endsWith('.h') };
}

function headerTarget(text) {
  const withExt = text.endsWith('.h') ? text : `${text}.h`;
  return headers.includes(withExt) ? withExt : null;
}

function fuzzyMatch(name, text) {
  const indices = [];
  let from = 0;
  for (const ch of text) {
    const at = name.indexOf(ch, from);
    if (at === -1) return null;
    indices.push(at);
    from = at + 1;
  }
  const spread = indices.at(-1) - indices[0] + 1;
  return spread <= text.length * 2 ? indices : null;
}

function rangesFrom(indices) {
  const ranges = [];
  for (const i of indices) {
    const last = ranges.at(-1);
    if (last && last[1] === i) last[1] = i + 1;
    else ranges.push([i, i + 1]);
  }
  return ranges;
}

function scorePattern(fn, { regex, matchHeaders }) {
  const hit = regex.exec(fn.name);
  if (hit) return { rank: RANK.exact, ranges: hit[0].length ? [[hit.index, hit.index + hit[0].length]] : [] };
  if (matchHeaders && regex.test(fn.header)) return { rank: RANK.header, ranges: [] };
  return null;
}

function score(fn, query, exactHeader) {
  if (query.regex) return scorePattern(fn, query);
  const { text, wantsHeader } = query;
  if (exactHeader && fn.header === exactHeader) return { rank: RANK.header, ranges: [] };
  if (wantsHeader) {
    const base = text.replace(/\.h$/, '');
    return base && fn.header.startsWith(base) ? { rank: RANK.headerPrefix, ranges: [] } : null;
  }
  if (fn.nameLower === text) return { rank: RANK.exact, ranges: [[0, text.length]] };
  if (fn.nameLower.startsWith(text)) return { rank: RANK.prefix, ranges: [[0, text.length]] };
  const at = fn.nameLower.indexOf(text);
  if (at !== -1) return { rank: RANK.substring, ranges: [[at, at + text.length]] };
  if (text.length >= 3 && fn.header.startsWith(text)) return { rank: RANK.headerPrefix, ranges: [] };
  if (text.length >= 2) {
    const indices = fuzzyMatch(fn.nameLower, text);
    if (indices) return { rank: RANK.fuzzy, ranges: rangesFrom(indices) };
  }
  if (text.length >= 3 && fn.summaryLower.includes(text)) return { rank: RANK.summary, ranges: [] };
  if (text.length >= 3 && fn.signatureLower.includes(text)) return { rank: RANK.signature, ranges: [] };
  return null;
}

export function search(raw, { standard = '', compiler = '' } = {}) {
  const query = parseQuery(raw);
  if (!query.text || query.error) return { query, exactHeader: null, results: [] };
  const exactHeader = query.mode === 'text' ? headerTarget(query.text) : null;

  const results = functions
    .filter((fn) => (!standard || fn.standards.includes(standard)) && (!compiler || fn.compilers.includes(compiler)))
    .map((fn) => ({ fn, match: score(fn, query, exactHeader) }))
    .filter((r) => r.match)
    .sort(
      (a, b) =>
        a.match.rank - b.match.rank ||
        Number(a.fn.advisory.level === 'avoid') - Number(b.fn.advisory.level === 'avoid') ||
        a.fn.name.length - b.fn.name.length ||
        a.fn.name.localeCompare(b.fn.name),
    );

  return { query, exactHeader, results };
}
