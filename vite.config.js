import { defineConfig } from 'vite';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname);

const escapeAttr = (text) =>
  text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function functionPages() {
  const dir = join(root, 'data', 'functions');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => {
      const { header, functions } = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      return functions.map((fn) => ({ header, name: fn.name, summary: fn.summary }));
    });
}

function prerenderFunctionPages() {
  let outDir;
  return {
    name: 'queryc-function-pages',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const template = readFileSync(join(outDir, 'index.html'), 'utf8');
      const headers = new Set();
      for (const page of functionPages()) {
        headers.add(page.header);
        const html = template
          .replace(/<title>[^<]*<\/title>/, `<title>${escapeAttr(`${page.name} in <${page.header}> | QueryC`)}</title>`)
          .replace(
            /<meta name="description" content="[^"]*"/,
            `<meta name="description" content="${escapeAttr(page.summary)}"`,
          );
        const dir = join(outDir, page.header, page.name);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'index.html'), html);
      }
      for (const header of headers) {
        writeFileSync(join(outDir, header, 'index.html'), template);
      }
      writeFileSync(join(outDir, '404.html'), template);
    },
  };
}

function contentSecurityPolicy() {
  return {
    name: 'queryc-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
          (match) => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`,
        );
        const policy = [
          "default-src 'self'",
          `script-src 'self' ${hashes.join(' ')}`,
          "style-src 'self'",
          "img-src 'self'",
          "font-src 'self'",
          "connect-src 'self'",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join('; ');
        return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
      },
    },
  };
}

export default defineConfig({
  plugins: [contentSecurityPolicy(), prerenderFunctionPages()],
});
