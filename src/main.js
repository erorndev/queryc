import { withBase } from './base.js';
import '@fontsource-variable/geist-mono';
import './styles/main.scss';
import { initResults } from './results.js';
import { findFunction, functions, loadFunction } from './data.js';
import { bindCopyButtons, renderDetail, renderHeaders, renderMissing } from './detail.js';
import { navigate, onRoute, searchUrl, startRouter } from './router.js';

const form = document.getElementById('search-form');
const input = document.getElementById('search-input');

form.addEventListener('submit', (event) => {
  event.preventDefault();
});

document.addEventListener('keydown', (event) => {
  if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable) return;
  event.preventDefault();
  if (finder.hidden) navigate(lastSearchUrl);
  input.focus();
  input.select();
});

const root = document.documentElement;
const toggle = document.getElementById('theme-toggle');
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

function effectiveTheme() {
  return root.dataset.theme || (systemDark.matches ? 'dark' : 'light');
}

function saveTheme(theme) {
  try {
    localStorage.setItem('theme', theme);
    return true;
  } catch {
    return false;
  }
}

function syncToggle() {
  const theme = effectiveTheme();
  root.dataset.themeEffective = theme;
  toggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode');
}

toggle.addEventListener('click', () => {
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  saveTheme(next);
  syncToggle();
});

systemDark.addEventListener('change', syncToggle);
syncToggle();

const langSwitch = document.getElementById('lang-switch');
const langButton = document.getElementById('lang-current');

function setLangMenu(open) {
  langSwitch.classList.toggle('is-open', open);
  langButton.setAttribute('aria-expanded', String(open));
}

langButton.addEventListener('click', () => {
  setLangMenu(!langSwitch.classList.contains('is-open'));
});

langSwitch.addEventListener('mouseenter', () => langButton.setAttribute('aria-expanded', 'true'));
langSwitch.addEventListener('mouseleave', () => {
  if (!langSwitch.classList.contains('is-open')) langButton.setAttribute('aria-expanded', 'false');
});

document.addEventListener('click', (event) => {
  if (!langSwitch.contains(event.target)) setLangMenu(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && langSwitch.contains(document.activeElement)) {
    setLangMenu(false);
    langButton.blur();
  }
});

const exampleHeaders = [
  'complex.h',
  'ctype.h',
  'fenv.h',
  'inttypes.h',
  'locale.h',
  'math.h',
  'setjmp.h',
  'signal.h',
  'stdatomic.h',
  'stdbit.h',
  'stdio.h',
  'stdlib.h',
  'string.h',
  'threads.h',
  'time.h',
  'uchar.h',
  'wchar.h',
  'wctype.h',
];

document.getElementById('example-header').textContent =
  exampleHeaders[Math.floor(Math.random() * exampleHeaders.length)];

const LANGS = {
  c: {
    name: 'C',
    logo: 'c-logo.svg',
    title: 'C Library Reference',
    lead: 'Query the C library directly.',
    placeholder: 'printf, memcpy, strtol',
  },
  go: {
    name: 'Go',
    logo: 'go-logo.svg',
    title: 'Go Library Reference',
    lead: 'Query the Go standard library directly.',
    placeholder: 'Contains, Atoi, Split',
  },
};
const hintEl = document.getElementById('results-hint');
const cHint = hintEl.innerHTML;
const goHint =
  'Type a function name or a package like <code>strings</code><br />Patterns work too: <code>Trim*</code> or <code>/^Parse/</code>';
const langLogo = langButton.querySelector('img');
const langItems = langSwitch.querySelectorAll('a.lang-item');
const coverage = document.getElementById('coverage');
const headersLink = document.getElementById('headers-link');
let currentLang = '';

