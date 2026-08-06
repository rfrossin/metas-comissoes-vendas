import { describe, expect, it, vi, beforeEach } from "vitest";

const companyFindUnique = vi.fn();
const accessRequestFindMany = vi.fn();

vi.mock("../config/prisma", () => ({
  prisma: {
    company: { findUnique: (...args: unknown[]) => companyFindUnique(...args) },
    companyAccessRequest: { findMany: (...args: unknown[]) => accessRequestFindMany(...args) },
  },
  // Importados no topo do serviço; nenhum teste daqui chega a escrever.
  writeWithTenant: vi.fn(),
}));

// Dependências de I/O do módulo — não são exercidas nestes testes, mas
// precisam existir para o import do serviço não explodir.
vi.mock("../config/prisma-admin", () => ({ prismaAdmin: {} }));
vi.mock("../config/supabase", () => ({ supabaseAdmin: {} }));
vi.mock("./mailer.service", () => ({ sendMail: vi.fn() }));
vi.mock("./permissoes.service", () => ({ addMembershipToIdentity: vi.fn() }));

// Import estático pelo mesmo motivo documentado em
// company-status.middleware.test.ts: o build do servidor não suporta
// top-level await. vi.mock é içado, então os mocks acima seguem valendo.
import { getCompanyInviteCode, listCompanyAccessRequests } from "./company-access.service";

const admin = { id: "u1", companyId: "c1", role: "ADMINISTRADOR" };

beforeEach(() => {
  companyFindUnique.mockReset();
  accessRequestFindMany.mockReset();
});

describe("getCompanyInviteCode", () => {
  it("devolve o código da própria empresa para o Administrador", async () => {
    companyFindUnique.mockResolvedValue({ inviteCode: "2H8EHQ8R4F" });

    await expect(getCompanyInviteCode("c1", admin)).resolves.toEqual({ inviteCode: "2H8EHQ8R4F" });
  });

  // A checagem de papel é o único guarda destas rotas (não há middleware de
  // role): se ela cair, qualquer usuário da empresa passa a conseguir o
  // código de convite e a aprovar entradas.
  it.each(["OPERACIONAL", "LIDERANCA_NO"])("bloqueia o papel %s", async (role) => {
    await expect(getCompanyInviteCode("c1", { ...admin, role })).rejects.toThrow(/Administrador/);
    expect(companyFindUnique).not.toHaveBeenCalled();
  });
});

describe("listCompanyAccessRequests", () => {
  it("lista somente os pedidos PENDENTES da empresa do token", async () => {
    accessRequestFindMany.mockResolvedValue([]);

    await listCompanyAccessRequests("c1", admin);

    // O companyId precisa vir do token, nunca do corpo da requisição — é o
    // contrato de isolamento documentado no topo do serviço. Sem o filtro,
    // um Admin veria pedidos endereçados a outra empresa.
    expect(accessRequestFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: "c1", status: "PENDENTE" } }),
    );
  });

  it("bloqueia quem não é Administrador antes de tocar no banco", async () => {
    await expect(
      listCompanyAccessRequests("c1", { ...admin, role: "OPERACIONAL" }),
    ).rejects.toThrow(/Administrador/);
    expect(accessRequestFindMany).not.toHaveBeenCalled();
  });
});
