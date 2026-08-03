import { describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { authMiddleware } from "./auth.middleware";
import { env } from "../config/env";

function callMiddleware(token?: string) {
  const req = { headers: token ? { authorization: `Bearer ${token}` } : {} } as Request;
  const json = vi.fn();
  const res = { status: vi.fn().mockReturnValue({ json }), json } as unknown as Response;
  const next = vi.fn() as NextFunction;
  authMiddleware(req, res, next);
  return { req, res, next, json };
}

describe("authMiddleware — isolamento entre escopos de token", () => {
  // Os três escopos são assinados com o MESMO segredo, então a verificação
  // de assinatura sozinha aceita qualquer um. Um token de identidade que
  // passasse por aqui produziria req.user.companyId === undefined — e no
  // Prisma, `where: { companyId: undefined }` não filtra nada, devolvendo
  // dados de TODAS as empresas. Este teste tranca essa porta.
  it("rejeita token de escopo identity", () => {
    const token = jwt.sign({ authUserId: "u1", email: "a@b.c", scope: "identity" }, env.jwtSecret);
    const { res, next } = callMiddleware(token);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejeita token de escopo platform", () => {
    const token = jwt.sign({ platformUserId: "p1", role: "SUPER_ADMIN", scope: "platform" }, env.jwtSecret);
    const { res, next } = callMiddleware(token);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejeita token de tenant sem companyId", () => {
    const token = jwt.sign({ userId: "u1", role: "ADMINISTRADOR" }, env.jwtSecret);
    const { res, next } = callMiddleware(token);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejeita token com companyId vazio", () => {
    const token = jwt.sign({ userId: "u1", companyId: "", role: "ADMINISTRADOR" }, env.jwtSecret);
    const { res, next } = callMiddleware(token);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("aceita token de tenant válido e popula req.user", () => {
    const token = jwt.sign({ userId: "u1", companyId: "c1", role: "ADMINISTRADOR" }, env.jwtSecret);
    const { req, next } = callMiddleware(token);
    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual({ id: "u1", companyId: "c1", role: "ADMINISTRADOR" });
  });

  it("rejeita requisição sem token", () => {
    const { res, next } = callMiddleware();
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejeita token assinado com outro segredo", () => {
    const token = jwt.sign({ userId: "u1", companyId: "c1", role: "ADMINISTRADOR" }, "outro-segredo");
    const { res, next } = callMiddleware(token);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
