import hljs from './highlight.js';
import { STANDARDS, findByName, sources } from './data.js';
import { escapeHtml } from './html.js';
import { withBase } from './base.js';

function copyButton(label, text) {
  return `<button type="button" class="copy-button" data-copy="${escapeHtml(text)}" data-label="${escapeHtml(label)}">${escapeHtml(label)}</button>`;
}

function codeBlock(code, label, extraClass = '') {
  const highlighted = hljs.highlight(code, { language: 'c' }).value;
  return `
    <div class="code-block ${extraClass}">
      <div class="code-header">
        <span class="code-lang">C</span>
        ${copyButton(label, code)}
      </div>
      <pre><code class="hljs language-c">${highlighted}</code></pre>
    </div>`;
}

function renderParams(name, params) {
  if (!params.length) return `<p class="detail-text"><code>${escapeHtml(name)}</code> takes no parameters.</p>`;
  const rows = params
    .map(
      (p) => `
        <tr>
          <td><code class="param-name">${escapeHtml(p.name)}</code></td>
          <td><code>${escapeHtml(p.type)}</code></td>
          <td>${escapeHtml(p.description)}</td>
        </tr>`,
    )
    .join('');
  return `
    <table class="param-table">
      <thead><tr><th>Name</th><th>Type</th><th>Description</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function evidenceOrder(evidence) {
  const source = sources[evidence.source];
  if (source?.kind === 'standard') return STANDARDS.indexOf(source.standard);
  return STANDARDS.length;
}

function renderEvidence(evidence) {
  const source = sources[evidence.source];
  if (!source) return '';
  const isStandard = source.kind === 'standard';
  const tag = isStandard
    ? `<span class="tag">${escapeHtml(source.standard)}</span>`
    : `<span class="tag tag-compiler">${escapeHtml(source.compiler)}</span>`;
  const label = source.url
    ? `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener">${escapeHtml(source.label)}</a>`
    : escapeHtml(source.label);
  const section = isStandard && evidence.heading ? `§${escapeHtml(evidence.heading.split(' ')[0])}, ` : '';
  const location = `${section}${escapeHtml(evidence.file)} line&nbsp;${evidence.line}`;
  return `
    <li class="evidence">
      <div class="evidence-head">
        ${tag}
        <span class="evidence-source">${label}</span>
        <span class="evidence-location">${location}</span>
      </div>
      <pre class="evidence-code"><code class="hljs language-c">${hljs.highlight(evidence.lines.join('\n'), { language: 'c' }).value}</code></pre>
    </li>`;
}

function codeName(name, self) {
  const target = name === self ? null : findByName(name);
  const code = `<code>${escapeHtml(name)}</code>`;
  return target ? `<a href="${escapeHtml(target.path)}">${code}</a>` : code;
}

function linkify(text, self) {
  const pattern = /'([A-Za-z_]\w*)'|(?<=Consider using )([A-Za-z_]\w*)|(?<=conformant name: )([A-Za-z_]\w*)|CWE-(\d+)/g;
  let html = '';
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    html += escapeHtml(text.slice(cursor, match.index));
    if (match[4]) {
      html += `<a href="https://cwe.mitre.org/data/definitions/${match[4]}.html" target="_blank" rel="noopener">CWE-${match[4]}</a>`;
    } else {
      html += codeName(match[1] || match[2] || match[3], self);
    }
    cursor = match.index + match[0].length;
  }
  return html + escapeHtml(text.slice(cursor));
}

function warningSource(warning) {
  if (warning.by === 'clang-tidy') return `clang-tidy, <code>${escapeHtml(warning.check)}</code>`;
  const source = sources[warning.source];
  const label = warning.by === 'msvc' ? 'MSVC' : escapeHtml(source?.label || warning.source);
  return `${label}, ${escapeHtml(warning.file)} line&nbsp;${warning.line}`;
}

function warningText(warning) {
  if (warning.by === 'msvc') return warning.message.replace(/\s*To disable deprecation.*$/, '');
  return warning.message;
}

function renderAdvisory(fn) {
  const { level, removedIn, warnings } = fn.advisory;
  if (!level) return '';
  const explained = warnings.some((w) => !(w.by === 'msvc' && /may be unsafe/.test(w.message)));
  const shown = explained ? warnings.filter((w) => !(w.by === 'msvc' && /may be unsafe/.test(w.message))) : warnings;
  const items = shown.map(
    (w) => `
      <li>
        <p class="advisory-message">${linkify(warningText(w), fn.name)}</p>
        <p class="advisory-source">${warningSource(w)}</p>
      </li>`,
  );
  if (removedIn) {
    items.unshift(`
      <li>
        <p class="advisory-message">Removed in ${removedIn}. The ${removedIn} draft has no <code>${escapeHtml(fn.name)}</code>.</p>
        <p class="advisory-source">Standards: ${escapeHtml(fn.standards.join(', '))}</p>
      </li>`);
  }
  const title = level === 'avoid' ? 'Not Recommended' : 'Use With Care';
  return `
    <div class="advisory is-${level}" role="note">
      <strong class="advisory-title">${title}</strong>
      <ul class="advisory-list">${items.join('')}</ul>
    </div>`;
}

