/* mocks the real pizzip package with a constructor-shaped API, so code that does
new PizZip(...) keeps working */
class PizZip {
  // I don't need any real behavior, just something I can instantiate
  constructor() {}
}
module.exports = PizZip;
module.exports.default = PizZip;
module.exports._esModule = true;