function applyLang(lang) {
  if (lang === currentLang) return;
  currentLang = lang;
  try {
    localStorage.setItem('lang', lang);
  } catch {
    coverage.dataset.unsaved = 'lang';
  }
  headersLink.href = withBase(lang === 'c' ? 'headers/' : `headers/?lang=${lang}`);
  headersLink.textContent = { c: 'Headers', js: 'Objects', go: 'Packages', rust: 'Modules' }[lang];
  const info = LANGS[lang];
  document.querySelector('.finder-title').textContent = info.title;
  document.querySelector('.finder-lead').textContent = info.lead;
  input.placeholder = info.placeholder;
  hintEl.innerHTML = { c: cHint, go: goHint }[lang];
  langLogo.src = withBase(info.logo);
  langLogo.classList.toggle('lang-logo-mono', lang === 'rust');
  langLogo.width = { c: 22, js: 24, go: 64, rust: 24 }[lang];
  langButton.setAttribute('aria-label', `Language: ${info.name}`);
  for (const item of langItems) {
    const isCurrent = item.textContent.trim() === info.name;
    item.classList.toggle('is-current', isCurrent);
    if (isCurrent) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
  const own = functions.filter((f) => f.lang === lang);
  const groups = new Set(own.map((f) => f.header)).size;
  const unit = { c: 'headers', js: 'objects', go: 'packages', rust: 'modules' }[lang];
  coverage.textContent = `${own.length} functions across ${groups} ${unit}`;
}

const results = initResults({ input, form, onLang: applyLang });
const finder = document.querySelector('.finder');
const detail = document.getElementById('detail');
const baseTitle = 'QueryC';
let lastSearchUrl = withBase('');

bindCopyButtons(detail);

detail.addEventListener('click', (event) => {
  const back = event.target.closest('[data-back]');
  if (!back || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (window.history.state?.fromSearch) {
    event.preventDefault();
    window.history.back();
  }
});

function showSearch(route) {
  detail.hidden = true;
  detail.innerHTML = '';
  finder.hidden = false;
  applyLang(route.lang);
  results.show(route);
  lastSearchUrl = results.url();
  document.title = route.q ? `${route.q} | ${baseTitle}` : baseTitle;
  input.focus();
}

let detailRequest = 0;

async function showDetail(route) {
  detailRequest += 1;
  const request = detailRequest;
  lastSearchUrl = finder.hidden ? lastSearchUrl : results.url();
  results.hide();
  finder.hidden = true;
  detail.hidden = false;
  applyLang(route.lang || 'c');
  const found = findFunction(route.header, route.name, route.lang);
  const fn = found ? await loadFunction(found) : null;
  if (request !== detailRequest || detail.hidden) return;
  detail.innerHTML = fn ? renderDetail(fn, lastSearchUrl) : renderMissing(route);
  const place = fn?.lang !== 'c' ? `${fn?.header}.${fn?.name}` : `${fn?.name} in <${fn?.header}>`;
  document.title = fn ? `${place} | ${baseTitle}` : `Function Not Found | ${baseTitle}`;
  window.scrollTo(0, 0);
  detail.querySelector('h1')?.focus({ preventScroll: true });
}

function showHeaders(lang) {
  applyLang(lang);
  lastSearchUrl = finder.hidden ? lastSearchUrl : results.url();
  results.hide();
  finder.hidden = true;
  detail.hidden = false;
  detail.innerHTML = renderHeaders(lang, functions);
  document.title = `${{ c: 'Headers', js: 'Objects', go: 'Packages', rust: 'Modules' }[lang]} | ${baseTitle}`;
  window.scrollTo(0, 0);
  detail.querySelector('h1')?.focus({ preventScroll: true });
}

function savedLang() {
  try {
    const lang = localStorage.getItem('lang');
    return LANGS[lang] ? lang : 'c';
  } catch {
    return 'c';
  }
}

let firstRoute = true;

onRoute((route) => {
  const isFirst = firstRoute;
  firstRoute = false;
  if (isFirst && route.view === 'search' && !route.q && !new URL(window.location.href).searchParams.has('lang')) {
    const lang = savedLang();
    if (lang !== 'c') {
      navigate(searchUrl({ lang }), { replace: true });
      return;
    }
  }
  if (route.redirect) {
    navigate(withBase(`?q=${encodeURIComponent(route.q)}`), { replace: true });
    return;
  }
  if (route.view === 'search') showSearch(route);
  else if (route.view === 'headers') showHeaders(route.lang);
  else if (route.view === 'function') showDetail(route);
  else showDetail({ path: route.path });
});

const toTop = document.getElementById('to-top');

window.addEventListener(
  'scroll',
  () => {
    toTop.hidden = window.scrollY < 600;
  },
  { passive: true },
);

toTop.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
  (finder.hidden ? detail.querySelector('h1') : input)?.focus({ preventScroll: true });
});

let touchStart = null;

detail.addEventListener(
  'touchstart',
  (event) => {
    const touch = event.touches[0];
    touchStart = event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : null;
  },
  { passive: true },
);

detail.addEventListener(
  'touchend',
  (event) => {
    if (!touchStart || event.target.closest('pre, table, .code-block')) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - touchStart.x;
    const dy = Math.abs(touch.clientY - touchStart.y);
    touchStart = null;
    if (dx < 90 || dy > dx / 2) return;
    if (window.history.state?.fromSearch) window.history.back();
    else navigate(lastSearchUrl);
  },
  { passive: true },
);

startRouter();
