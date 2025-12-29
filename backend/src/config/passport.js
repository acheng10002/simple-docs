/* PASSPORT.JS + PRISMA.JS INTEGRATE AUTH AND DB
- configs JWT strategy on the shared passport instance
- verifies bearer token with JWT_SECRET, loads user via Prisma, and attaches it to req.user */
require("dotenv").config();
// imports the passport instance
const passport = require("passport");
// Passport JWT strategy
const { Strategy: JwtStrategy, ExtractJwt } = require("passport-jwt");
// Prism Client instance
const prisma = require("./prisma");

/* READS JWT_SECRET FROM ENV */
const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  // fails early- safer than starting with a misconfig
  throw new Error("JWT_SECRET is required");
}

// CONFIGURES PASSPORT WITH PASSPORT-JWT (JWTSTRATEGY, EXTRACTJWT)
passport.use(
  new JwtStrategy(
    {
      // B2a. MANUAL DATA INPUT REQUEST LIFECYCLE (JWT-PROTECTED): auth middleware that runs before route handler
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      /* B2c. MANUAL DATA INPUT REQUEST LIFECYCLE (JWT-PROTECTED): auth middleware 
      - server verifies the token's signature using the server's secret, JWT_SECRET and trusts the token's embedded 
        claims until it expires */
      secretOrKey: SECRET,
    },
    /* callback that runs after the token is decoded and verified 
    payload - JWT's middle part that contains the actual data I want to encode
    done - cb that signals success (and passes the authenticated user) or failure */
    async (payload, done) => {
      try {
        /* B2d. MANUAL DATA INPUT REQUEST LIFECYCLE (JWT-PROTECTED): auth middleware  
        queries the db, the user model, for a user with the id coded in the token payload */
        const user = await prisma.user.findUnique({
          where: { id: payload.id },
        });
        // if no user, authentication fails
        if (!user) return done(null, false);
        // if user is found, attaches user to req.user
        return done(null, user);
      } catch (err) {
        /* ON VALID TOKENS, FETCHES THE USER VIA PRISMA AND SETS REQ.USER 
        B2d. MANUAL DATA INPUT REQUEST LIFECYCLE (JWT-PROTECTED): auth middleware
        failures short-circuit to 401 and handler never runs */
        return done(err, false);
      }
    }
  )
);

module.exports = {
  passport,
};
