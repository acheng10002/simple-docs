/* mocks docxtemplater to control render behavior
- replaces the real docxtemplater module with a manual mock from __mocks__/docxtemplater.js 
- Jest hoists jest.mock() so the mock is actibe before any require()s run */
jest.mock("docxtemplater");
// loads the mocked module
const Raw = require("docxtemplater");
/* if the mock set module.exports.default = DocxMock (ESM-style) use Raw.default 
if the mock is exported directly, module.exports = DocxMock, use Raw 
- Docxtemplater becomes the constructor my code under test expects to new */
const Docxtemplater = Raw.default || Raw;

/* replaces pizzip with my manual mock in __mocks__/pizzip.js so new PizZip(...) won't touch 
real ZIP logic */
jest.mock("pizzip");

/* now I can test error handling and success paths without needing real DOCX files or the real 
library; loads the system under test 
- pulls in functions I'm testing from my implementation */
const {
  lintDocxBuffer,
  renderDocxBufferOrThrow,
  TemplateParseError,
} = require("../docx-templating");

beforeEach(() => {
  /* pre-test cleanup using a helper I attached to the mock 
  - resets internal flags like shouldThrow/throw Shape so each test starts from a clean, 
    predictable baseline */
  Docxtemplater._reset();
});

// lintDocxBuffer test ensures my lint path maps Docxtemplater errors into arrays of details
test("lintDocxBuffer returns [] when render succeeds", () => {
  const buf = Buffer.from("fake-docx");
  // calls lintDocxBuffer with a fake "docx" buffer
  const out = lintDocxBuffer(buf);
  /* shouldThrow is false, so mock .render() does nothing -> linter treats it as a valid template
    and returns [] */
  expect(out).toEqual([]);
});

test("lintDocxBuffer maps Docxtemplater error details", () => {
  /* forces the mock to throw a Docxtemplater-shaped error with properties and an errors array */
  Docxtemplater._setBehavior(true, {
    properties: {
      id: "duplicate_open_tag",
      explanation: "Duplicate open tag",
      xtag: "{{ name",
      file: "word/document.xml",
      offset: 42,
      errors: [
        {
          properties: {
            id: "duplicate_open_tag",
            explanation: "Duplicate open tag",
            xtag: "{{ name",
            file: "word/document.xml",
            offset: 42,
          },
        },
      ],
    },
  });

  const buf = Buffer.from("fake-docx");
  // lintDocxBuffer catches the Docxtemplater-shaped error
  const out = lintDocxBuffer(buf);
  // assertion checks that the error is normalized into a compact array of detail objects
  expect(out).toEqual([
    {
      id: "duplicate_open_tag",
      explanation: "Duplicate open tag",
      xtag: "{{ name",
      file: "word/document.xml",
      offset: 42,
    },
  ]);
});

/* renderDocxBufferOrThrow tests ensures my render path throws TemplateParseError for template 
  issues and rethrows non-template errors untouched */
test("renderDocxBufferOrThrow surfaces non-docxtemplater errors", () => {
  // simulates an error that doesn't look like a Docxtemplater parse error
  Docxtemplater._setBehavior(true, new Error("random-io-error"));
  const buf = Buffer.from("fake-docx");
  /* the error should not be wrapped as TemplateParseError, it should bubble as-is */
  expect(() => renderDocxBufferOrThrow(buf, {})).toThrow("random-io-error");
});

test("TemplateParseError is thrown for templating issues", () => {
  Docxtemplater._setBehavior(true, {
    properties: {
      id: "undefined_tag",
      explanation: "Tag is undefined",
    },
  });
  const buf = Buffer.from("fake-docx");
  try {
    // renderDocBufferOrThrow should detect isDocxError
    renderDocxBufferOrThrow(buf, {});
    throw new Error("should have thrown");
  } catch (e) {
    /* should throw my TemplateParseError with the canonical message 
      - test verifies the error type and message */
    expect(e).toBeInstanceOf(TemplateParseError);
    expect(e.message).toBe("TEMPLATE_PARSE_ERROR");
  }
});
