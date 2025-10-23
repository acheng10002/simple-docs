/* MINIMAL USER SEED USING PRISMA THEN DISCONNECTS
imports my initialized Prisma Client instance */
const prisma = require("./prisma");
// starts an async Immediately Invoked Function Expression (IIFE)
(async () => {
  try {
    await prisma.user.upsert({
      // looks for an existing user with id = "u1"
      where: { id: "u1" },
      // if that user exists, update nothing
      update: {},
      // if it doesn't exist, create it with these fields, include required fields
      create: { id: "u1", email: "u1@example.com", password: "devpass" },
    });
    // simple success log once the upsert resolves
    console.log("seeded u1");
  } finally {
    // cleaning closes the Prisma db connection to avoid hanging the process
    await prisma.$disconnect();
  }
  // immediately invokes the async function
})();
