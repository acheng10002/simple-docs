/* parse5 - HTML parser that turns HTML into a traversable abstract syntax tree (AST) 
AST - tree-shaped, in-memory representation of source data (code, HTML, etc.) where each 
      node describes a construct  (FunctionDeclaration, IfStatement, Element, Attribute, etc.) 
      structured, visitable model of my text that makes safe, deterministic analysis and 
      rewrites possible
- linters, formatters, bundler, compiles, and code mods all walk the AST */
const parse5 = require("parse5");
// tags I want to block entirely
const BAD_TAGS = new Set(["script", "iframe", "object", "embed"]);
// any attribute starting with on (e.g. onclick) -> block
const ON_ATTR = /^on\w+/i;
// href="javascript:..." -> block
const JS_URL = /^javascript:/i;
// any http(s):// value (used to warn if allowRemote is false)
const REMOTE = /^https?:\/\//i;
// finds Mustache triple braces {{{ }}} (warn, because unescaped HTML)
const TRIPLE = /{{{\s*[^}]+\s*}}}/;

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
      /* any on* attribute -> error 
      - stops cross-site scripting/code execution
      -- the attribute itself can be executable code e.g. <img src=x onerror=...>
      - protects headless renderer, Puppeteer that does filled HTML -> PDF conversion (Mustache
        is templating engine for HTML -> filled HTML)
      -- any inline JS can run in Puppeteer - make network calls, loop forever, fingerprint
         the environment, or attempt server-side request forgery to internal services 
      --- fingerprint the environment - collecting unique or semi-unique characteristics of 
                                        a user's runtime or system to id, profile, or track it
      - keeps templates "presentation-only" 
      -- ensures event logic doesn't go in mergeable content 
      - avoids weird layout side-effects - page-load/onerror handlers can mutate the DOM or
        styles at render time, producing nondeterministic PDFs */
      if (ON_ATTR.test(a.name))
        issues.errors.push(`Disallowed attr "${a.name}" on <${tag}>`);
      /* href="javascript:..." -> error 
      - javascript:links execute code when followed
      - if any merged value can land in an href, an attack could turn a harmless link into 
        inline JS execution by injecting attacker-controlled data 
      -- then when the user or my header browser clicks that link, attacker JS gets executed 
         instead of navigating 
      - with Puppeteer, href="javascript:links" can still fire via synthetic clicks or scripts
        causing XSS, data exfiltration, infinite loops, or SSRF attempts 
      -- data exfilration - someone or something leaks my data to somewhere it shouldn't go */
      if (a.name === "href" && JS_URL.test(a.value))
        issues.errors.push(`javascript: URL on <${tag}>`);
      /* if allowRemote is false and attribute value looks remote (http(s)://) -> warning 
      - determinimsm & uptime - remote assets make renders non-reproducible and fragile
      - latency & timeouts - network fetches slow down or break rendering pipelines
      - data leakage - requests include IP< user-agent, referrer; can leak PII in query strings 
      - policy/compliance - many orgs disallow outbound calls from renderers; mimed content is 
        even riskier
      - supply-chain risk - third-party content can be swapped or compromised 
      - warn, allow a whitelist, and prefer inlining critical assets or vendoring them locally */
      if (!allowRemote && REMOTE.test(a.value))
        issues.warnings.push(`Remote ref: ${a.name}="${a.value}"`);
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
  /* if the template uses Mustache triple braces (raw HTML insertion) 
  - triple braces inserts raw HTML 
  - raw HTML + attacker-controlled data = XSS/markup injection 
  -- user can smuggle <img onerror=…> or href="javascript:…" 
  - raw HTML can break layouts or styles, making output unpredictable */
  if (TRIPLE.test(html))
    // add a error
    issues.errors.push("Disallowed {{{ triple braces }}} (unescaped HTML)");

  // parse HTML template into an AST with parse5
  const ast = parse5.parse(html);
  // walk the AST  tree to collect issues
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

/* DNS resolution - process of turning a human-friendly hostname, like api.example.com, into the IP
                    addresses my computer needs to connect to
XSS - an attacker gets their JavaScript to run in a victim's browser on my site
example: 
Template (HTML)
<p>Click to view your profile:</p>
<a href="{{profileUrl}}">View Profile</a>

Attacker-controlled data (e.g., from CSV/JSON)
{
  "profileUrl": "javascript:alert('pwned')"
}

After merge (what your renderer sends to the browser/puppeteer)
<p>Click to view your profile:</p>
<a href="javascript:alert('pwned')">View Profile</a>

SSRF - an attacker tricks my server into making HTTP requests to a URL they control or to internal
       endpoints they shouldn't reach
       - the request originates from my trusted network, so the request can hit localhost, VPC-only 
         () services, or cloud metadata endpoints
example:
Buggy endpoint:
// GET /fetch?url=https://example.com
app.get('/fetch', async (req, res) => {
  const r = await fetch(req.query.url);  // ❌ unvalidated
  res.send(await r.text());
});

Attack requests:
# Hit internal admin panel
GET /fetch?url=http://127.0.0.1:8080/admin

# Steal cloud creds (classic)
GET /fetch?url=http://169.254.169.254/latest/meta-data/iam/security-credentials/
*/
