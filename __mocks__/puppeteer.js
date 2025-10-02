/* creates a Node Buffer containing bytes of a "fake PDF" i.e. a deterministic byte payload
to assert against */
const pdfBuffer = Buffer.from("PDF_FROM_PUPPETEER");

// simulates a Puppeteer Page
const pageMock = {
  // Jest spy that reutns a resolve Promise (the real page.setContent is async)
  setContent: jest.fn().mockResolvedValue(),
  // Jest spy that resolves to the pdfBuffer above (stands in for page.pdf() output)
  pdf: jest.fn().mockResolvedValue(pdfBuffer),
};

// simulates a Puppeteer Browser
const browserMock = {
  // newPage resolves to pageMock (like browser.newPage() would)
  newPage: jest.fn().mockResolvedValue(pageMock),
  // close is a no-op async method that resolves immediately
  close: jest.fn().mockResolvedValue(),
};

// exports the mock as a CommonJS module
module.exports = {
  // helps Jest interop with ESM default imports
  __esModule: true,
  // launch replaces puppeteer.launch(...) and returns the browserMock
  launch: jest.fn().mockResolvedValue(browserMock),
  // test helpers that I can import to make assertions
  _pageMock: pageMock,
  _browserMock: browserMock,
  _pdfBuffer: pdfBuffer,
};
