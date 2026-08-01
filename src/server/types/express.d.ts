import "express";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        companyId: string;
        role: string;
      };
    }
  }
}

export {};
