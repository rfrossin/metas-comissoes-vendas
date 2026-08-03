import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

const findUnique = vi.fn();
vi.mock("../config/prisma", () => ({
  prisma: { company: { findUnique: (...args: unknown[]) => findUnique(...args) } },
}));

const { companyStatusGuard } = await import("./company-status.middleware");

function call(path: string, user?: { id: string; companyId: string; role: string }) {
  const req = { path, user } as Request;
  const json = vi.fn();
  const res = { status: vi.fn().mockReturnValue({ json }), json } as unknown as Response;
  const next = vi.fn() as NextFunction;
  return { promise: companyStatusGuard(req, res, next), res, next, json };
}

beforeEach(() => {
  findUnique.mockReset();
});

describe("companyStatusGuard", () => {
  it("libera quando a empresa está ATIVA", async () => {
    findUnique.mockResolvedValue({ status: "ATIVA" });
    const { promise, next } = call("/metas", { id: "u1", companyId: "c1", role: "ADMINISTRADOR" });
    await promise;
    expect(next).toHaveBeenCalled();
  });

  it("bloqueia dados quando a empresa está pausada", async () => {
    findUnique.mockResolvedValue({ status: "BLOQUEADA_INADIMPLENCIA" });
    const { promise, res, next, json } = call("/metas", { id: "u1", companyId: "c1", role: "ADMINISTRADOR" });
    await promise;
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: "COMPANY_BLOCKED" }));
  });

  it("bloqueia também quando a empresa foi excluída", async () => {
    findUnique.mockResolvedValue(null);
    const { promise, res, json } = call("/metas", { id: "u1", companyId: "sumiu", role: "ADMINISTRADOR" });
    await promise;
    expect(res.status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: "COMPANY_NOT_FOUND" }));
  });

  // Sem estas exceções o usuário fica preso: não conseguiria nem trocar
  // para outra empresa dele, nem carregar o próprio perfil para o app
  // renderizar o aviso.
  it.each([
    "/permissoes/meu-perfil",
    "/permissoes/minhas-empresas",
    "/permissoes/trocar-empresa",
    "/permissoes/minha-senha",
  ])("mantém %s acessível com a empresa pausada", async (path) => {
    findUnique.mockResolvedValue({ status: "BLOQUEADA_INADIMPLENCIA" });
    const { promise, next } = call(path, { id: "u1", companyId: "c1", role: "OPERACIONAL" });
    await promise;
    expect(next).toHaveBeenCalled();
    // Rota liberada nem consulta o banco — evita custo em toda requisição.
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("não interfere quando não há usuário autenticado", async () => {
    const { promise, next } = call("/metas", undefined);
    await promise;
    expect(next).toHaveBeenCalled();
  });
});
