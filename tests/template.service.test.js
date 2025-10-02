/* tells Jest to replace ../prisma with my mock module in ../_mocks_/prisma 
- uses a manual mock factory - whatever the require returns becomes the mocked module */
jest.mock("../prisma", () => require("../__mocks__/prisma"));
// imports the mocked Prism client, because of the jest.mock above
const prisma = require("../prisma");

// Node's promises fs API
const fs = require("fs/promises");
/* tells Jest to auto-mock it 
- functions like fs.stat are Jest mock functions, I can do mockResolvedValue / mockRejectedValue */
jest.mock("fs/promises");

// absolute path for uploads directory
const { UPLOADS_DIR } = require("../paths");
// Node's path utilities (e.g. path.join)
const path = require("path");

// functions under tests from my service module
const {
  resolveTemplateFile,
  extractTextFromBuffer,
  extractPlaceholders,
} = require("../template.service");

// starts a Jest test suite
describe("template.service", () => {
  beforeEach(() => {
    /* clears call history and restores default mock implementations for all mocks
    - makes for good test hygiene between tests */
    jest.resetAllMocks();
  });

  test("extractPlaceholders dedupes and parses dot paths", () => {
    // feeds sample text extractPlaceholders
    const text = "Hello {{name}} and {{client.name}} and {{ name }}";
    const fields = extractPlaceholders(text);
    /* asserts it trims whitespace in tags, deduplicates, preserves dot paths like client.name, 
    and returns exactly those two fields (.sort() is order-insensitive) */
    expect(fields.sort()).toEqual(["client.name", "name"]);
  });

  test("extractTextFromBuffer for HTML returns body text", async () => {
    /* creates a UTF-8 Buffer for HTML and calls extractTextFromBuffer with MIME text/html
    UTF-8 - encodes text as bytes, character encoding that maps every Unicode character to 1-4 bytes
            backward-compatible with ASCII 
            is the default encoding for the web and most APIs/file today 
    Base64 - encodes bytes as ASCII-only text, binary-to-text encoding
             takes arbitrary bytes and represents them using only 64 safe characters 
             it's for transporting/burying binary data in places that only accept text */
    const html = Buffer.from(
      `<html><body><p>hi <b>there</b></p></body></html>`,
      "utf8"
    );
    const text = await extractTextFromBuffer(html, "text/html");
    /* expects body text to flattent o something containing "hi there" 
    - HTML parsers normalize whitespace */
    expect(text).toContain("hi there");
  });

  test("resolveTemplateFile returns metadata when file exists", async () => {
    // mocks the db call to return a template record
    const tpl = { id: "t1", name: "1712345678901-sample.html" };
    prisma.template.findUnique.mockResolvedValue(tpl);
    const abs = path.join(UPLOADS_DIR, tpl.name);
    // mocks fs.stat to pretend the file exists and has size 123
    fs.stat.mockResolvedValue({ size: 123 });
    // calls resolveTemplateFile and asserts the returned bundle has...
    const info = await resolveTemplateFile("t1");
    // correct absolute path
    expect(info.absPath).toBe(abs);
    // file stats
    expect(info.stat.size).toBe(123);
    // timestamp-stripped download name (i.e. sample.html)
    expect(info.downloadName).toBe("sample.html");
    // content type inferred from extension
    expect(info.contentType).toBe("text/html");
  });

  test("resolveTemplateFile marks missing when file not on disk", async () => {
    // mocks dv to return a template row
    const tpl = { id: "t2", name: "1700000000000-sample.docx" };
    prisma.template.findUnique.mockResolvedValue(tpl);
    // but fs.stat rejects (file not found)
    fs.stat.mockRejectedValue(Object.assign(new Error("nope")));

    const info = await resolveTemplateFile("t2");
    /* asserts the function returns a sentinel { tpl, missing: true } so callers can 
    send a precise 404 message */
    expect(info).toEqual({ tpl, missing: true });
  });
});
