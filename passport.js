/* *** PASSPORT.JS + PRISMA.JS INTEGRATE AUTH AND DB
*JWT AUTH STRATEGY 
- configs JWT strategy on the shared passport instance
- verifies bearer token with JWT_SECRET, loads user via Prisma, and attaches it to req.user */
// env variables
require("dotenv").config();
// imports the passport instance
const passport = require("passport");
// Passport JWT strategy
const { Strategy: JwtStrategy, ExtractJwt } = require("passport-jwt");
// Prism Client instance
const prisma = require("./prisma");

/* *** READS JWT_SECRET FROM ENV
server loads JWT secret from .env; JWT secret is used to sign and verify tokens 
- ensures tokens haven't been tampered with and that they issued by the server 
- NO CODE CALLS JSONWEBTOKEN.SIGN(...) TO CREATE TOKEN YET 
  just minting a token out-of-band */
const SECRET = process.env.JWT_SECRET;

// CONFIGURES PASSPORT WITH PASSPORT-JWT (JWTSTRATEGY, EXTRACTJWT)
passport.use(
  new JwtStrategy(
    {
      /* B2a. MANUAL DATA INPUT REQUEST LIFECYCLE (JWT-PROTECTED): auth middleware that runs before route handler 
        i. client attaches the token in the Authorization header (Node one-liner creates a token that my server
           will accept)
        - this happens on the client BEFORE any request is even made
        ii. client sends request with the token in its Auth header and hits the protected route
        iii. server receives request 
        iv. server runs passport.authenticate("jwt") to verify the token
        -- JWT Bearer auth HTTP scheme validates the token's signature and claims to authenticate the caller 
        -- the JWT token is a signed string (<Header>.<Payload>.<Signature>) that encodes claims like sub (user 
           id), exp (expiry), etc.  in its payload     
        --- Header - metadata about the token itself
        --- Payload - the actual claims
        --- JWT Signature - cryptographic signature over the JWT's header+payload that binds the header+payload 
                           to the server's secret key, JWT_SECRET 
        -- signature won't match and verification fails if someone tampers with the payload */
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      /* B2c. MANUAL DATA INPUT REQUEST LIFECYCLE (JWT-PROTECTED): auth middleware 
      JWT signature carries claims for stateless auth
      - server verifies the token's signature using the server's secret, JWT_SECRET 
        and trusts the token's embedded claims until it expires */
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
        /* if user is found, attaches user to req.user 
        - if a token is valid and a user exists, this protected route handlers can trust req.user */
        return done(null, user);
      } catch (err) {
        /* *** ON VALID TOKENS, FETCHES THE USER VIA PRISMA AND SETS REQ.USER 
        B2d. MANUAL DATA INPUT REQUEST LIFECYCLE (JWT-PROTECTED): auth middleware
        failures short-circuit to 401 and handler never runs    
        - if there's a db error, authentication fails with err */
        return done(err, false);
      }
    }
  )
);

// exports strategies to be registered in app.js
module.exports = {
  passport,
};
