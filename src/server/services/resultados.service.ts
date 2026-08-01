import { prisma, withTenant, writeWithTenant } from "../config/prisma";
import { Prisma, type ResultUnit } from "@prisma/client";
import { ConflictError, ForbiddenError, NotFoundError } from "../utils/http-errors";
import { assertResultsEditableMembers, assertVisibleMembers, resolveVisibleMemberFilter, type RequestingUser } from "./scope.util";

interface ResultTypeInput {
  name: string;
  unit: ResultUnit;
}

function assertAdmin(requestingUser: RequestingUser): void {
  if (requestingUser.role !== "ADMINISTRADOR") {
    throw new ForbiddenError("Só Administradores podem gerenciar Tipos de Resultado.");
  }
}

// ============================================================
// Segurança: ADMINISTRADOR irrestrito; LIDERANCA_NO (Gestor) pode lançar/
// editar/excluir Resultados para si mesmo e para os Membros dentro das
// hierarquias que lidera; OPERACIONAL (Usuário) só para Membros/hierarquias
// com atribuição de escopo EDITAR (ver scope.util.ts) — sem atribuição, sem
// acesso, nem para si mesmo (o Admin libera isso dando ao Usuário uma
// atribuição Membro=ele mesmo, EDITAR).
// ============================================================

export async function assertCanMutateResults(
  companyId: string,
  requestingUser: RequestingUser,
  memberId: string,
): Promise<void> {
  await assertResultsEditableMembers(
    companyId,
    requestingUser,
    [memberId],
    "Você não tem permissão para lançar Resultados para este Membro.",
  );
}

export async function listResultTypes(companyId: string) {
  return prisma.resultType.findMany({
    where: { companyId },
    orderBy: { name: "asc" },
  });
}

export async function createResultType(companyId: string, requestingUser: RequestingUser, data: ResultTypeInput) {
  assertAdmin(requestingUser);
  const existing = await prisma.resultType.findFirst({ where: { companyId, name: data.name } });

  if (existing) {
    throw new ConflictError("Já existe um Tipo de Resultado com esse nome.");
  }

  return writeWithTenant((tx) => tx.resultType.create({ data: { ...data, companyId } }));
}

export async function updateResultType(companyId: string, requestingUser: RequestingUser, id: string, data: ResultTypeInput) {
  assertAdmin(requestingUser);
  const type = await prisma.resultType.findFirst({ where: { id, companyId } });

  if (!type) {
    throw new NotFoundError("Tipo de Resultado não encontrado");
  }

  const existing = await prisma.resultType.findFirst({
    where: { companyId, name: data.name, NOT: { id } },
  });

  if (existing) {
    throw new ConflictError("Já existe um Tipo de Resultado com esse nome.");
  }

  return writeWithTenant((tx) => tx.resultType.update({ where: { id }, data }));
}

export async function deleteResultType(companyId: string, requestingUser: RequestingUser, id: string) {
  assertAdmin(requestingUser);
  const type = await prisma.resultType.findFirst({
    where: { id, companyId },
    include: { _count: { select: { resultEntries: true, operationalAdjustments: true } } },
  });

  if (!type) {
    throw new NotFoundError("Tipo de Resultado não encontrado");
  }

  if (type._count.resultEntries > 0 || type._count.operationalAdjustments > 0) {
    throw new ConflictError(
      "Não é possível excluir: já há Resultados ou Deságios lançados com este Tipo.",
    );
  }

  await writeWithTenant((tx) => tx.resultType.delete({ where: { id } }));
}

export function toDate(dateString: string): Date {
  return new Date(`${dateString}T00:00:00.000Z`);
}

function firstDayOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

type DbClient = typeof prisma | Prisma.TransactionClient;

