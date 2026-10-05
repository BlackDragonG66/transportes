import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { one, pool, fail } from "./db.js";
export const cookieOptions = {
  httpOnly: true,
  secure: config.production,
  sameSite: "strict",
  path: "/api",
  maxAge: 8 * 3600 * 1000,
};
export function session(res, user) {
  res.cookie(
    "session",
    jwt.sign({ sub: user.id }, config.secret, {
      expiresIn: "8h",
      issuer: "conexiones",
      audience: "conexiones-web",
    }),
    cookieOptions,
  );
}
export async function auth(req, res, next) {
  try {
    const token = jwt.verify(req.cookies.session || "", config.secret, {
      issuer: "conexiones",
      audience: "conexiones-web",
      algorithms: ["HS256"],
    });
    req.user = await one(
      pool,
      "SELECT id,name,email,phone,role,EXISTS(SELECT 1 FROM demo_entities WHERE kind='user' AND entity_id=users.id) AS demo FROM users WHERE id=$1",
      [token.sub],
    );
    if (!req.user) return res.status(401).json({ error: "Inicia sesión." });
    next();
  } catch (error) {
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError"
    )
      return res.status(401).json({ error: "Inicia sesión." });
    next(error);
  }
}
export function role(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) fail("No tienes acceso.", 403);
    next();
  };
}
