/* global, simple prisma mock I can customize inside tests via jest.spyOn(...) 
- jest will return this mock object when a test does jest.mock('../prisma') instead of
  returning the real Prisma client 
- jest.fn() - mock function that by default does nothing and returns undefined until
              I program its behavior with .mockResolvedValue() */
module.exports = {
  // creates a fake prisma.template.findUnique method
  template: {
    findUnique: jest.fn(),
  },
  /* creates a fake prisma.mergeJob.create method so my merge code can "insert" a job 
   - I set what it should return in each test */
  mergeJob: {
    create: jest.fn(),
  },
  /* creates a fake prisma.user.findUnique method, typically used by my auth/passport 
  layer to look up users */
  user: {
    findUnique: jest.fn(),
  },
  /* stubs prism.$disconnect() so teardown code can call it without actually closing 
  anything */
  $disconnect: jest.fn(),
};