// Regra de Resultados §6: nenhuma escrita é permitida num período Fechado.
// Enquanto o módulo de Fechamento (Fase 7) não existe, nenhum período tem
// linha de CommercialPeriod — logo tudo é implicitamente Aberto. Aceita um
// client de transação opcional para ser reutilizável dentro de $transaction.
export async function assertPeriodOpen(companyId: string, date: Date, client: DbClient = prisma) {
  const period = await client.commercialPeriod.findFirst({
    where: { companyId, referenceMonth: firstDayOfMonth(date) },
  });

  if (period?.status === "FECHADO") {
    throw new ConflictError(
      "Este período está fechado. Reabra o fechamento para editar os dados.",
    );
  }
}

// Um Fechamento de Membro (MemberClosing) trava, por Tipo de Resultado, só
// os Tipos que de fato foram apurados nele (MemberClosing.resultsByType —
// já é a soma de ResultEntry+OperationalAdjustment daquele mês, gravada no
// momento do Fechamento). Diferente de assertPeriodOpen (trava o mês
// inteiro, independente do Tipo): aqui um Tipo de Resultado não apurado
// naquele Fechamento continua livre para lançamento no mesmo Membro+Mês.
export async function assertNoMemberClosingForType(
  companyId: string,
  memberId: string,
  date: Date,
  typeId: string,
  client: DbClient = prisma,
): Promise<void> {
  const closing = await client.memberClosing.findUnique({
    where: { memberId_referenceMonth: { memberId, referenceMonth: firstDayOfMonth(date) } },
    select: { companyId: true, resultsByType: true },
  });
  if (!closing || closing.companyId !== companyId) return;

  const resultsByType = closing.resultsByType as unknown as { resultTypeId: string }[];
  if (resultsByType.some((r) => r.resultTypeId === typeId)) {
    throw new ConflictError("Impossível lançar este resultado pois o período tem um fechamento realizado para o membro");
  }
}

// Achado da critique: o guard de "Resultado nunca é negativo" vivia só no
// componente React (ResultEntryForm) — uma chamada direta à API contornava
// tudo. Espelha a mesma regra que resultados-bulk-import.service.ts já usa
// para decidir `kind` (valor negativo vira Deságio, nunca um Resultado).
function assertNonNegativeResultValue(value: number): void {
  if (value < 0) {
    throw new ConflictError("Resultado não aceita valor negativo — use um Deságio para estornos.");
  }
}

async function assertMemberAndTypeBelongToCompany(companyId: string, memberId: string, typeId: string) {
  const [member, type] = await Promise.all([
    prisma.member.findFirst({ where: { id: memberId, companyId } }),
    prisma.resultType.findFirst({ where: { id: typeId, companyId } }),
  ]);

  if (!member) {
    throw new NotFoundError("Membro não encontrado");
  }

  if (!type) {
    throw new NotFoundError("Tipo de Resultado não encontrado");
  }
}

export const TYPE_SELECT = { select: { id: true, name: true, unit: true } } as const;

interface ResultEntryInput {
  memberId: string;
  typeId: string;
  date: string;
  value: number;
}

export async function listResultEntries(companyId: string, requestingUser: RequestingUser, memberId: string) {
  await assertVisibleMembers(companyId, requestingUser, [memberId]);
  return prisma.resultEntry.findMany({
    where: { companyId, memberId },
    orderBy: { date: "desc" },
    include: { type: TYPE_SELECT },
  });
}

export async function createResultEntry(companyId: string, requestingUser: RequestingUser, data: ResultEntryInput) {
  assertNonNegativeResultValue(data.value);
  await assertCanMutateResults(companyId, requestingUser, data.memberId);
  await assertMemberAndTypeBelongToCompany(companyId, data.memberId, data.typeId);
  const date = toDate(data.date);
  await assertPeriodOpen(companyId, date);
  await assertNoMemberClosingForType(companyId, data.memberId, date, data.typeId);

  return writeWithTenant((tx) =>
    tx.resultEntry.create({
      data: { companyId, memberId: data.memberId, typeId: data.typeId, date, value: data.value },
      include: { type: TYPE_SELECT },
    }),
  );
}

