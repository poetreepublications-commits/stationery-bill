import type { Request, Response, NextFunction } from "express";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { HttpError } from "./errors.js";

export const wrap = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };

export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  try {
    return schema.parse(data);
  } catch (e) {
    if (e instanceof ZodError) throw new HttpError(400, "Invalid input", e.flatten());
    throw e;
  }
}

export function pageParams(q: Record<string, unknown>) {
  const page = Math.max(1, Number(q.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 25)));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export const paged = <T>(items: T[], total: number, page: number, pageSize: number) =>
  ({ items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) });
