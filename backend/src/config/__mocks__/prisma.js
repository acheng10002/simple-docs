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
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  templateVersion: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
  },
  field: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
  folder: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  mergeJob: {
    create: jest.fn(),
  },
  $disconnect: jest.fn(),
};
