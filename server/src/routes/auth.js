import { Router } from "express";
import bcrypt from "bcryptjs";
import { rateLimit } from "express-rate-limit";
import jwt from "jsonwebtoken";
import { authenticate } from "../middleware/authenticate.js";
import { isAdminEmail } from "../middleware/requireAdmin.js";
import { User } from "../models/User.js";

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false
});
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function issueToken(user) {
  return jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: "7d" });
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    isAdmin: isAdminEmail(user.email)
  };
}

authRouter.post("/register", authLimiter, async (request, response) => {
  const name = typeof request.body.name === "string" ? request.body.name.trim() : "";
  const email = typeof request.body.email === "string" ? request.body.email.trim().toLowerCase() : "";
  const password = typeof request.body.password === "string" ? request.body.password : "";

  if (!name || name.length > 80 || !emailPattern.test(email) || email.length > 254) {
    response.status(400).json({ message: "Enter a name and a valid email address." });
    return;
  }
  if (password.length < 8 || password.length > 128) {
    response.status(400).json({ message: "Password must be between 8 and 128 characters." });
    return;
  }
  if (await User.exists({ email })) {
    response.status(409).json({ message: "An account with this email already exists." });
    return;
  }

  try {
    const user = await User.create({
      name,
      email,
      passwordHash: await bcrypt.hash(password, 12)
    });
    response.status(201).json({ token: issueToken(user), user: publicUser(user) });
  } catch (error) {
    if (error.code === 11000) {
      response.status(409).json({ message: "An account with this email already exists." });
      return;
    }
    throw error;
  }
});

authRouter.post("/login", authLimiter, async (request, response) => {
  const email = typeof request.body.email === "string" ? request.body.email.trim().toLowerCase() : "";
  const password = typeof request.body.password === "string" ? request.body.password : "";
  const user = await User.findOne({ email }).select("+passwordHash");

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    response.status(401).json({ message: "Email or password is incorrect." });
    return;
  }
  response.json({ token: issueToken(user), user: publicUser(user) });
});

authRouter.get("/me", authenticate, async (request, response) => {
  const user = await User.findById(request.userId);
  if (!user) {
    response.status(401).json({ message: "Your account is no longer available." });
    return;
  }
  response.json({ user: publicUser(user) });
});
