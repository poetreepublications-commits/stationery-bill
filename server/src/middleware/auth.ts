import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { HttpError } from "../lib/errors.js";

export interface AuthUser { id: number; role: "SUPER_ADMIN" | "ACCOUNTS" | "SALES" | "GODOWN" | "DEALER"; dealerId: number | null; name: string }
declare global { namespace Express { interface Request { user?: AuthUser } } }

export function signAccess(u: AuthUser) {
  return jwt.sign({ sub: u.id, role: u.role, dealerId: u.dealerId }, config.jwtSecret, { expiresIn: "15m" });
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization ?? "";
  if (!h.startsWith("Bearer ")) return next(new HttpError(401, "Login required"));
  try {
    const payload = jwt.verify(h.slice(7), config.jwtSecret) as unknown as { sub: number };
    const u = await prisma.user.findUnique({ where: { id: payload.sub }, include: { dealer: true } });
    if (!u || !u.active || u.deletedAt) return next(new HttpError(401, "Account inactive"));
    req.user = { id: u.id, role: u.role, dealerId: u.dealer?.id ?? null, name: u.name };
    next();
  } catch {
    next(new HttpError(401, "Session expired, please log in again"));
  }
}

export const requireRole = (...roles: AuthUser["role"][]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, "Login required"));
    if (!roles.includes(req.user.role)) return next(new HttpError(403, "Your role cannot do this"));
    next();
  };

export const isAdmin = (u: AuthUser) => u.role === "SUPER_ADMIN";
export const isStaffFinance = (u: AuthUser) => u.role === "SUPER_ADMIN" || u.role === "ACCOUNTS";
