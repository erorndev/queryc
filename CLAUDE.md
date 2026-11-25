# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project goal

QueryC is a webpage for searching the C library. For each function, a user can find:

- What it does and how to use it: signature, parameters, return value, and an example
- The header that declares it (for example, `printf` is in `<stdio.h>`)

The UI is minimal, in the style of a 2016 website. "2016 era" describes the visual design only; it puts no limit on tooling or code.

## Tech stack

HTML, SCSS, and JavaScript, built with Vite. Bun is the package manager and runtime, since this machine has no Node.js.

## Commands

```
bun install          # install dependencies
bun run dev          # Vite dev server at http://localhost:5173
bun run build        # production build into dist/
bun run preview      # serve dist/
bun run fetch-sources # download the standard drafts and extract their text (once per clone)
bun run validate     # check data/ against the source files; exits 1 on any error
bun run lint         # ESLint, Stylelint, Prettier check, and the no-comments check
bun run format       # Prettier write, then ESLint and Stylelint autofixes
bun scripts/extract.js string.h                      # dry run: list what the drafts and headers declare
bun scripts/extract.js string.h --write --notes x.md # merge facts into data/functions/string.h.json
bun run prose string.h --todo                       # list functions with empty prose
bun run prose string.h p.json                       # fill empty prose from {name:{summary,params,returns,example}}
```

`bun run validate -- --no-compile` skips compiling examples; `--strict` turns sources missing from this machine into errors instead of warnings. Run `validate` after every data change.

Bun lives at `%USERPROFILE%\.bun\bin\bun.exe`, and a shell opened before the install may not have it on PATH. Bun blocks the `@parcel/watcher` postinstall, which only builds the package from source; leave it blocked, because the package ships prebuilt binaries.

## Structure

