import { Request, Response, NextFunction } from "express";

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) {
  let status = err?.status || 500;
  let message = err?.message || "Internal Server Error";

  // Walk the error.cause chain to inspect underlying database / driver errors
  let cur = err;
  let isInvalidIdentifier = false;
  let isUndefinedValue = false;

  while (cur) {
    const code = cur.code || cur?.cause?.code;
    const msg = String(cur.message || "");

    if (
      code === "22P02" ||
      msg.includes("invalid input syntax for type uuid") ||
      msg.includes("string_to_uuid")
    ) {
      isInvalidIdentifier = true;
    }
    if (
      code === "UNDEFINED_VALUE" ||
      msg.includes("UNDEFINED_VALUE") ||
      msg.includes("Undefined values are not allowed")
    ) {
      isUndefinedValue = true;
    }

    cur = cur.cause;
  }

  // 1. Postgres 22P02 (invalid uuid) maps to 400 Bad Request
  if (isInvalidIdentifier) {
    status = 400;
    message = "Invalid identifier format";
  }

  // 2. Postgres/driver UNDEFINED_VALUE maps to a logged 500
  if (isUndefinedValue) {
    status = 500;
  }

  const routePath = `${req.baseUrl || ""}${req.path}`;

  // Log 4xx at warn without query params; log 500/5xx at error (route name, no params, no SQL)
  if (status >= 400 && status < 500) {
    console.warn(`[WARN] ${req.method} ${routePath} - ${status}: ${message}`);
  } else {
    const errorTag = isUndefinedValue ? "UNDEFINED_VALUE" : (err?.name || "Internal Server Error");
    console.error(`[ERROR] ${req.method} ${routePath} - ${status}: ${errorTag}`);
  }

  // Response bodies must NEVER contain SQL queries or driver internals
  const containsSql =
    /select\s+|insert\s+|update\s+|delete\s+|from\s+|where\s+|drizzlequeryerror|postgreserror/i.test(
      message
    );
  if (containsSql || status >= 500) {
    message = status >= 500 ? "Internal Server Error" : "Invalid request parameters";
  }

  res.status(status).json({
    error: message,
    message,
  });
}
