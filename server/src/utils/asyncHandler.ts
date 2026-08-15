import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * S1: wrap an async Express route handler so any rejected promise is forwarded to
 * Express's error middleware (returning 500) instead of becoming an unhandledRejection.
 * Express 4 does not await async handlers natively.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function asyncHandler(fn: (req: any, res: any, next: any) => any): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
