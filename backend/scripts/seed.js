/* MINIMAL USER SEED USING PRISMA THEN DISCONNECTS
imports my initialized Prisma Client instance */
const prisma = require("./prisma");
const bcrypt = require("bcrypt");

const EMAIL = process.env.SEED_USER_EMAIL || "u1@example.com";
const PASSWORD = process.env.SEED_USER_PASSWORD || "devpass";

// starts an async Immediately Invoked Function Expression (IIFE)
(async () => {
  try {
    // Hash password before storing - 10 salt rounds
    const hashedPassword = await bcrypt.hash(PASSWORD, 10);

    await prisma.user.upsert({
      // looks for an existing user with id = "u1"
      where: { id: "u1" },
      // if that user exists, update nothing
      update: {},
      // if it doesn't exist, create it with these fields, include required fields
      create: { id: "u1", email: EMAIL, password: hashedPassword },
    });
    // simple success log once the upsert resolves
    console.log("seeded u1 with hashed password");
  } finally {
    // cleaning closes the Prisma db connection to avoid hanging the process
    await prisma.$disconnect();
  }
  // immediately invokes the async function
})();
