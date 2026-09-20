import { Request, Response, NextFunction, Router } from "express";

export const UUID_PARAM_REGEX = /^id$|Id$/;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(val: any): boolean {
  if (typeof val !== "string") return false;
  return UUID_REGEX.test(val.trim());
}

export function validateUuidParams(...paramNames: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    for (const name of paramNames) {
      const val = req.params?.[name];
      if (!val || !isValidUuid(val)) {
        return res.status(400).json({ error: `Invalid identifier format for '${name}'` });
      }
    }
    next();
  };
}

export function validateUuidBody(...fieldNames: (string | string[])[]) {
  const flattened = fieldNames.flat();
  return (req: Request, res: Response, next: NextFunction) => {
    for (const name of flattened) {
      const val = req.body?.[name];
      if (!val || !isValidUuid(val)) {
        return res.status(400).json({ error: `Missing or invalid identifier format for '${name}'` });
      }
    }
    next();
  };
}

export function validateQueryIds(req: Request, res: Response, next: NextFunction) {
  if (req.query && typeof req.query === "object") {
    for (const [key, val] of Object.entries(req.query)) {
      if (UUID_PARAM_REGEX.test(key) && val !== undefined && val !== null && val !== "") {
        if (typeof val === "string" && !isValidUuid(val)) {
          return res.status(400).json({ error: `Invalid identifier format for query parameter '${key}'` });
        }
        if (Array.isArray(val)) {
          for (const item of val) {
            if (typeof item === "string" && !isValidUuid(item)) {
              return res.status(400).json({ error: `Invalid identifier format for query parameter '${key}'` });
            }
          }
        }
      }
    }
  }
  next();
}

const KNOWN_ID_PARAMS = [
  "id",
  "itemId",
  "memberId",
  "notifId",
  "sharedItemId",
  "sourceItemId",
  "targetItemId",
  "captureId",
  "entityId",
];

export function applyUuidParamValidation(router: Router) {
  // Validate query parameters matching /^id$|Id$/
  router.use(validateQueryIds);

  // Register router.param for all known ID params
  for (const param of KNOWN_ID_PARAMS) {
    if (UUID_PARAM_REGEX.test(param)) {
      router.param(param, (req: Request, res: Response, next: NextFunction, val: any, name: string) => {
        if (!isValidUuid(val)) {
          return res.status(400).json({ error: `Invalid identifier format for '${name}'` });
        }
        next();
      });
    }
  }

  // Also hook router.route so any dynamically declared route param matching /^id$|Id$/ is automatically registered
  const origRoute = router.route?.bind(router);
  if (origRoute) {
    router.route = function (path: string) {
      if (typeof path === "string") {
        const matches = path.match(/:([a-zA-Z0-9_]+)/g);
        if (matches) {
          for (const m of matches) {
            const pName = m.substring(1);
            if (UUID_PARAM_REGEX.test(pName)) {
              router.param(pName, (req: Request, res: Response, next: NextFunction, val: any, name: string) => {
                if (!isValidUuid(val)) {
                  return res.status(400).json({ error: `Invalid identifier format for '${name}'` });
                }
                next();
              });
            }
          }
        }
      }
      return origRoute(path);
    };
  }
}