export async function updateResultEntry(
  companyId: string,
  requestingUser: RequestingUser,
  id: string,
  data: Pick<ResultEntryInput, "typeId" | "date" | "value">,
) {
  assertNonNegativeResultValue(data.value);
  const entry = await prisma.resultEntry.findFirst({ where: { id, companyId } });

  if (!entry) {
    throw new NotFoundError("Resultado não encontrado");
  }

  await assertCanMutateResults(companyId, requestingUser, entry.memberId);

  const type = await prisma.resultType.findFirst({ where: { id: data.typeId, companyId } });

  if (!type) {
    throw new NotFoundError("Tipo de Resultado não encontrado");
  }

  const newDate = toDate(data.date);
  await assertPeriodOpen(companyId, entry.date);
  await assertPeriodOpen(companyId, newDate);

  return writeWithTenant((tx) =>
    tx.resultEntry.update({
      where: { id },
      data: { typeId: data.typeId, date: newDate, value: data.value },
      include: { type: TYPE_SELECT },
    }),
  );
}

export async function deleteResultEntry(companyId: string, requestingUser: RequestingUser, id: string) {
  const entry = await prisma.resultEntry.findFirst({ where: { id, companyId } });

  if (!entry) {
    throw new NotFoundError("Resultado não encontrado");
  }

  await assertCanMutateResults(companyId, requestingUser, entry.memberId);
  await assertPeriodOpen(companyId, entry.date);
  await writeWithTenant((tx) => tx.resultEntry.delete({ where: { id } }));
}

interface OperationalAdjustmentInput {
  memberId: string;
  typeId: string;
  dateReference: string;
  value: number;
  reason: string | null;
}

export async function listOperationalAdjustments(companyId: string, requestingUser: RequestingUser, memberId: string) {
  await assertVisibleMembers(companyId, requestingUser, [memberId]);
  return prisma.operationalAdjustment.findMany({
    where: { companyId, memberId },
    orderBy: { dateReference: "desc" },
    include: { type: TYPE_SELECT },
  });
}

export async function createOperationalAdjustment(
  companyId: string,
  requestingUser: RequestingUser,
  data: OperationalAdjustmentInput,
) {
  await assertCanMutateResults(companyId, requestingUser, data.memberId);
  await assertMemberAndTypeBelongToCompany(companyId, data.memberId, data.typeId);
  const dateReference = toDate(data.dateReference);
  await assertPeriodOpen(companyId, dateReference);
  await assertNoMemberClosingForType(companyId, data.memberId, dateReference, data.typeId);

  return writeWithTenant((tx) =>
    tx.operationalAdjustment.create({
      data: {
        companyId,
        memberId: data.memberId,
        typeId: data.typeId,
        value: data.value,
        dateReference,
        reason: data.reason,
        createdByUserId: requestingUser.id,
      },
      include: { type: TYPE_SELECT },
    }),
  );
}

export async function deleteOperationalAdjustment(companyId: string, requestingUser: RequestingUser, id: string) {
  const adjustment = await prisma.operationalAdjustment.findFirst({ where: { id, companyId } });

  if (!adjustment) {
    throw new NotFoundError("Deságio não encontrado");
  }

  await assertCanMutateResults(companyId, requestingUser, adjustment.memberId);
  await assertPeriodOpen(companyId, adjustment.dateReference);
  await writeWithTenant((tx) => tx.operationalAdjustment.delete({ where: { id } }));
}

export interface RealizadoLiquidoSummaryFilter {
  // 1 Membro específico (uso original, em Lançamento por Membro) — some com
  // memberIds abaixo (o client nunca manda os dois ao mesmo tempo).
  memberId?: string;
  // Vários Membros (PASSO 11.1 — uso em "Todos os Resultados", resolvido
  // client-side a partir do Filtro de Hierarquia + escopo visível, mesma
  // lista que já alimenta a tabela). Sempre interseccionado com
  // resolveVisibleMemberFilter abaixo — nunca confia cegamente na lista
  // vinda do client.
  memberIds?: string[];
  typeId?: string;
  dateFrom?: string;
  dateTo?: string;
}

