import type { NextFunction, Request, RequestHandler, Response } from "express";

// Express 4 não encaminha rejeições de handlers async para o errorMiddleware
// automaticamente — sem isso, um erro inesperado deixa a requisição travada
// em vez de responder 500.
export function asyncHandler(handler: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
