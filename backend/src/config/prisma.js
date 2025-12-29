/* DEV DEP - PRISMA TOOLING: PRISMA
INSTANTIATES AND EXPORTS A SINGLETON PRISMACLIENT */
const { PrismaClient } = require("@prisma/client");

// instantiates Prisma Client, establishes connection to my db
const prisma = new PrismaClient();

// makes prisma accessible from any service, controller, or route file
module.exports = prisma;
