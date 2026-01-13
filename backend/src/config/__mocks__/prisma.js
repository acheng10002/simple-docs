/* Mock Prisma client for testing local config/prisma imports
- used when modules require("../config/prisma") */

module.exports = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  template: {
    findUnique: jest.fn(),
  },
  mergeJob: {
    create: jest.fn(),
  },
  $disconnect: jest.fn(),
};