// Motor de Cálculo do Realizado Líquido (Resultados §5):
// Realizado Líquido = soma(Resultados Regulares) + soma(Deságios).
// Usa Prisma.Decimal (decimal.js) do começo ao fim — nunca number/float — para
// não violar a regra de precisão financeira do projeto. PASSO 11.1: passou a
// aceitar os mesmos filtros de listAllResults (memberId/memberIds/typeId/
// período) — antes só somava 1 Membro fixo, sem período — para o Resumo em
// "Todos os Resultados" refletir exatamente o filtro aplicado na tela.
export async function getRealizadoLiquidoSummary(companyId: string, requestingUser: RequestingUser, filter: RealizadoLiquidoSummaryFilter) {
  if (filter.memberId) {
    await assertVisibleMembers(companyId, requestingUser, [filter.memberId]);
  }

  const visibleFilter = await resolveVisibleMemberFilter(companyId, requestingUser);
  const memberScalarWhere = filter.memberId
    ? { memberId: filter.memberId }
    : filter.memberIds && filter.memberIds.length > 0
      ? { memberId: { in: filter.memberIds } }
      : {};
  const memberRelationWhere = visibleFilter === "ALL" ? {} : { member: visibleFilter };

  const dateFrom = filter.dateFrom ? toDate(filter.dateFrom) : undefined;
  const dateTo = filter.dateTo ? toDate(filter.dateTo) : undefined;
  const dateRange = dateFrom || dateTo ? { gte: dateFrom, lte: dateTo } : undefined;

  const types = await prisma.resultType.findMany({
    where: { companyId, ...(filter.typeId ? { id: filter.typeId } : {}) },
    orderBy: { name: "asc" },
  });
  const summaries = [];

  for (const type of types) {
    const [entriesAgg, adjustmentsAgg] = await Promise.all([
      prisma.resultEntry.aggregate({
        where: { companyId, typeId: type.id, ...memberScalarWhere, ...memberRelationWhere, ...(dateRange ? { date: dateRange } : {}) },
        _sum: { value: true },
      }),
      prisma.operationalAdjustment.aggregate({
        where: {
          companyId,
          typeId: type.id,
          ...memberScalarWhere,
          ...memberRelationWhere,
          ...(dateRange ? { dateReference: dateRange } : {}),
        },
        _sum: { value: true },
      }),
    ]);

    const totalRegular = entriesAgg._sum.value ?? new Prisma.Decimal(0);
    const totalAdjustments = adjustmentsAgg._sum.value ?? new Prisma.Decimal(0);

    if (totalRegular.isZero() && totalAdjustments.isZero()) {
      continue;
    }

    summaries.push({
      typeId: type.id,
      typeName: type.name,
      unit: type.unit,
      totalRegular,
      totalAdjustments,
      netTotal: totalRegular.plus(totalAdjustments),
    });
  }

  return summaries;
}

const MEMBER_SELECT = { select: { id: true, fullName: true } } as const;

export interface ResultsFilter {
  memberId?: string;
  // PASSO 11.1: Membros resolvidos client-side a partir do Filtro de
  // Hierarquia (Canal/Departamento/Time) — some com memberId (client nunca
  // manda os dois). Mesmo tratamento de segurança de memberId: sempre
  // interseccionado com resolveVisibleMemberFilter abaixo.
  memberIds?: string[];
  typeId?: string;
  dateFrom?: string;
  dateTo?: string;
  kind?: "resultado" | "desagio";
  page: number;
  pageSize: number;
}

export interface UnifiedResultRow {
  kind: "resultado" | "desagio";
  id: string;
  date: Date;
  memberId: string;
  memberName: string;
  typeId: string;
  typeName: string;
  unit: ResultUnit;
  value: Prisma.Decimal;
  reason: string | null;
}

