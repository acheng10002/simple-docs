/* *** MINIMAL USER SEED USING PRISMA THEN DISCONNECTS
imports my initialized Prisma Client instance - object I use to talk to the db 
- seeds a dev user into db 
- if using password logins, I need to hash the password on seed */
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

/* INSTALLING VIA NODE ECOSYSTEM VS
- puts JS packages and sometimes thin CLI wrappers into my project or globally
- CLI wrapper - Node package/CLI that doesn't do the heavy work itself but instead calls
                an external program or library; it wraps the native tool with a friendly
                JS API
-- "Node code that drives another program"
- doesn't give me system binaries unless the package itself provides one (the system
  binaries are usually Node-based)
- system binary - compiled executable installed on my OS, accessible to any program via 
                  my PATH 
-- "that other program" 
INSTALLING A SYSTEM-LEVEL/NATIVE PROGRAM/LIB VIA MY OS OR VENDOR INSTALLER */
