import { headers } from './data.js';
import { stripBase, withBase } from './base.js';

const listeners = new Set();

export function parseRoute(url = new URL(window.location.href)) {
  const pathname = stripBase(url.pathname);
  const parts = decodeURIComponent(pathname).split('/').filter(Boolean);
  const params = url.searchParams;
  const search = {
    view: 'search',
    lang: ['go'].includes(params.get('lang')) ? params.get('lang') : 'c',
    q: params.get('q') || '',
    standard: params.get('std'),
    compiler: params.get('cc'),
  };

  if (parts.length === 0) return search;
  if (parts.length === 1 && parts[0] === 'headers') return { view: 'headers', lang: search.lang };
  if (parts.length === 1 && headers.includes(parts[0])) return { ...search, q: parts[0], redirect: true };
  if (parts.length > 3 && parts[0] === 'go')
    return { view: 'function', lang: 'go', header: parts.slice(1, -1).join('/'), name: parts.at(-1) };
  if (parts.length === 3 && ['go'].includes(parts[0]))
    return { view: 'function', lang: parts[0], header: parts[1], name: parts[2] };
  if (parts.length === 2) return { view: 'function', header: parts[0], name: parts[1] };
  return { view: 'missing', path: pathname };
}

export function searchUrl({ lang = 'c', q = '', standard = '', compiler = '' }) {
  const params = new URLSearchParams();
  if (lang !== 'c') params.set('lang', lang);
  if (q) params.set('q', q);
  if (standard) params.set('std', standard);
  if (compiler) params.set('cc', compiler);
  const query = params.toString();
  return withBase(query ? `?${query}` : '');
}

export function onRoute(listener) {
  listeners.add(listener);
}

function emit(state) {
  const route = parseRoute();
  for (const listener of listeners) listener(route, state);
}

export function navigate(url, { replace = false, state = null } = {}) {
  if (replace) window.history.replaceState(state, '', url);
  else window.history.pushState(state, '', url);
  emit(state);
}

export function replaceUrl(url) {
  if (url !== window.location.pathname + window.location.search) {
    window.history.replaceState(window.history.state, '', url);
  }
}

function readState(link) {
  if (!link.dataset.state) return null;
  try {
    return JSON.parse(link.dataset.state);
  } catch {
    return null;
  }
}

export function startRouter() {
  window.addEventListener('popstate', (event) => emit(event.state));

  document.addEventListener('click', (event) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const link = event.target.closest('a[href]');
    if (!link || link.target || link.hasAttribute('download')) return;
    const url = new URL(link.href);
    if (url.origin !== window.location.origin) return;
    event.preventDefault();
    navigate(url.pathname + url.search, { state: readState(link) });
  });

  emit(window.history.state);
}
