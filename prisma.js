/* *** DEV DEP - PRISMA TOOLING: PRISMA
*** INSTANTIATES AND EXPORTS A SINGLETON PRISMACLIENT
single db client instance, allowing access to my db 
- this wrapper for Prisma Client centralizes and reuses the db connection across my app
-- avoids creating a new PrismaClient every time I access the db
-- avoids connection churn - high rate of opening and closing network connections (lots
   of short-lived sockets), which burns CPU and memory on TCP handshakes

- imports PrismaClient constructor, providing access to my db through Prisma 
-- connects to my db using the config from schema.prisma
- uses client library Prisma outputted to node_modules/prisma/client */
const { PrismaClient } = require("@prisma/client");

// instantiates Prisma Client, establishes connection to my db
const prisma = new PrismaClient();

// makes prisma accessible from any service, controller, or route file
module.exports = prisma;