export function renderDetail(fn, backUrl) {
  const include = `#include <${fn.header}>`;
  const evidence = [...fn.evidence].sort((a, b) => evidenceOrder(a) - evidenceOrder(b));
  return `
    <div class="container detail-column">
      <a class="detail-back" href="${escapeHtml(backUrl)}" data-back>&larr; Back to Search</a>

      <div class="detail-head">
        <h1 class="detail-name" tabindex="-1">${escapeHtml(fn.name)}</h1>
        <div class="detail-include">
          <span class="detail-header">${escapeHtml(fn.header)}</span>
          ${copyButton('Copy Include', include)}
        </div>
      </div>

      <p class="detail-summary">${escapeHtml(fn.summary)}</p>
      ${renderAdvisory(fn)}

      ${codeBlock(fn.signature, 'Copy Signature', 'code-block-signature')}

      <h2 class="detail-heading">Parameters</h2>
      ${renderParams(fn.name, fn.params)}

      <h2 class="detail-heading">Return Value</h2>
      <p class="detail-text"><code>${escapeHtml(fn.returns.type)}</code> ${escapeHtml(fn.returns.description)}</p>

      <h2 class="detail-heading">Example</h2>
      ${codeBlock(fn.example.trimEnd(), 'Copy Example')}

      <h2 class="detail-heading">Sources</h2>
      <ul class="evidence-list">${evidence.map(renderEvidence).join('')}</ul>
      ${fn.docs ? `<p class="docs-credit">Text from <a href="https://learn.microsoft.com/windows-hardware/drivers/ddi/${escapeHtml(fn.docs.replace(/\.md$/, ''))}">Microsoft's driver docs</a>, shared under <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.</p>` : ''}
    </div>`;
}

const WDK_HEADERS = new Set(['wdm.h', 'ntddk.h']);

export function renderHeaders(headers, functions) {
  const counts = new Map();
  for (const fn of functions) counts.set(fn.header, (counts.get(fn.header) || 0) + 1);
  const renderList = (list) =>
    list
      .map((h) => {
        const count = counts.get(h) || 0;
        const href = withBase(`?q=${encodeURIComponent(h)}`);
        return `<li class="header-item"><a href="${escapeHtml(href)}"><code>&lt;${escapeHtml(h)}&gt;</code></a><span>${count} ${count === 1 ? 'function' : 'functions'}</span></li>`;
      })
      .join('');
  const stdHeaders = headers.filter((h) => !WDK_HEADERS.has(h));
  const wdkHeaders = headers.filter((h) => WDK_HEADERS.has(h));
  return `
    <div class="container">
      <div class="detail-top">
        <a class="detail-back" href="${escapeHtml(withBase(''))}">← Back to Search</a>
      </div>
      <h1 class="detail-name" tabindex="-1">Headers</h1>
      <p class="detail-summary">${functions.length} functions across ${headers.length} headers.</p>
      <h2 class="detail-heading">C Standard Library</h2>
      <ul class="header-list">${renderList(stdHeaders)}</ul>
      ${wdkHeaders.length ? `<h2 class="detail-heading">Windows Driver Kit (WDK)</h2><ul class="header-list">${renderList(wdkHeaders)}</ul>` : ''}
    </div>`;
}

export function renderMissing({ header, name, path }) {
  const target = name || (path || '').split('/').filter(Boolean).pop() || '';
  const where = header ? ` in <code>&lt;${escapeHtml(header)}&gt;</code>` : '';
  const searchHref = withBase(`?q=${encodeURIComponent(target)}`);
  return `
    <div class="container detail-column">
      <a class="detail-back" href="${escapeHtml(withBase(''))}">&larr; Back to Search</a>
      <h1 class="detail-name detail-missing" tabindex="-1">Function Not Found</h1>
      <p class="detail-text">No function named <code>${escapeHtml(target)}</code>${where}. <a href="${escapeHtml(searchHref)}">Search for it</a> instead.</p>
    </div>`;
}

function legacyCopy(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  let copied;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return legacyCopy(text);
  }
}

export function bindCopyButtons(container) {
  container.addEventListener('click', async (event) => {
    const button = event.target.closest('.copy-button');
    if (!button) return;
    if (await copyText(button.dataset.copy)) {
      button.textContent = 'Copied';
    } else {
      button.textContent = /Mac|iPhone|iPad/.test(navigator.platform)
        ? 'Press Command-C to Copy'
        : 'Press Ctrl+C to Copy';
      const code = button.parentElement.querySelector('code');
      if (code) window.getSelection().selectAllChildren(code);
    }
    button.classList.add('is-done');
    clearTimeout(button.resetTimer);
    button.resetTimer = setTimeout(() => {
      button.textContent = button.dataset.label;
      button.classList.remove('is-done');
    }, 1600);
  });
}
