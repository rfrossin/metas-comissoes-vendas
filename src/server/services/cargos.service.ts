import { prisma, writeWithTenant } from "../config/prisma";
import { Prisma, type PermissionLevel } from "@prisma/client";
import { ConflictError, NotFoundError } from "../utils/http-errors";
import { assertAdmin, type RequestingUser } from "./scope.util";

// Motor de Fallback de Salário (spec § Cargos/3): prioridade para o
// salário customizado do Membro; cai para o padrão do Cargo quando ausente
// ou zero. Consumido por Bases de Recebível (rewardType=PERCENT_FIXO) e,
// futuramente, pelo Fechamento (FinancialPeriodSnapshot.fixedSalarySnapshot).
export function resolveFixedSalary(
  member: { customFixedSalary: Prisma.Decimal | null },
  cargo: { defaultFixedSalary: Prisma.Decimal },
): Prisma.Decimal {
  if (member.customFixedSalary && member.customFixedSalary.greaterThan(0)) {
    return member.customFixedSalary;
  }
  return cargo.defaultFixedSalary;
}

interface CargoInput {
  name: string;
  defaultFixedSalary: number;
  permissionLevel: PermissionLevel;
}

export async function listCargos(companyId: string) {
  return prisma.cargo.findMany({
    where: { companyId },
    orderBy: { name: "asc" },
  });
}

export async function createCargo(companyId: string, requestingUser: RequestingUser, data: CargoInput) {
  assertAdmin(requestingUser, "Só Administradores podem criar Cargos.");
  return writeWithTenant((tx) =>
    tx.cargo.create({
      data: { ...data, companyId },
    }),
  );
}

export async function updateCargo(companyId: string, requestingUser: RequestingUser, id: string, data: CargoInput) {
  assertAdmin(requestingUser, "Só Administradores podem editar Cargos.");
  const cargo = await prisma.cargo.findFirst({ where: { id, companyId } });

  if (!cargo) {
    throw new NotFoundError("Cargo não encontrado");
  }

  return writeWithTenant((tx) => tx.cargo.update({ where: { id }, data }));
}

export async function deleteCargo(companyId: string, requestingUser: RequestingUser, id: string) {
  assertAdmin(requestingUser, "Só Administradores podem excluir Cargos.");
  const cargo = await prisma.cargo.findFirst({
    where: { id, companyId },
    include: { _count: { select: { members: true, invites: true } } },
  });

  if (!cargo) {
    throw new NotFoundError("Cargo não encontrado");
  }

  if (cargo._count.members > 0 || cargo._count.invites > 0) {
    throw new ConflictError("Não é possível excluir: há Membros ou Convites vinculados a este Cargo.");
  }

  await writeWithTenant((tx) => tx.cargo.delete({ where: { id } }));
}
