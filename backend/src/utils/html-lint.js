// parse5 - HTML parser that turns HTML into a traversable abstract syntax tree (AST) */
const parse5 = require("parse5");
// tags I want to block entirely
const BAD_TAGS = new Set(["script", "iframe", "object", "embed"]);
// any attribute starting with on (e.g. onclick) -> block
const ON_ATTR = /^on\w+/i;
// href="javascript:..." -> block
const JS_URL = /^javascript:/i;
// finds Mustache triple braces {{{ }}} (error, because unescaped HTML)
const TRIPLE = /{{{\s*[^}]+\s*}}}/;
// any http(s):// value (used to warn if allowRemote is false)
const REMOTE = /^https?:\/\//i;

// depth-first traversal helper
function walk(node, issues, allowRemote) {
  // if this node is an element (nodeName exists)
  if (node.nodeName) {
    // normalize its tag to lowercase
    const tag = node.nodeName.toLowerCase();
    // if it's in BAD_TAGS, record an error
    if (BAD_TAGS.has(tag)) issues.errors.push(`Disallowed <${tag}> tag`);

    // iterates over element attributes
    for (const a of node.attrs || []) {
      // any on* attribute -> error...
      if (ON_ATTR.test(a.name))
        issues.errors.push(`Disallowed attr "${a.name}" on <${tag}>`);
      // href="javascript:..." -> error
      if (a.name === "href" && JS_URL.test(a.value))
        issues.errors.push(`javascript: URL on <${tag}>`);
      // if allowRemote is false and attribute value looks remote (http(s)://) -> ERROR (SSRF risk)
      if (!allowRemote && REMOTE.test(a.value))
        issues.errors.push(`Remote URL not allowed (SSRF risk): ${a.name}="${a.value}"`);
    }
  }
  // recurses into all children to lint the whole tree
  for (const c of node.childNodes || []) walk(c, issues, allowRemote);
}

// quick check for print CSS
function hasPrintCss(html) {
  // looks for @page rule or a stylesheet/link with media="print"
  return /@page\b/.test(html) || /media\s*=\s*["']print["']/i.test(html);
}

/* public HTML linter used at upload time inside POST /api/upload route, after I detect the 
uploaded file is HTML */
function lintHtmlBuffer(
  buf,
  /* allowRemote (default false) -> if true, don't warn on remote URLs
  requirePrintCss (default false) -> if true, warn when no print CSS detected */
  { allowRemote = false, requirePrintCss = false } = {}
) {
  // converts the incoming Buffer to a UTF-8 string
  const html = buf.toString("utf-8");
  // prepares an issues accumulator with separate errors and warnings
  const issues = { errors: [], warnings: [] };
  // if the template uses Mustache triple braces (raw HTML insertion)
  if (TRIPLE.test(html))
    // add a error
    issues.errors.push("Disallowed {{{ triple braces }}} (unescaped HTML)");

  // parses HTML template into an AST with parse5
  const ast = parse5.parse(html);
  // walks the AST  tree to collect issues
  walk(ast, issues, allowRemote);
  // if print CSS is required and not found
  if (requirePrintCss && !hasPrintCss(html)) {
    // add a warning
    issues.warnings.push('No print CSS detected (@page or media="print").');
  }
  // returns issues to the caller
  return issues;
}

module.exports = { lintHtmlBuffer };
