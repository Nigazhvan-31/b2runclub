"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticateJWT = authenticateJWT;
exports.requireRole = requireRole;
exports.requireAccount = requireAccount;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const secrets_1 = require("../utils/secrets");
function authenticateJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];
        jsonwebtoken_1.default.verify(token, secrets_1.JWT_SECRET, (err, decoded) => {
            if (err) {
                return res.status(401).json({ error: "Invalid or expired token" });
            }
            req.user = decoded;
            next();
        });
    }
    else {
        // Unauthenticated request, let routes decide permissions based on "VISITOR" role fallback
        next();
    }
}
const prisma_1 = __importDefault(require("../utils/prisma"));
function requireRole(allowedRoles) {
    return async (req, res, next) => {
        let userRole = req.user ? req.user.role : "VISITOR";
        if (req.user?.id && !allowedRoles.includes(userRole)) {
            try {
                const dbUser = await prisma_1.default.user.findUnique({
                    where: { id: req.user.id },
                    select: { role: true },
                });
                if (dbUser) {
                    userRole = dbUser.role;
                    req.user.role = dbUser.role;
                }
            }
            catch {
                /* retain userRole from token */
            }
        }
        if (userRole === "BLOCKED") {
            res.status(403).json({ error: "Your account has been blocked. Access denied." });
            return;
        }
        if (allowedRoles.includes(userRole)) {
            next();
        }
        else {
            res.status(403).json({ error: "Forbidden: Access denied" });
        }
    };
}
/**
 * Demands a real signed-in account, whatever its role.
 *
 * `requireRole` cannot express this. It maps an anonymous request to the role
 * "VISITOR", so a list that includes VISITOR — which it must, because VISITOR is a
 * genuine registered role — also lets signed-out traffic straight through. Any
 * handler then reading `req.user!.id` gets undefined and fails as a 500 instead of
 * an honest 401.
 *
 * Use this for anything scoped to "my own account".
 */
function requireAccount(req, res, next) {
    if (!req.user?.id) {
        res.status(401).json({ error: "Sign in to continue" });
        return;
    }
    next();
}
