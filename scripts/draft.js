export const HEADING = /^\s*(\d+(?:\.\d+)+)\s+The\s+(.+?)\s+(generic functions?|functions?)\s*$/;
export const ANY_HEADING = /^\s*[A-Z]?\d+(?:\.\d+)+\s+\S/;
export const TITLE_HEADING = /^\s*(7\.\d+\.\d+)\s+[A-Z][A-Za-z-]*(?:\s+[A-Za-z-]+)*\s*$/;
export const SYNOPSIS = /^\s*Synopsis\s*$/;
export const DESCRIPTION = /^\s*(\d+\s+)?Description\s*$/;
export const RETURNS = /^\s*(\d+\s+)?Returns\s*$/;
export const PAGE_NOISE =
  /(§\s*\d|working draft|Committee Draft|ISO\/IEC\s+9899|^\s*\d+\s+Library\s|Library\s+\d+\s*$|^\s*\d+\s*$|^\s*Page\s+\d+)/i;

const normalize = (text) => text.replace(/\s+/g, ' ').trim();

export function draftNotes(lines, start) {
  const out = [];
  for (let k = start; k < Math.min(lines.length, start + 60); k += 1) {
    if (k > start && ANY_HEADING.test(lines[k]) && !DESCRIPTION.test(lines[k]) && !RETURNS.test(lines[k])) break;
    if (PAGE_NOISE.test(lines[k])) continue;
    if (lines[k].trim()) out.push(normalize(lines[k]));
  }
  return out.join(' ');
}

const FOOTNOTE = /^\s*\d+\)\S/;
const EXAMPLE = /^\s*(\d+\s+)?EXAMPLE\b/;

export function draftSections(lines, synopsisLine) {
  const limit = Math.min(lines.length, synopsisLine + 600);
  let start = synopsisLine;
  while (start < limit && !DESCRIPTION.test(lines[start])) start += 1;
  if (start >= limit) return null;
  const description = [];
  const returns = [];
  let target = description;
  let footnote = false;
  for (let k = start + 1; k < limit; k += 1) {
    const line = lines[k];
    if (RETURNS.test(line)) {
      target = returns;
      footnote = false;
      continue;
    }
    if (ANY_HEADING.test(line) && !DESCRIPTION.test(line)) break;
    if (target === returns && EXAMPLE.test(line)) break;
    if (FOOTNOTE.test(line)) footnote = true;
    else if (/^\s*\d+\s+\S/.test(line)) footnote = false;
    if (footnote || PAGE_NOISE.test(line) || !line.trim()) continue;
    target.push(normalize(line));
  }
  return { description: description.join(' '), returns: returns.join(' ') };
}
