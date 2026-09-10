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
    const payload = {
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      ms: Date.now() - start,
      user: req.user?.id || null,
      ip: req.ip,
    };
    if (res.statusCode >= 500) {
      logError("http", `${req.method} ${req.originalUrl}`, payload);
      return;
    }
    log("http", `${req.method} ${req.originalUrl} ${res.statusCode}`, payload);
  });
  next();
}
