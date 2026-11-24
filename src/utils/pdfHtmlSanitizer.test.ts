import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPdfSafeBaseCss,
  extractFontFaceCssFromRules,
  rewriteCssUrls,
  shouldIgnorePdfCloneElement,
} from './pdfHtmlSanitizer';

test('rewriteCssUrls resolves relative font paths against stylesheet URL', () => {
  const css =
    "@font-face { font-family: 'Cairo'; src: url(./cairo-arabic-400-normal-abc.woff2) format('woff2'), url('../fonts/cairo.woff') format('woff'); }";
  const resolved = rewriteCssUrls(css, 'https://dst.example.com/assets/index-123.css');

  assert.ok(
    resolved.includes('url("https://dst.example.com/assets/cairo-arabic-400-normal-abc.woff2")'),
  );
  assert.ok(
    resolved.includes("url('https://dst.example.com/fonts/cairo.woff')"),
  );
});

test('rewriteCssUrls preserves absolute, data, and blob URLs unchanged', () => {
  const css =
    "src: url(https://cdn.example.com/font.woff2), url('data:font/woff2;base64,AAAA'), url(blob:https://dst.example.com/123);";
  const resolved = rewriteCssUrls(css, 'https://dst.example.com/assets/index.css');
  assert.equal(resolved, css);
});

test('extractFontFaceCssFromRules keeps only @font-face rules and strips Tailwind oklch/oklab rules', () => {
  const css = extractFontFaceCssFromRules(
    [
      {
        href: 'https://dst.example.com/assets/index-xyz.css',
        rules: [
          {
            type: 1,
            cssText: ':root { --color-slate-50: oklch(0.984 0.003 247.858); }',
          },
          {
            type: 1,
            cssText: '*, ::before, ::after { border-color: color-mix(in oklab, #000 10%, transparent); }',
          },
          {
            type: 5,
            cssText:
              "@font-face { font-family: 'IBM Plex Sans Arabic'; font-weight: 400; src: url(./ibm-plex-sans-arabic-400.woff2) format('woff2'); }",
          },
          {
            type: 1,
            cssText: '.dark body { background-color: oklch(0.129 0.042 264.695); }',
          },
          {
            // Fallback detection when type is omitted
            cssText:
              "@font-face { font-family: 'Cairo'; font-weight: 700; src: url(/assets/cairo-700.woff2) format('woff2'); }",
          },
        ],
      },
    ],
    'https://dst.example.com/',
  );

  assert.ok(css.includes("font-family: 'IBM Plex Sans Arabic'"));
  assert.ok(css.includes('https://dst.example.com/assets/ibm-plex-sans-arabic-400.woff2'));
  assert.ok(css.includes("font-family: 'Cairo'"));
  assert.ok(css.includes('https://dst.example.com/assets/cairo-700.woff2'));
  assert.equal(/oklch|oklab|color-mix|\.dark/i.test(css), false);
});

test('buildPdfSafeBaseCss emits RTL hex-only reset CSS with zero CSS Color 4 functions', () => {
  const safeCss = buildPdfSafeBaseCss(
    "@font-face { font-family: 'Cairo'; src: url(\"https://dst.example.com/assets/cairo.woff2\"); }",
  );

  assert.ok(safeCss.includes('@font-face'));
  assert.ok(safeCss.includes('direction: rtl !important;'));
  assert.ok(safeCss.includes('background: #ffffff !important;'));
  assert.ok(safeCss.includes('color: #000000 !important;'));
  assert.equal(/oklch|oklab|color-mix|lch\(|lab\(/i.test(safeCss), false);
});

test('shouldIgnorePdfCloneElement ignores styles, stylesheets, scripts, and body siblings while keeping PDF container', () => {
  const makeEl = (
    tagName: string,
    opts?: {
      attrs?: Record<string, string>;
      parentTag?: string;
      children?: Element[];
    },
  ): Element => {
    const children = opts?.children ?? [];
    const el = {
      tagName,
      parentElement: opts?.parentTag ? { tagName: opts.parentTag } : null,
      getAttribute: (name: string) => opts?.attrs?.[name] ?? null,
      contains: (other: Element) => other === el || children.includes(other),
    };
    return el as unknown as Element;
  };

  const tableEl = makeEl('TABLE');
  const pdfContainer = makeEl('DIV', { parentTag: 'BODY', children: [tableEl] }) as unknown as HTMLElement;
  const appRoot = makeEl('DIV', { parentTag: 'BODY' });
  const styleEl = makeEl('STYLE', { parentTag: 'HEAD' });
  const linkCss = makeEl('LINK', { parentTag: 'HEAD', attrs: { rel: 'stylesheet' } });
  const linkIcon = makeEl('LINK', { parentTag: 'HEAD', attrs: { rel: 'icon' } });
  const scriptEl = makeEl('SCRIPT', { parentTag: 'BODY' });
  const htmlEl = makeEl('HTML');
  const headEl = makeEl('HEAD');
  const bodyEl = makeEl('BODY');

  assert.equal(shouldIgnorePdfCloneElement(pdfContainer, pdfContainer), false);
  assert.equal(shouldIgnorePdfCloneElement(tableEl, pdfContainer), false);
  assert.equal(shouldIgnorePdfCloneElement(htmlEl, pdfContainer), false);
  assert.equal(shouldIgnorePdfCloneElement(headEl, pdfContainer), false);
  assert.equal(shouldIgnorePdfCloneElement(bodyEl, pdfContainer), false);
  assert.equal(shouldIgnorePdfCloneElement(linkIcon, pdfContainer), false);

  assert.equal(shouldIgnorePdfCloneElement(styleEl, pdfContainer), true);
  assert.equal(shouldIgnorePdfCloneElement(linkCss, pdfContainer), true);
  assert.equal(shouldIgnorePdfCloneElement(scriptEl, pdfContainer), true);
  assert.equal(shouldIgnorePdfCloneElement(appRoot, pdfContainer), true);
});