// Tabela global "Todos os Resultados": une Resultados regulares e Deságios
// numa única listagem filtrável. Para o volume de dados de uma empresa nesta
// fase, mesclar e paginar em memória é suficiente — se isso virar gargalo com
// bases muito grandes, o próximo passo é uma query SQL com UNION.
export async function listAllResults(companyId: string, requestingUser: RequestingUser, filter: ResultsFilter) {
  const dateFrom = filter.dateFrom ? toDate(filter.dateFrom) : undefined;
  const dateTo = filter.dateTo ? toDate(filter.dateTo) : undefined;
  const dateRange = dateFrom || dateTo ? { gte: dateFrom, lte: dateTo } : undefined;

  const visibleFilter = await resolveVisibleMemberFilter(companyId, requestingUser);

  const baseWhere = {
    companyId,
    ...(filter.memberId
      ? { memberId: filter.memberId }
      : filter.memberIds && filter.memberIds.length > 0
        ? { memberId: { in: filter.memberIds } }
        : {}),
    ...(filter.typeId ? { typeId: filter.typeId } : {}),
    ...(visibleFilter === "ALL" ? {} : { member: visibleFilter }),
  };

  const includeEntries = filter.kind !== "desagio";
  const includeAdjustments = filter.kind !== "resultado";

  const [entries, adjustments] = await Promise.all([
    includeEntries
      ? prisma.resultEntry.findMany({
          where: { ...baseWhere, ...(dateRange ? { date: dateRange } : {}) },
          include: { member: MEMBER_SELECT, type: TYPE_SELECT },
        })
      : Promise.resolve([]),
    includeAdjustments
      ? prisma.operationalAdjustment.findMany({
          where: { ...baseWhere, ...(dateRange ? { dateReference: dateRange } : {}) },
          include: { member: MEMBER_SELECT, type: TYPE_SELECT },
        })
      : Promise.resolve([]),
  ]);

  const rows: UnifiedResultRow[] = [
    ...entries.map((entry) => ({
      kind: "resultado" as const,
      id: entry.id,
      date: entry.date,
      memberId: entry.member.id,
      memberName: entry.member.fullName,
      typeId: entry.type.id,
      typeName: entry.type.name,
      unit: entry.type.unit,
      value: entry.value,
      reason: null,
    })),
    ...adjustments.map((adjustment) => ({
      kind: "desagio" as const,
      id: adjustment.id,
      date: adjustment.dateReference,
      memberId: adjustment.member.id,
      memberName: adjustment.member.fullName,
      typeId: adjustment.type.id,
      typeName: adjustment.type.name,
      unit: adjustment.type.unit,
      value: adjustment.value,
      reason: adjustment.reason,
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  const totalCount = rows.length;
  const page = Math.max(1, filter.page);
  const pageSize = Math.min(200, Math.max(1, filter.pageSize));
  const start = (page - 1) * pageSize;

  return {
    rows: rows.slice(start, start + pageSize),
    totalCount,
    page,
    pageSize,
  };
}

interface BulkIdsInput {
  entryIds: string[];
  adjustmentIds: string[];
}

async function assertBulkIdsBelongToCompany(companyId: string, input: BulkIdsInput) {
  if (input.entryIds.length > 0) {
    const count = await prisma.resultEntry.count({ where: { id: { in: input.entryIds }, companyId } });

    if (count !== input.entryIds.length) {
      throw new NotFoundError("Um ou mais Resultados selecionados não foram encontrados.");
    }
  }

  if (input.adjustmentIds.length > 0) {
    const count = await prisma.operationalAdjustment.count({
      where: { id: { in: input.adjustmentIds }, companyId },
    });

    if (count !== input.adjustmentIds.length) {
      throw new NotFoundError("Um ou mais Deságios selecionados não foram encontrados.");
    }
  }
}

async function assertBulkResultsEditable(companyId: string, requestingUser: RequestingUser, input: BulkIdsInput) {
  const memberIds = new Set<string>();

  if (input.entryIds.length > 0) {
    const entries = await prisma.resultEntry.findMany({
      where: { id: { in: input.entryIds }, companyId },
      select: { memberId: true },
    });
    entries.forEach((entry) => memberIds.add(entry.memberId));
  }

  if (input.adjustmentIds.length > 0) {
    const adjustments = await prisma.operationalAdjustment.findMany({
      where: { id: { in: input.adjustmentIds }, companyId },
      select: { memberId: true },
    });
    adjustments.forEach((adjustment) => memberIds.add(adjustment.memberId));
  }

  await assertResultsEditableMembers(companyId, requestingUser, [...memberIds]);
}

export async function bulkDeleteResults(companyId: string, requestingUser: RequestingUser, input: BulkIdsInput) {
  await assertBulkIdsBelongToCompany(companyId, input);
  await assertBulkResultsEditable(companyId, requestingUser, input);

  await withTenant(
    async (tx) => {
      if (input.entryIds.length > 0) {
        const entries = await tx.resultEntry.findMany({
          where: { id: { in: input.entryIds }, companyId },
        });

        for (const entry of entries) {
          await assertPeriodOpen(companyId, entry.date, tx);
        }

        await tx.resultEntry.deleteMany({ where: { id: { in: input.entryIds }, companyId } });
      }

      if (input.adjustmentIds.length > 0) {
        const adjustments = await tx.operationalAdjustment.findMany({
          where: { id: { in: input.adjustmentIds }, companyId },
        });

        for (const adjustment of adjustments) {
          await assertPeriodOpen(companyId, adjustment.dateReference, tx);
        }

        await tx.operationalAdjustment.deleteMany({
          where: { id: { in: input.adjustmentIds }, companyId },
        });
      }
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}

export type BulkEditableField = "typeId" | "date" | "reason";

interface BulkUpdateInput extends BulkIdsInput {
  field: BulkEditableField;
  value: string;
}

export async function bulkUpdateResults(companyId: string, requestingUser: RequestingUser, input: BulkUpdateInput) {
  await assertBulkIdsBelongToCompany(companyId, input);
  await assertBulkResultsEditable(companyId, requestingUser, input);

  if (input.field === "reason" && input.entryIds.length > 0) {
    throw new ConflictError("O campo Motivo só existe em lançamentos de Deságio.");
  }

  if (input.field === "typeId") {
    const type = await prisma.resultType.findFirst({ where: { id: input.value, companyId } });

    if (!type) {
      throw new NotFoundError("Tipo de Resultado não encontrado");
    }
  }

  if (input.field === "reason" && !input.value.trim()) {
    throw new ConflictError("Motivo não pode ficar vazio.");
  }

  const newDate = input.field === "date" ? toDate(input.value) : null;

  return withTenant(
    async (tx) => {
      if (input.entryIds.length > 0) {
        const entries = await tx.resultEntry.findMany({
          where: { id: { in: input.entryIds }, companyId },
        });

        for (const entry of entries) {
          await assertPeriodOpen(companyId, entry.date, tx);

          if (newDate) {
            await assertPeriodOpen(companyId, newDate, tx);
          }
        }

        if (input.field === "typeId") {
          await tx.resultEntry.updateMany({
            where: { id: { in: input.entryIds }, companyId },
            data: { typeId: input.value },
          });
        } else if (input.field === "date" && newDate) {
          await tx.resultEntry.updateMany({
            where: { id: { in: input.entryIds }, companyId },
            data: { date: newDate },
          });
        }
      }

      if (input.adjustmentIds.length > 0) {
        const adjustments = await tx.operationalAdjustment.findMany({
          where: { id: { in: input.adjustmentIds }, companyId },
        });

        for (const adjustment of adjustments) {
          await assertPeriodOpen(companyId, adjustment.dateReference, tx);

          if (newDate) {
            await assertPeriodOpen(companyId, newDate, tx);
          }
        }

        if (input.field === "typeId") {
          await tx.operationalAdjustment.updateMany({
            where: { id: { in: input.adjustmentIds }, companyId },
            data: { typeId: input.value },
          });
        } else if (input.field === "date" && newDate) {
          await tx.operationalAdjustment.updateMany({
            where: { id: { in: input.adjustmentIds }, companyId },
            data: { dateReference: newDate },
          });
        } else if (input.field === "reason") {
          await tx.operationalAdjustment.updateMany({
            where: { id: { in: input.adjustmentIds }, companyId },
            data: { reason: input.value },
          });
        }
      }

      return { updatedEntries: input.entryIds.length, updatedAdjustments: input.adjustmentIds.length };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}
