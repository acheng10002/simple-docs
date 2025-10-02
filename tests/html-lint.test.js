// *** UNIT TESTS FOR LINTHTMLBUFFER() ERROR/WARNING COVERAGE
const { lintHtmlBuffer } = require("../html-lint");

// starts a Jest test suite
describe("html-lint", () => {
  // *** DISALLOWED TAGS AND ON* ATTRIBUTES
  test("flags disallowed tags and on* attributes", () => {
    /* builds a UTF-8 Buffer containing HTML that includes a script tag and an inline event handler.
    onerror, both should be blocked */
    const html = Buffer.from(
      `
            <html><body>
                <script>alert(1)</script>
                <img src="x" onerror="steal()">
            </body></html>
        `,
      "utf8"
    );

    // runs the linter and destructures its { errors, warnings } result
    const { errors, warnings } = lintHtmlBuffer(html);
    // asserts that errors include in any order the two error messages
    expect(errors).toEqual(
      // lets the array have at least these items
      expect.arrayContaining([
        "Disallowed <script> tag",
        'Disallowed attr "onerror" on <img>',
      ])
    );
    // no warnings expected in this case
    expect(warnings).toEqual([]);
  });

  // *** JAVASCRIPT: URL AND REMOTE REF
  test("flags javascript: links and remote refs when allowRemote=false", () => {
    /* constructs HTML with an anchor using a javascript: URL (error) and an image sourced from a
    remote URL (warning if remote references are not allowed) */
    const html = Buffer.from(
      `<html><body>
            <a href="javascript:void(0)">bad</a>
            <img src="https://cdn.example.com/p.png">
        </body></html>
      `,
      "utf8"
    );

    // calls linter with allowRemote: false...
    const { errors, warnings } = lintHtmlBuffer(html, { allowRemote: false });
    // checks that javascript:URL was flagged as an error
    expect(errors).toEqual(expect.arrayContaining(["javascript: URL on <a>"]));
    // remote URLs should trigger warnings, checks that the remote src produced a warning
    expect(warnings).toEqual(
      expect.arrayContaining([
        'Remote ref: src="https://cdn.example.com/p.png"',
      ])
    );
  });

  // *** MISSING PRINT CSS WARNING
  test("warns when requirePrintCss=true and no print CSS present", () => {
    // simple HTML without any print=specific CSS
    const html = Buffer.from(
      `<html><head></head><body>hi</body></html>`,
      "utf8"
    );
    const { errors, warnings } = lintHtmlBuffer(html, {
      // asks the linter to require print CSS, so if it's missing, there should be a warning
      requirePrintCss: true,
    });
    // no errors are expected
    expect(errors).toHaveLength(0);
    // a warning is expected, verifying the missing-print-CSS warning appears
    expect(warnings).toEqual(
      expect.arrayContaining([
        'No print CSS detected (@page or media="print").',
      ])
    );
  });

  // TRIPLE-BRACE ERRORS
  test("errors on Mustache triple braces", () => {
    // HTML that uses Mustache triple braces, an unescaped HTML injection risk
    const html = Buffer.from(
      `<html><body>{{{ rawHtml }}}</body></html>`,
      "utf8"
    );
    // runs the linter
    const { errors } = lintHtmlBuffer(html);
    // assert it's treated as an error
    expect(errors).toEqual(
      expect.arrayContaining([
        "Disallowed {{{ triple braces }}} (unescaped HTML)",
      ])
    );
  });
});

// KEY LIB: JEST
