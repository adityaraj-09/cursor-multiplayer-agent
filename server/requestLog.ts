import type { Request, Response, NextFunction } from "express";
import { log, logError } from "./logger.js";

function shouldSkip(path: string): boolean {
  return path.startsWith("/socket.io");
}

export function requestLog(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (shouldSkip(req.path)) {
    next();
    return;
  }
  const start = Date.now();
  res.on("finish", () => {
    const path = req.originalUrl || req.url;
    const status = res.statusCode;
    const ms = Date.now() - start;
    const msg = `${req.method} ${path} ${status}  ${ms}ms`;
    const extra = { user: req.user?.id || undefined };
    if (status >= 500) {
      logError("http", msg, extra);
      return;
    }
    log("http", msg, extra);
  });
  next();
}
