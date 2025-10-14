/* DEV DEP - TESTING: JEST
basic Jest config so Node-style CJS works cleanly */
module.exports = {
  // tells Jest to run tests in a Node environment, no browser APIs like window/document
  testEnvironment: "node",
  // limits where Jest looks for tests to the tests folder at project root
  roots: ["<rootDir>", "<rootDir>/tests"],
  // when resolving import/require, Jest will consider files with these extensions
  moduleFileExtensions: ["js", "json"],
  /* after each test, restores spied-on functions to their original implementation 
  - like calling jest.restoreMocks() automatically
  - great for jest.spyOn() clean-up, puts the real method back */
  restoreMocks: true,
  /* after each test, clears usage data/history from mocks/spies 
  - like jest.clearAllMocks() automatically, wipes call history */
  clearMocks: true,
  // after each test, resets mock implementations to their initial, default state
  resetMocks: false,
  /* above three mock flags make each test start with a clean state 
  - no leaks calls or stubbed behavior from prior tests */
};
