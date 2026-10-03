import { User } from "../models/User.js";

export function isAdminEmail(email) {
  const adminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return adminEmails.includes(email.toLowerCase());
}

export async function requireAdmin(request, response, next) {
  const user = await User.findById(request.userId).select("email");
  if (!user) {
    response.status(401).json({ message: "Your account is no longer available." });
    return;
  }
  if (!isAdminEmail(user.email)) {
    response.status(403).json({ message: "Administrator access is required." });
    return;
  }
  next();
}
