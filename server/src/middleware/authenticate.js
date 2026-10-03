import jwt from "jsonwebtoken";

export function authenticate(request, response, next) {
  const authorization = request.get("authorization") ?? "";
  const [scheme, token] = authorization.split(" ");
  if (scheme !== "Bearer" || !token) {
    response.status(401).json({ message: "Sign in to continue." });
    return;
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    request.userId = payload.sub;
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      response.status(401).json({ message: "Your session has expired. Sign in again." });
      return;
    }
    next(error);
  }
}
