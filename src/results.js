import hljs from './highlight.js';
import { compilerOptions, functions, headers, standardOptions } from './data.js';
import { search } from './search.js';
import { navigate, replaceUrl, searchUrl } from './router.js';
import { escapeHtml } from './html.js';

function highlight(name, ranges) {
  let html = '';
  let cursor = 0;
  for (const [start, end] of ranges) {
    html += `${escapeHtml(name.slice(cursor, start))}<mark>${escapeHtml(name.slice(start, end))}</mark>`;
    cursor = end;
  }
  return html + escapeHtml(name.slice(cursor));
}

function renderResult({ fn, match }, index) {
  const standards = fn.standards.map((s) => `<span class="tag">${s}</span>`).join('');
  const compilers = fn.compilers.map((c) => `<span class="tag tag-compiler">${escapeHtml(c)}</span>`).join('');
  const { level } = fn.advisory;
  let caution = '';
  if (level === 'avoid') caution = '<span class="tag tag-caution">Not Recommended</span>';
  else if (level === 'care') caution = '<span class="tag tag-care">Use With Care</span>';
  return `
    <li role="option" id="result-${index}" aria-selected="false">
      <a class="result${level === 'avoid' ? ' is-discouraged' : ''}" href="${escapeHtml(fn.path)}" data-state='{"fromSearch":true}' tabindex="-1">
        <span class="result-name">${highlight(fn.name, match.ranges)}</span>
        <span class="result-header">${escapeHtml(fn.header)}</span>
        <code class="result-signature hljs language-${{ c: 'c', js: 'typescript', go: 'go', rust: 'rust' }[fn.lang]}">${hljs.highlight(fn.signature, { language: { c: 'c', js: 'typescript', go: 'go', rust: 'rust' }[fn.lang] }).value}</code>
        <span class="result-summary">${escapeHtml(fn.summary)}</span>
        <span class="result-tags">${caution}${standards}${compilers}</span>
      </a>
    </li>`;
}

function fillSelect(select, values) {
  for (const value of values) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.append(option);
  }
}

const FILTER_KEYS = { standard: 'filter-standard', compiler: 'filter-compiler' };

function loadFilter(key) {
  try {
    return localStorage.getItem(FILTER_KEYS[key]) || '';
  } catch {
    return '';
  }
}

function saveFilter(key, value) {
  try {
    if (value) localStorage.setItem(FILTER_KEYS[key], value);
    else localStorage.removeItem(FILTER_KEYS[key]);
  } catch {
    return false;
  }
  return true;
}

const KEYS_HINT =
  '<span class="results-keys"><kbd>&uarr;</kbd><kbd>&darr;</kbd> to move, <kbd>Enter</kbd> to open, <kbd>Esc</kbd> to clear</span>';