- `index.html` is the only page and the Vite entry. It loads `src/main.js`, which imports `src/styles/main.scss`.
- Search runs entirely in the browser. `src/data.js` imports `virtual:queryc-index`, a slim index (name, summary, signature, standards, warnings, source ids) that the `queryc-index` plugin in `vite.config.js` builds from every `data/functions/*.json`; the full entry loads per header with a lazy `import.meta.glob` (`loadFunction`) when a function page opens. A function's compilers come from its `headers` sources in `data/sources.json`, with the WDK source shown as its own "WDK" compiler. `src/search.js` ranks matches: exact name, name prefix, exact header (`stdio.h`, `<stdio`, `#include <stdio.h>`), name substring, header prefix, fuzzy subsequence, words in the summary, then text in the signature. A query starting with `/` is a case-insensitive regular expression (`/^v.*printf$/`, trailing `/flags` ignored) tested against name, then header, then signature; a query containing `*` or `?` is a wildcard pattern anchored to the whole name or header. Patterns test the header only when they contain `.h`, so `str*` doesn't pull in every `string.h` function. Regex and wildcard patterns only ever run against names and headers, never signatures or summaries, and regexes are capped at 100 characters: queries come from shareable URLs, and a catastrophic pattern like `/([a-z ]+)+X/` against a 100-character signature freezes the tab (measured in Chromium: time doubles every 2 characters). Keep any new pattern target this short. Invalid regexes show the parser's message instead of results. Within a rank, Not Recommended functions sort last.
- Keyboard: `/` focuses search from anywhere (and leaves a function page), ArrowUp/ArrowDown move a selection through results (wrapping), Enter opens the selected result or the first one, and Escape clears the selection, then the query. The input is an ARIA combobox with `aria-activedescendant` pointing at the selected `li[role=option]`. Key hints next to the result count hide on touch devices and narrow screens. `src/results.js` renders results and the Standard and Compiler filters, whose options list only values present in the data.
- Visitor preferences live in localStorage: `theme`, `filter-standard`, and `filter-compiler`. Changing a filter or clicking Clear Filters saves it; on load, a `std` or `cc` in the URL wins over the saved value (so shared links show what the sender saw) without overwriting it. Every storage access is wrapped in try/catch.
- Matched letters in a result name are blue text (`mark`), with no underline; on Not Recommended results they stay grey.
- URLs: `/?q=print&std=C99&cc=MSVC` is the search view (the URL and tab title update as you type, with `replaceState`), `/stdio.h/printf/` is a function page (links end in `/` because static hosts redirect folder URLs to add one; the router accepts both), and `/stdio.h` redirects to `/?q=stdio.h`. `src/router.js` uses the History API and intercepts same-origin link clicks; `src/main.js` switches between the `.finder` and `#detail` sections and sets `document.title`. `src/detail.js` renders the function page from the full data entry, including every evidence line under "Sources" and, for WDK entries with `docs`, a CC BY 4.0 credit linking the Microsoft page.
- The site deploys to GitHub Pages at `erorndev.github.io/queryc/` through `.github/workflows/pages.yml` (Pages source: GitHub Actions), which runs only `bun install` and `bun run build` with `BASE_PATH=/<repo>/`, since CI has no drafts, clang, or MSVC headers. `vite.config.js` reads `BASE_PATH` into Vite's `base` (default `/`). Never hard-code a root-absolute path: JS goes through `withBase` and `stripBase` in `src/base.js`, and `index.html` links use `%BASE_URL%` (Vite rewrites `src` attributes itself). Test a subfolder build with `$env:BASE_PATH='/queryc/'; bun run build` in PowerShell (Git Bash rewrites `/queryc/` into a Windows path), copied into a `queryc` folder under a static server's root.
- `vite.config.js` has a build plugin that copies `dist/index.html` to `dist/<header>/<name>/index.html` (with that function's title and description), `dist/<header>/index.html`, and `dist/404.html`, so function URLs work on any static host without rewrite rules. `vite preview` falls back to `index.html` for every path and hides a missing page, so test the build with the `queryc-static` launch config (`py -m http.server 4174 --directory dist`), which serves only real files.
- Security: every value that reaches `innerHTML` goes through `escapeHtml` (`src/html.js`), including first-party data. The build adds a Content-Security-Policy meta tag (`queryc-csp` plugin in `vite.config.js`) allowing only same-origin resources plus the inline theme script by SHA-256 hash; if you change that inline script, the hash updates itself, but any new inline script or style needs the policy updated. `.claude/` is git-ignored because `launch.json` holds a machine-specific path.
- The initial JS bundle holds the slim index for 2,107 functions: 694 kB (107 kB gzipped). Each header's full data is its own chunk (`manualChunks`), loaded on first visit to one of its function pages; `wdm.h` is the largest at 1.2 MB. If the index keeps growing, trim summaries or warnings from it next.
- Copy buttons try `navigator.clipboard`, then fall back to `document.execCommand('copy')`, then select the text and say "Press Ctrl+C to Copy". The desktop app's browser pane blocks the Clipboard API, so testing there exercises the fallback.
- `src/styles/_theme.scss` defines every color as a CSS custom property, in one light set and one dark set: flat 2016 colors (navy header, `#2980b9` blue accent, blue-grey dark theme). The user chose this palette over Vercel's neutral Geist greys; don't switch to those. `_variables.scss` maps each `$color-*` to its `var()`, so Sass color functions like `rgba($color-accent, …)` fail on them; add a new token to both sets instead.
- The theme follows the system setting until the header toggle saves `theme` in localStorage. An inline script in the `<head>` of `index.html` applies the saved theme before first paint, so dark mode never flashes white.
- SCSS uses the module system (`@use`, `sass:color`), never `@import` or deprecated globals like `darken()`. Each partial pulls shared tokens from `src/styles/_variables.scss` with `@use`.
- Text uses the system Helvetica stack (`'Helvetica Neue', Helvetica, Arial, sans-serif`). Helvetica is commercial and can't be bundled, so macOS and iOS show Helvetica and Windows falls back to Arial. Code uses Geist Mono, self-hosted from `@fontsource-variable/geist-mono` and imported in `src/main.js`. Use `$font-sans` and `$font-mono`, never a font name directly. Type scale: 16px body, headings at weight 600 with slight negative tracking (`$tracking-heading`, `$tracking-subheading`), buttons at 500, no weights below 400.
- `public/c-logo.svg`, `public/cpp-logo.svg`, and `public/rust-logo.svg` are official logos from Wikimedia Commons, kept unmodified. Never draw or edit logos; recolor with CSS instead (the black Rust logo gets `filter: invert(1)` via `.lang-logo-mono`).
- The C logo in the header is a language switcher (`src/styles/_brand.scss`). Hover, focus, or a tap opens a menu with C, C++, and Rust; C++ and Rust are dimmed with "Coming Soon" until those references exist. Escape or a click outside closes it.

## Layout puts search first

Developers arrive with a function name in mind and want its header, signature, or usage, so the page gives them a search box and nothing that competes with it:

- The search box is the largest, highest-contrast element on the page. It takes focus on load, and `/` focuses it from anywhere. The title and lead above it stay small and muted.
- Title, search, and results share one centered column (`$column-width`), so the eye moves down, never sideways. Results appear directly under the input.
- Each result shows the function name as the main line, the header (`stdio.h`, no `#include`) as a subtitle under it, then the signature. Summary and tags come after, in smaller, lighter text. Results have generous spacing between them; the function page uses the same name-then-header layout.

## UI copy

Text on the site follows the Vercel design guidelines' copywriting rules (https://vercel.com/design/guidelines#copywriting). These rules cover what users see on the page, not this file or other docs.

- Headings and buttons use Chicago Title Case: "C Library Reference", "Switch to Dark Mode". Button text in `aria-label`s and JS strings follows the same rule.
- Use active voice and second person, and lead with the action: "Type a function name", not "A function name can be entered".
- Prefer `&` over "and".
- Keep nouns consistent. The site's terms are function, header, standard, and compiler; don't introduce synonyms like "routine" or "include file".
- Use numerals for counts ("8 functions") and a non-breaking space between a number and its unit (`10&nbsp;MB`).
- Error and empty-state messages stay positive and tell the user what to do next: "No functions match `strcpyy`. Check the spelling or search by header.", not "No results."
- Labels say exactly what happens: "Copy Signature", not "Copy".
- No em dashes, even though the Vercel examples use them; use a period or a colon instead.

## Function data

Coverage is every C standard (C89, C95, C99, C11, C17, C23), plus functions specific to the major compilers and their libraries (GCC/glibc, Clang, MSVC/UCRT), not only ISO C. Never write an entry from memory: every claim needs a line in a real file that `bun run validate` can re-check.

- `data/sources.json` registers every file we check against, keyed by id. `kind: "standard"` sources are standard drafts with a `standard` (C89 to C23); `kind: "headers"` sources are a library's header tree with `compiler`, `library`, and `version`. Relative `root`s resolve from the repo root; set `QUERYC_SOURCE_<ID>` (for example `QUERYC_SOURCE_UCRT_10_0_26100_0`) to point a source somewhere else.
- `data/functions/<header>.json` holds `{ "header": "stdio.h", "functions": [...] }`, sorted by name. Each function has `name`, `summary`, `signature`, `params` (`name`, `type`, `description`; variadics use `"..."`), `returns` (`type`, `description`), `example` (a full C program), `standards`, and `evidence`.
- Each `evidence` item names a `source`, a `file` relative to that source's root, the 1-based `line` where the declaration starts, and its `lines`. Standard evidence also needs the section `heading` exactly as the draft prints it, like `"7.21.6.3 The printf function"`.
- The validator compares `lines` to the file, ignoring whitespace runs and blank lines (PDF text puts blank lines between wrapped lines). For standards it also checks that the heading and `#include <header>` sit just above the synopsis, that every claimed standard has evidence (and the reverse), and that `signature` equals the newest claimed standard's synopsis. It syntax-checks every `example` with `clang -std=c23` against the UCRT headers.
- Standard drafts live in `sources/standards/`: the C89 draft (`c89-draft.txt`, ANSI X3J11/88-090, unofficial), N1256 (C99), N1570 (C11), and N3220 (C23). The PDFs and the `.txt` files are both git-ignored (the C23 draft carries ISO's copyright notice, so the repo doesn't republish it). `bun run fetch-sources` downloads each standard source listed in `data/sources.json` and runs `pdftotext -layout` on the PDFs; it skips files already present unless given `--force`. The `.txt` files are what the validator reads, and a fresh clone must run `fetch-sources` before `validate`. Never claim C95 or C17 yet: there's no C95 draft, and N2176 (C17) is password-protected, so neither standard has a source.
- Header sources on this machine: Windows SDK UCRT 10.0.26100.0 and the MSVC 14.44.35207 VC runtime headers (VS 2022 Build Tools, which declare `memset`, `memcpy`, `strchr`, and friends in `vcruntime_string.h`). glibc, musl, and other libraries need their headers downloaded before their functions can be claimed.
- `scripts/extract.js <header>` generates the facts for one header. It scans each standard draft for "N.N.N The X function" (or "generic function") sections, or clause 7 sections with a plain title like "7.18.3 Count Leading Zeros" (used by `<stdbit.h>`, whose sections list several declarations and have no Description), whose synopsis ends with `#include <header>`, skipping Annex K (`__STDC_WANT_LIB_EXT1__`) and page headers and footers, and takes each declaration's lines. It then runs `clang -Xclang -ast-dump=json -ast-dump-filter=<name>` on `#include <header>` to find where MSVC declares each function, matching parentheses from the declaration's position (macro-generated declarations such as UCRT's `strcpy` resolve to the macro call). `--write` merges into the data file, keeping existing prose, params, and `caution`; new functions get empty prose that `validate` rejects until filled. `--notes <file>` writes the newest draft's Description and Returns text for each function, for writing paraphrases.
- `signature` must equal one of the claimed standards' synopses (whitespace after `(` and before `)` ignored). The extractor picks the newest one without C23's `QChar`/`QVoid` generic types whose parameter count matches the previous standard's (N3220's `pdftotext` output garbles `wcstoul` and `wcstoull`), so `strchr` shows the C11 `char *strchr(const char *s, int c);`.
- Examples compile only for functions a header source on this machine declares; the rest (`gets`, `memset_explicit`, `strndup`) are counted as not compiled.
- Warnings are generated, never hand-written: `scripts/extract.js` fills each function's optional `warnings` array from three sources. `standard`: a draft sentence like "The gets function is obsolescent, and is deprecated." a data-race line ("The strtok function is not required to avoid data races…"), or the clause 7.24.1 paragraph saying `atof`, `atoi`, `atol`, and `atoll` don't set errno and have undefined behavior on overflow (both sentences kept), newest draft only, cited by file and line, joined across PDF line wraps and cut at the first sentence end. `msvc`: the `DeprecatedAttr` message clang reports for MSVC's `_CRT_INSECURE_DEPRECATE` or `_CRT_NONSTDC_DEPRECATE`, cited at the attribute's line, or at the whole overload-macro call when MSVC builds the replacement by pasting `_s` onto the name (as for `strcpy_s`). `clang-tidy`: the message and check name from `scripts/clang-tidy.js`, which runs `bugprone-unsafe-functions`, `clang-analyzer-security.insecureAPI.*`, `bugprone-unchecked-string-to-number-conversion`, `concurrency-mt-unsafe`, and `misc-predictable-rand` (a sweep of every `bugprone`, `cert`, `clang-analyzer`, `concurrency`, `misc`, and `portability` check found nothing else that applies to a bare call; `bugprone-unused-return-value` and `bugprone-random-generator-seed` only fire because the probe discards results and passes 0) on a probe file that calls each MSVC-declared function with zero arguments. MSVC's message says only "may be unsafe", so functions MSVC flags get a second probe with `__STDC_LIB_EXT1__` defined, where `bugprone-unsafe-functions` states a reason ("has no exclusive access to the opened file"). That Annex K run is limited to MSVC-flagged functions because it also flags `printf` and `strlen`. `validate` re-reads every cited line, checks that MSVC citations name the replacement, and re-runs clang-tidy, failing if its output no longer matches the data. The old hand-written `caution` field is rejected.
- `src/data.js` derives each function's `advisory.level` from its warnings: `avoid` (red "Not Recommended", faded, sorted last within a rank) when a standard calls it obsolescent or deprecated or says its behavior is undefined (the `ato*` functions), when the function is missing from a later standard that has a source ("Removed in C11" for `gets`), or when MSVC's "may be unsafe" and clang-tidy agree; otherwise `care` (amber "Use With Care", `$color-warning`) for any single source, such as `fopen` (MSVC only) or `memcpy` (clang-tidy only, which flags every non-Annex-K buffer function). The function page quotes each warning with its source, links named replacements that exist in the data, and links CWE IDs to MITRE.
- WDK: the `wdk-10.0.26100.0` source (kernel-mode headers, compiled with its `includes` and `defines`) covers `wdm.h` (914) and `ntddk.h` (248). Their prose comes from Microsoft's DDI docs (CC BY 4.0), sparse-cloned into git-ignored `sources/wdk-docs/` from MicrosoftDocs/windows-driver-docs-ddi; `scripts/wdk-prose.js <header> [--write]` fills each entry's summary, params, and returns from its `nf-<header>-<name>.md` page and records it in `docs`. Functions without a docs page are left out. Validate doesn't re-check this prose against the pages yet.
- Done: every clause 7 header with functions, 18 in all, including `stdbit.h` (70: five suffixed forms per section; the type-generic `stdc_*` forms are skipped because their `generic_value_type` is a placeholder).
- `scripts/prose.js` writes prose into a data file: it fills only empty fields and refuses to replace existing text unless given `--force`, and writes nothing if any entry is wrong (unknown function, wrong param count). `scripts/draft.js` holds the draft-reading regexes shared by `extract.js` and `validate.js`; its `draftSections` returns a function's Description and Returns text without footnotes, page noise, or EXAMPLE blocks.
- `validate` checks prose too: `params` must match the signature's parameters in count, order, and name, each with a description, and `returns.description` must mention every value the newest draft's Returns paragraph names (a returned null pointer as "null pointer" or `NULL`, `EOF`, `HUGE_VAL`, zero as "zero" or `0`, nonzero).
- `summary`, `params[].description`, and `returns.description` are prose. Paraphrase the draft's Description and Returns paragraphs; don't add behavior the draft doesn't state.

## Code style

Code follows Google's HTML/CSS Style Guide and Airbnb's JavaScript Style Guide, with QueryC's own rules taking precedence: no comments, `for...of` and `continue` allowed, 120-character lines, and Prettier owning formatting. Run `bun run lint`, `bun run validate`, and `bun run build` after every change; all three must pass.

No code comments anywhere in the project: HTML, SCSS, JS, or scripts. ESLint enforces this with the inline `queryc/no-comments` rule in `eslint.config.js`, and `scripts/check-comments.js` covers SCSS and HTML.

The user writes `README` (a plain-text file with an ASCII-art banner in figlet's colossal font; keep its spacing exact, and wrap all text at the banner's 57-column width) and makes all commits. The code is BSD-3-Clause (`LICENSE`); the logos and the WG14 drafts aren't covered by it. "Not Recommended" uses the `$color-danger` and `$color-danger-bg` tokens; flagged results fade by `$discouraged-opacity` (0.8 in light mode, 0.5 in dark) except for the red tag. Light-mode muted text is `#5c6166` (about 6:1 on white) so grey text stays readable. Hovering selects a result; leaving the list clears a mouse selection but keeps a keyboard one. Don't run git commands that change history or the index, and don't rewrite the README unless asked.

## Working in units

The user reviews the site one unit at a time. Build only the current unit, then stop for review before starting the next.

1. Scaffold: Vite, SCSS, and the base layout (done)
2. Data format: function entry schema, sample entries, a validation script (done)
3. Search: client-side search by name or header, filters for standard and compiler (done)
4. Function detail view, with linkable URLs (done)
5. Data extraction: scripts that pull declarations from real headers, one header at a time
6. Polish: keyboard navigation, regex and wildcard search, production build, final docs (done)
## Ideas (not started)

The user keeps future work here. Don't build any of it until the user picks it up.

- Rust and C++ indexing. Entries for Rust `std`, `core`, and `alloc` items and C++ `<...>` headers, covering overloads, feature gates, and versions per language (C++11 to C++26; Rust editions and stabilized versions). Keep the evidence model: C++ claims cite the working draft (N-numbers), Rust claims cite the `library/` source and its `#[stable(since = "...")]` attributes. The fixed C89 to C23 list becomes a per-language version list, with new fields for overload sets (C++) and feature gates, editions, and the std/core/alloc path (Rust). The header's C++ and Rust menu entries already say "Coming Soon".
- Caution kinds. Split warnings into kinds (today there are only two levels, `avoid` and `care`) so one red tag doesn't cover different problems, since memory-safe languages still have functions to avoid:

  | Kind | Meaning | Checkable against a file | Color |
  |---|---|---|---|
  | `removed` | Gone from the current standard (`gets`, `std::auto_ptr`) | Yes: absent from the newer draft | red |
  | `unsafe` | Undefined behavior if misused (`std::mem::transmute`, `std::env::set_var` in Rust 2024) | Yes: `unsafe fn` in the signature | red |
  | `deprecated` | Still present, slated for removal (`str::trim_left`, `std::uncaught_exception`) | Yes: `#[deprecated(since = ...)]`, or C++'s deprecation annex | amber |
  | `footgun` | Safe but easy to misuse (`Rc` cycles leak, `.unwrap()` panics, `strtok`'s hidden state) | No, editorial like C's flags today | grey |

  Design this together with the Rust and C++ schema.
