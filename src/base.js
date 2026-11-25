export const BASE = import.meta.env.BASE_URL;

export function withBase(path) {
  return BASE + path.replace(/^\//, '');
}

export function stripBase(pathname) {
  if (pathname === BASE.slice(0, -1)) return '/';
  return pathname.startsWith(BASE) ? `/${pathname.slice(BASE.length)}` : pathname;
}