export function initResults({ input, form, onLang = () => {} }) {
  const list = document.getElementById('results');
  const hint = document.getElementById('results-hint');
  const status = document.getElementById('results-status');
  const standardSelect = document.getElementById('filter-standard');
  const compilerSelect = document.getElementById('filter-compiler');
  let active = true;
  let lang = 'c';
  let current = [];
  let selected = -1;
  let selectedByMouse = false;

  fillSelect(compilerSelect, compilerOptions);

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-controls', 'results');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Search results');

  function setLang(next) {
    if (next === lang && standardSelect.options.length > 1) return;
    lang = next;
    standardSelect.length = 1;
    fillSelect(
      standardSelect,
      standardOptions.filter((s) => functions.some((f) => f.lang === lang && f.standards.includes(s))),
    );
    compilerSelect.closest('.filter').style.display = lang === 'c' ? '' : 'none';
    if (lang !== 'c') compilerSelect.value = '';
  }

  const state = () => ({ lang, q: input.value.trim(), standard: standardSelect.value, compiler: compilerSelect.value });

  function filterLabel() {
    return [standardSelect.value, compilerSelect.value].filter(Boolean).join(' ');
  }

  function setStatus(html) {
    status.innerHTML = html;
    status.hidden = !html;
  }

  function select(index, { byMouse = false } = {}) {
    selectedByMouse = byMouse;
    const items = list.children;
    if (selected >= 0 && items[selected]) {
      items[selected].setAttribute('aria-selected', 'false');
      items[selected].firstElementChild.classList.remove('is-selected');
    }
    selected = index;
    if (selected < 0 || !items[selected]) {
      selected = -1;
      input.removeAttribute('aria-activedescendant');
      return;
    }
    items[selected].setAttribute('aria-selected', 'true');
    items[selected].firstElementChild.classList.add('is-selected');
    input.setAttribute('aria-activedescendant', items[selected].id);
    if (!byMouse) items[selected].scrollIntoView({ block: 'nearest' });
  }

  function open(index) {
    const entry = current[index];
    if (entry) navigate(entry.fn.path, { state: { fromSearch: true } });
  }

  const PREFIXES = { c: 'c', rust: 'rust', rs: 'rust', js: 'js', javascript: 'js', go: 'go' };

  function takePrefix() {
    const match = /^\s*(\w+):\s*/.exec(input.value);
    const next = match && PREFIXES[match[1].toLowerCase()];
    if (!next) return;
    input.value = input.value.slice(match[0].length);
    if (next !== lang) {
      setLang(next);
      standardSelect.value = '';
      onLang(next);
    }
  }

  function update() {
    takePrefix();
    const filters = { lang, standard: standardSelect.value, compiler: compilerSelect.value };
    const { query, exactHeader, results } = search(input.value, filters);
    if (active) {
      replaceUrl(searchUrl(state()));
      document.title = state().q ? `${state().q} | QueryC` : 'QueryC';
    }

    current = results;
    selected = -1;
    input.removeAttribute('aria-activedescendant');
    input.setAttribute('aria-expanded', String(results.length > 0));
    hint.hidden = Boolean(query.text);
    list.innerHTML = results.map(renderResult).join('');

    if (!query.text) {
      setStatus('');
      return;
    }

    const typed = `<code>${escapeHtml(input.value.trim())}</code>`;

    if (query.tooLong) {
      setStatus(`Patterns can be at most ${query.tooLong} characters. Shorten the pattern to search.`);
      return;
    }

    if (query.error) {
      setStatus(
        `The pattern ${typed} isn't a valid regular expression (${escapeHtml(query.error)}). Check for unclosed brackets or escape special characters with <code>\\</code>.`,
      );
      return;
    }

    const label = filterLabel();

    if (results.length === 0) {
      const scope =
        lang !== 'c' ? [...new Set(functions.filter((f) => f.lang === lang).map((f) => f.header))] : headers;
      const covered = scope.map((h) => `<code>${escapeHtml(h)}</code>`).join(' & ');
      const tip =
        query.mode === 'text'
          ? `Check the spelling, search by ${{ c: 'header', js: 'object', go: 'package', rust: 'module' }[lang]}, or try a pattern like <code>${{ c: 'str*', js: 'to*', go: 'Trim*', rust: 'size_of*' }[lang]}</code>. QueryC covers ${covered} so far.`
          : `Try a looser pattern. QueryC covers ${covered} so far.`;
      setStatus(
        label
          ? `No ${escapeHtml(label)} functions match ${typed}. <button type="button" class="link-button" data-clear-filters>Clear Filters</button> or check the spelling.`
          : `No functions match ${typed}. ${tip}`,
      );
      return;
    }

    const noun = `${label ? `${escapeHtml(label)} ` : ''}function${results.length === 1 ? '' : 's'}`;
    let where = '';
    if (exactHeader) where = ` in <code>&lt;${escapeHtml(exactHeader)}&gt;</code>`;
    else if (query.mode !== 'text') where = ` match ${typed}`;
    setStatus(`<span>${results.length}&nbsp;${noun}${where}</span>${KEYS_HINT}`);
  }

  status.addEventListener('click', (event) => {
    if (!event.target.closest('[data-clear-filters]')) return;
    standardSelect.value = '';
    compilerSelect.value = '';
    saveFilters();
    update();
    input.focus();
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && current.length) {
      event.preventDefault();
      select(selected + 1 >= current.length ? 0 : selected + 1);
    } else if (event.key === 'ArrowUp' && current.length) {
      event.preventDefault();
      select(selected <= 0 ? current.length - 1 : selected - 1);
    } else if (event.key === 'Escape') {
      if (selected >= 0) select(-1);
      else if (input.value) {
        input.value = '';
        update();
      }
      event.preventDefault();
    }
  });

  list.addEventListener('mousemove', (event) => {
    const item = event.target.closest('li[role="option"]');
    if (!item) return;
    const index = Array.prototype.indexOf.call(list.children, item);
    if (index !== selected) select(index, { byMouse: true });
  });

  list.addEventListener('mouseleave', () => {
    if (selectedByMouse) select(-1);
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (current.length) open(selected >= 0 ? selected : 0);
  });

  input.addEventListener('input', update);
  function saveFilters() {
    saveFilter('standard', standardSelect.value);
    saveFilter('compiler', compilerSelect.value);
  }

  standardSelect.addEventListener('change', () => {
    saveFilters();
    update();
  });
  compilerSelect.addEventListener('change', () => {
    saveFilters();
    update();
  });

  const pick = (menu, value) => (Array.from(menu.options).some((o) => o.value === value) ? value : '');

  return {
    show(route) {
      active = true;
      setLang(route.lang || 'c');
      input.value = route.q;
      standardSelect.value = pick(standardSelect, route.standard ?? loadFilter('standard'));
      compilerSelect.value = lang === 'js' ? '' : pick(compilerSelect, route.compiler ?? loadFilter('compiler'));
      update();
    },
    hide() {
      active = false;
    },
    url: () => searchUrl(state()),
  };
}
