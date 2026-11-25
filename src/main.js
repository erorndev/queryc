import '@fontsource-variable/geist-mono';
import './styles/main.scss';
import { initResults } from './results.js';
import { findFunction } from './data.js';
import { bindCopyButtons, renderDetail, renderMissing } from './detail.js';
import { navigate, onRoute, startRouter } from './router.js';

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

const results = initResults({ input, form });
const finder = document.querySelector('.finder');
const detail = document.getElementById('detail');
const baseTitle = 'QueryC';
let lastSearchUrl = '/';

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
  results.show(route);
  lastSearchUrl = results.url();
  document.title = route.q ? `${route.q} | ${baseTitle}` : baseTitle;
  input.focus();
}

function showDetail(route) {
  lastSearchUrl = finder.hidden ? lastSearchUrl : results.url();
  results.hide();
  finder.hidden = true;
  detail.hidden = false;
  const fn = findFunction(route.header, route.name);
  detail.innerHTML = fn ? renderDetail(fn, lastSearchUrl) : renderMissing(route);
  document.title = fn ? `${fn.name} in <${fn.header}> | ${baseTitle}` : `Function Not Found | ${baseTitle}`;
  window.scrollTo(0, 0);
  detail.querySelector('h1')?.focus({ preventScroll: true });
}

onRoute((route) => {
  if (route.redirect) {
    navigate(`/?q=${encodeURIComponent(route.q)}`, { replace: true });
    return;
  }
  if (route.view === 'search') showSearch(route);
  else if (route.view === 'function') showDetail(route);
  else showDetail({ path: route.path });
});

startRouter();
