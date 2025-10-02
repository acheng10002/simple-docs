/* test-controlled switches
shouldThrow - when true, the mock will simulate Docxtemplater throwing during render()
throwShape - lets me inject a specific error shape, so tests can verify different paths */
const state = { shouldThrow: false, throwShape: null };

/* using a class to more robust and closer to the real module's usage 
- constructor-like mock that matches how real docxtemplater is used (i.e. 
new Docxtemplater(zip, opts) */
class DocxMock {
  constructor() {}
  // simulates the templating pass
  render() {
    if (state.shouldThrow) {
      // if test flips state.shouldThrow, render() throws either the provided shape or a default
      throw state.throwShape || new Error("boom");
    }
  }
  // simulates exporting a final DOCX buffer
  getZip() {
    // just returns a fixed Buffer("DOCX_OUT")
    return { generate: () => Buffer.from("DOCX_OUT") };
  }
}
/* test helper my tests call to control the mock
- DocxMock._setBehavior(true, shape) -> next render() throws shape
- DocxMock._setBehavior(falsel) -> render() succeeds */
DocxMock._setBehavior = (s, shape = null) => {
  state.shouldThrow = s;
  state.throwShape = shape;
};

// test helper to bring the mock back to a clean state between tests
DocxMock._reset = () => {
  state.shouldThrow = false;
  state.throwShape = null;
};

// exports in a way that works for both CommonJS and ESM
module.exports = DocxMock;
module.exports.default = DocxMock;
module.exports._esModule = true;
