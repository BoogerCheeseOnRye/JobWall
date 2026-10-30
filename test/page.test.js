// The page and the code have to agree: every id app.js reaches for must exist in
// index.html, and nothing in the markup may reference a file that is not there.
// These are the failures that render as a blank page with no error anywhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const docs = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const read = (name) => readFile(join(docs, name), 'utf8');

const VOID = new Set(['meta', 'link', 'br', 'hr', 'img', 'input', 'source', 'area', 'base', 'col', 'embed', 'param', 'track', 'wbr']);

test('index.html is well formed', async () => {
  const html = (await read('index.html')).replace(/<!--[\s\S]*?-->/g, '');
  const stack = [];
  // Quoted attribute values are matched as units, so the inline SVG favicon --
  // which is a data: URI full of real angle brackets -- is read as one attribute
  // instead of a stack of elements that never close.
  const TAG = /<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  for (const tag of html.matchAll(TAG)) {
    const [, closing, name, attrs] = tag;
    const selfClose = attrs.trimEnd().endsWith('/');
    const lower = name.toLowerCase();
    if (VOID.has(lower) || selfClose) continue;
    if (closing) {
      assert.equal(stack.pop(), lower, `</${lower}> does not close the element it appears to close`);
    } else stack.push(lower);
  }
  assert.deepEqual(stack, [], 'every element is closed');
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /<title>[^<]{8,}<\/title>/, 'the page has a real title');
});

test('every id app.js looks up is in the markup', async () => {
  const html = await read('index.html');
  const app = await read('app.js');
  const inPage = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const wanted = new Set([...app.matchAll(/\$\('#([\w-]+)'\)/g)].map((m) => m[1]));
  const missing = [...wanted].filter((id) => !inPage.has(id));
  assert.deepEqual(missing, [], `app.js queries ids that do not exist: ${missing.join(', ')}`);
  assert.ok(wanted.size > 10, `only found ${wanted.size} lookups -- the pattern probably changed`);
});

test('every element app.js listens on exists too', async () => {
  const html = await read('index.html');
  const app = await read('app.js');
  for (const [, sel] of app.matchAll(/\$\$?\('([\w-]+)'\)\.addEventListener/g)) {
    assert.match(html, new RegExp(`id="${sel}"`), `app.js listens on #${sel}, which is not in the page`);
  }
});

test('the markup only references files that exist', async () => {
  const html = await read('index.html');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((href) => !/^(https?:|data:|#|mailto:)/.test(href));
  assert.ok(refs.length >= 2, `found only ${refs.length} local references`);
  for (const ref of refs) {
    const body = await readFile(join(docs, ref.split('?')[0]), 'utf8');
    assert.ok(body.length > 0, `${ref} is empty`);
  }
});

test('the stylesheet has no rule with an empty or unclosed block', async () => {
  const css = await read('style.css');
  assert.equal(css.split('{').length, css.split('}').length, 'braces balance');
  assert.ok(!/:\s*;/.test(css), 'no empty declarations');
  // Every class the markup uses should exist somewhere in the stylesheet, or the
  // design silently does nothing.
  const html = await read('index.html');
  const app = await read('app.js');
  // Only real class names: a template literal or an attribute value picked up
  // along the way is not something the stylesheet can be expected to declare.
  const NAME = /^[a-z][a-z0-9-]*$/;
  const used = new Set();
  for (const source of [html, app]) {
    for (const [, cls] of source.matchAll(/class="([^"]+)"/g)) {
      for (const name of cls.split(/\s+/)) if (NAME.test(name)) used.add(name);
    }
  }
  const appClasses = [...app.matchAll(/class="([^"]*)"/g)]
    .map((m) => m[1].replace(/\$\{[^}]*\}/g, ' '))
    .filter((group) => !group.includes('<'));
  for (const name of used) {
    if (appClasses.some((group) => group.split(/\s+/).includes(name))) continue;
    assert.ok(new RegExp(`\\.${name.replace(/[-]/g, '\\-')}[\\s,{:>\\[]`).test(css), `class .${name} is used but never styled`);
  }
});

test('the two entry paths are both real forms with their own submit button', async () => {
  const html = await read('index.html');
  assert.match(html, /<form id="form"[^>]*>[\s\S]*?id="url"[\s\S]*?id="go"/);
  assert.match(html, /<form id="form-resume"[^>]*>[\s\S]*?id="resume"[\s\S]*?id="go-resume"/);
  // The file input has to accept what the reader can actually parse.
  const accept = /id="resume"[^>]*accept="([^"]+)"/.exec(html);
  assert.ok(accept, 'the file input declares what it accepts');
  for (const ext of ['.pdf', '.docx', '.txt', '.md']) {
    assert.ok(accept[1].includes(ext), `the input does not accept ${ext}`);
  }
});

test('the export card exists and starts hidden until there is a subject', async () => {
  const html = await read('index.html');
  assert.match(html, /<section class="card" id="export-section" hidden>/);
  assert.match(html, /id="export"/);
  assert.match(html, /id="export-empty"[^>]*>Load a profile[\s\S]*?working draft résumé/, 'the empty state says the preview prints');
});

test('the page says what it does without a recruiter in the copy', async () => {
  const html = await read('index.html');
  assert.match(html, /<p class="lede">[\s\S]{80,}?<\/p>/, 'the lede is a real paragraph');
  const lede = /<p class="lede">([\s\S]*?)<\/p>/.exec(html)[1].replace(/\s+/g, ' ').trim();
  assert.ok(lede.length <= 240, `the lede runs ${lede.length} characters -- too long to read`);
  assert.match(html, /id="url-hint"/);
  assert.match(html, /id="resume-hint"/);
  // Nothing should claim the file is uploaded when it is not.
  assert.match(html, /never uploaded|Never uploaded/, 'the privacy claim is on the page');
});

test('the print stylesheet prints the sheet alone, with no blank page', async () => {
  const css = await read('style.css');
  const block = /@media print \{([\s\S]*?)\n\}/.exec(css);
  assert.ok(block, 'the print rules exist');
  const print = block[1];

  // Hiding the cockpit with visibility alone leaves its height in the layout,
  // which pushed a blank second page after the sheet. Everything that is not
  // the preview, its descendants, or its ancestors must leave the flow.
  assert.match(print, /body \*:not\(#export-preview\):not\(#export-preview \*\):not\(:has\(#export-preview\)\)\s*\{[\s\S]*?display:\s*none !important/);
  assert.ok(!/body \* \{ visibility: hidden !important; \}/.test(print), 'no blanket visibility hide');
  assert.ok(!/#export-preview \{[\s\S]*?position: absolute/.test(print), 'the sheet stays in flow');

  // A résumé can run longer than one page; a section that refuses to break
  // jumps wholesale to page 2 and leaves page 1 almost empty.
  assert.match(print, /\.paper-section \{ break-inside: auto; \}/);
  assert.match(print, /\.paper-entry[^{]*\{ break-inside: avoid; \}/);
});
