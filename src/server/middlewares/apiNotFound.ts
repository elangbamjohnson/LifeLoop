import { Request, Response } from "express";

/**
 * Fallthrough guard for unmatched /api/* routes.
 * Returns 404 with JSON { "error": "Not found" } and never index.html.
 */
export function apiNotFound(req: Request, res: Response): void {
  res.status(404).json({ error: "Not found" });
}
