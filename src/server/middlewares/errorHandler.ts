import { Request, Response, NextFunction } from "express";

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) {
  console.error("API Error:", err);
  const status = err.status || 500;
  let message = err.message || "Internal Server Error";
  
  // Sanitize 500 errors in production to avoid leaking sensitive data
  if (status === 500 && process.env.NODE_ENV === "production") {
    message = "Internal Server Error";
  }

  res.status(status).json({
    error: {
      message,
    },
  });
}
