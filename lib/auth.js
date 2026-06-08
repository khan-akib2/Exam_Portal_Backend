import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dbConnect from "./db.js";
import User from "./models/User.js";

const JWT_SECRET = process.env.JWT_SECRET || "fallback_super_secret_jwt_key";

export async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

export async function comparePassword(password, hashed) {
  return bcrypt.compare(password, hashed);
}

export function signToken(user) {
  return jwt.sign(
    {
      id: user._id,
      email: user.email,
      role: user.role,
      permissions: user.permissions || [],
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

/**
 * Express middleware to authenticate requests.
 * Attaches the User document to `req.user`.
 * @param {Array<string>} allowedRoles - Roles allowed (e.g. ['super_admin', 'admin'])
 * @param {string} [requiredPermission] - Specific permission required for admins
 */
export function requireAuth(allowedRoles = [], requiredPermission = null) {
  return async (req, res, next) => {
    try {
      await dbConnect();

      // Try parsing from Authorization header
      const authHeader = req.headers["authorization"];
      let token = null;

      if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.substring(7);
      } else {
        // Try parsing from Cookie header (req.cookies or raw cookies)
        if (req.cookies && req.cookies.token) {
          token = req.cookies.token;
        } else if (req.headers.cookie) {
          const tokenCookie = req.headers.cookie
            .split(";")
            .find((cookie) => cookie.trim().startsWith("token="));
          if (tokenCookie) {
            token = tokenCookie.split("=")[1];
          }
        }
      }

      if (!token) {
        return res.status(401).json({ error: "UNAUTHORIZED: Missing authentication token." });
      }

      const decoded = verifyToken(token);
      if (!decoded) {
        return res.status(401).json({ error: "UNAUTHORIZED: Invalid or expired token." });
      }

      const user = await User.findById(decoded.id);
      if (!user) {
        return res.status(401).json({ error: "UNAUTHORIZED: User not found in database." });
      }

      if (user.status === "suspended") {
        return res.status(403).json({ error: "FORBIDDEN: Your account is suspended." });
      }

      // Role checks
      if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
        // Super Admins override all checks
        if (user.role !== "super_admin") {
          return res.status(403).json({ error: `FORBIDDEN: Access restricted to roles: ${allowedRoles.join(", ")}` });
        }
      }

      // Fine-grained permission check for Admins
      if (user.role === "admin" && requiredPermission) {
        if (!user.permissions || !user.permissions.includes(requiredPermission)) {
          return res.status(403).json({ error: `FORBIDDEN: You do not have the required permission: ${requiredPermission}` });
        }
      }

      req.user = user;
      next();
    } catch (error) {
      console.error("Authentication middleware error:", error);
      return res.status(500).json({ error: "An internal server error occurred." });
    }
  };
}

