export interface CssRuleLike {
  type?: number;
  cssText: string;
}

export interface StyleSheetLike {
  href?: string | null;
  rules: ReadonlyArray<CssRuleLike>;
}

const FONT_FACE_RULE_TYPE = 5; // CSSRule.FONT_FACE_RULE
const CSS_URL_PATTERN = /url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi;

/**
 * Rewrites relative CSS `url(...)` references against `baseUrl` so copied
 * `@font-face` rules resolve their font files accurately even when moved from
 * `/assets/index-*.css` into an inline `<style>` tag inside an isolated iframe.
 */
export function rewriteCssUrls(cssText: string, baseUrl: string): string {
  if (!cssText || !baseUrl) return cssText;
  return cssText.replace(CSS_URL_PATTERN, (match, quote: string, rawPath: string) => {
    const trimmed = rawPath.trim();
    if (
      !trimmed ||
      trimmed.startsWith('data:') ||
      trimmed.startsWith('blob:') ||
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('#')
    ) {
      return match;
    }
    try {
      const resolved = new URL(trimmed, baseUrl).href;
      const q = quote || '"';
      return `url(${q}${resolved}${q})`;
    } catch {
      return match;
    }
  });
}

/**
 * Extracts only `@font-face` rules from stylesheets, completely discarding
 * Tailwind CSS v4 rules (which use `oklch()` / `oklab()` / `color-mix()` that
 * crash html2canvas v1.4.1).
 */
export function extractFontFaceCssFromRules(
  sheets: ReadonlyArray<StyleSheetLike>,
  fallbackBaseUrl: string,
): string {
  const collected: string[] = [];
  for (const sheet of sheets) {
    const baseUrl = sheet.href || fallbackBaseUrl;
    for (const rule of sheet.rules) {
      const text = rule.cssText?.trim();
      if (!text) continue;
      const isFontFace =
        rule.type === FONT_FACE_RULE_TYPE || /^\s*@font-face\b/i.test(text);
      if (!isFontFace) continue;
      collected.push(rewriteCssUrls(text, baseUrl));
    }
  }
  return collected.join('\n');
}

/**
 * Builds an isolated, hex-only CSS block for the cloned PDF capture document.
 * Preserves local Arabic `@font-face` rules while guaranteeing zero CSS Color 4
 * functions (`oklch`, `oklab`, `color-mix`) and zero dark-mode leakage.
 */
export function buildPdfSafeBaseCss(fontFaceCss: string): string {
  const resetCss = [
    'html, body {',
    '  margin: 0 !important;',
    '  padding: 0 !important;',
    '  background: #ffffff !important;',
    '  color: #000000 !important;',
    '  direction: rtl !important;',
    "  font-family: 'IBM Plex Sans Arabic', 'Cairo', system-ui, sans-serif !important;",
    '  -webkit-font-smoothing: antialiased;',
    '}',
    '*, *::before, *::after {',
    '  box-sizing: border-box !important;',
    '  border-color: #000000;',
    '  outline-color: #000000;',
    '}',
    'table {',
    '  border-collapse: collapse !important;',
    '}',
  ].join('\n');

  return fontFaceCss ? `${fontFaceCss}\n${resetCss}` : resetCss;
}

/**
 * Reads all accessible `@font-face` rules from the active browser document.
 * Cross-origin stylesheets that throw SecurityError are safely skipped.
 */
export function collectDocumentFontFaceCss(doc: Document): string {
  const sheets: StyleSheetLike[] = [];
  const fallbackBaseUrl =
    doc.baseURI || (typeof window !== 'undefined' ? window.location.href : 'http://localhost/');

  for (const styleSheet of Array.from(doc.styleSheets || [])) {
    try {
      const cssRules = styleSheet.cssRules;
      if (!cssRules) continue;
      const rules: CssRuleLike[] = [];
      for (const rule of Array.from(cssRules)) {
        rules.push({ type: rule.type, cssText: rule.cssText });
      }
      sheets.push({ href: styleSheet.href, rules });
    } catch {
      // Ignore cross-origin stylesheets that disallow cssRules inspection.
    }
  }

  return extractFontFaceCssFromRules(sheets, fallbackBaseUrl);
}

/**
 * Filter predicate for html2canvas `ignoreElements`.
 * Prevents Tailwind `<style>` / `<link rel="stylesheet">` tags, scripts, and
 * unrelated app DOM nodes outside the PDF container from being cloned.
 */
export function shouldIgnorePdfCloneElement(
  element: Element,
  pdfContainer: HTMLElement,
): boolean {
  if (element === pdfContainer || pdfContainer.contains(element)) {
    return false;
  }
  const tag = element.tagName.toUpperCase();
  if (tag === 'HTML' || tag === 'HEAD' || tag === 'BODY') {
    return false;
  }
  if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'NOSCRIPT') {
    return true;
  }
  if (tag === 'LINK') {
    const rel = (element.getAttribute('rel') || '').toLowerCase();
    const asAttr = (element.getAttribute('as') || '').toLowerCase();
    if (rel.includes('stylesheet') || asAttr === 'style') {
      return true;
    }
  }
  // Ignore all other top-level body siblings (e.g., #root, modals, toasts)
  if (element.parentElement?.tagName.toUpperCase() === 'BODY') {
    return true;
  }
  return false;
}

/**
 * Sanitizes html2canvas's cloned iframe document so only the PDF container and
 * pure hex + `@font-face` CSS are present before layout and color parsing run.
 */
export function sanitizeClonedPdfDocument(
  clonedDoc: Document,
  clonedContainer: HTMLElement | null,
  safeCss: string,
): Promise<unknown> | void {
  // Remove any remaining stylesheets that could inject oklch/oklab/color-mix
  clonedDoc
    .querySelectorAll('style, link[rel="stylesheet"], link[as="style"]')
    .forEach((node) => node.remove());

  // Strip Tailwind / dark-mode classes from <html> and <body>
  const htmlEl = clonedDoc.documentElement;
  if (htmlEl) {
    htmlEl.removeAttribute('class');
    htmlEl.removeAttribute('style');
    htmlEl.setAttribute('dir', 'rtl');
    htmlEl.setAttribute('lang', 'ar');
    htmlEl.style.background = '#ffffff';
    htmlEl.style.color = '#000000';
    htmlEl.style.margin = '0';
    htmlEl.style.padding = '0';
  }

  const bodyEl = clonedDoc.body;
  if (bodyEl) {
    bodyEl.removeAttribute('class');
    bodyEl.removeAttribute('style');
    bodyEl.style.background = '#ffffff';
    bodyEl.style.color = '#000000';
    bodyEl.style.margin = '0';
    bodyEl.style.padding = '0';

    if (clonedContainer) {
      for (const child of Array.from(bodyEl.children)) {
        if (child !== clonedContainer) {
          child.remove();
        }
      }
    }
  }

  // Place cloned container cleanly at (0, 0) so no off-screen/scroll clipping occurs
  if (clonedContainer) {
    clonedContainer.style.position = 'static';
    clonedContainer.style.left = '0';
    clonedContainer.style.top = '0';
    clonedContainer.style.margin = '0';
  }

  const headEl = clonedDoc.head || htmlEl;
  if (headEl) {
    const styleEl = clonedDoc.createElement('style');
    styleEl.setAttribute('data-dst-pdf-safe', 'true');
    styleEl.textContent = safeCss;
    headEl.appendChild(styleEl);
  }

  // Wait for cloned iframe fonts to settle before html2canvas measures & paints
  if (clonedDoc.fonts && clonedDoc.fonts.ready) {
    return clonedDoc.fonts.ready;
  }
}
