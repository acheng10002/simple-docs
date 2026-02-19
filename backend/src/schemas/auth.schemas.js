const { z } = require("zod");
const { email, password, simplePassword } = require("./common");

const registerBody = z.object({
  email: email,
  password: password,
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

const loginBody = z.object({
  email: z.string({ error: "Email is required" }).min(1, "Email is required"),
  password: z.string({ error: "Password is required" }).min(1, "Password is required"),
});

const forgotPasswordBody = z.object({
  email: z.string({ error: "Email is required" }).min(1, "Email is required"),
});

const resetPasswordBody = z.object({
  password: password,
});

const updateEmailBody = z.object({
  email: email,
});

const updatePasswordBody = z.object({
  currentPassword: z.string({ error: "Current password is required" }).min(1, "Current password is required"),
  newPassword: z.string({ error: "New password is required" })
    .min(8, "Password must contain at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(/[!@#$%^&*(),.?":{}|<>]/, "Password must contain at least one special character"),
});

module.exports = {
  registerBody,
  loginBody,
  forgotPasswordBody,
  resetPasswordBody,
  updateEmailBody,
  updatePasswordBody,
};
