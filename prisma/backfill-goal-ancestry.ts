import "dotenv/config";
import type { OrgScopeType } from "@prisma/client";
import { prismaAdmin as prisma } from "../src/server/config/prisma-admin";
import { resolveAncestorIds } from "../src/server/services/metas.service";

// Backfill único: preenche memberId/teamId/departmentId/channelId em
// GoalLine e GoalNodeAggregate para linhas/nós criados ANTES da migração
// que introduziu essas colunas. Idempotente — só toca registros onde as 4
// colunas ainda estão null (uma entidade já backfilled sempre tem pelo
// menos uma delas preenchida, exceto EMPRESA, que é excluída de propósito
// porque não precisa de ancestralidade).
async function backfillTable<T extends { companyId: string; entityType: OrgScopeType; entityId: string }>(
  label: string,
  findDistinctPending: () => Promise<T[]>,
  updateMany: (companyId: string, entityType: OrgScopeType, entityId: string, ancestry: Awaited<ReturnType<typeof resolveAncestorIds>>) => Promise<number>,
) {
  const pairs = await findDistinctPending();
  console.log(`${label}: ${pairs.length} entidade(s) distinta(s) pendente(s)`);

  let updated = 0;
  for (const pair of pairs) {
    const ancestry = await resolveAncestorIds(pair.companyId, pair.entityType, pair.entityId);
    updated += await updateMany(pair.companyId, pair.entityType, pair.entityId, ancestry);
  }

  console.log(`${label}: ${updated} linha(s) atualizada(s)`);
}

async function main() {
  await backfillTable(
    "GoalLine",
    () =>
      prisma.goalLine.findMany({
        where: { memberId: null, teamId: null, departmentId: null, channelId: null, entityType: { not: "EMPRESA" } },
        distinct: ["companyId", "entityType", "entityId"],
        select: { companyId: true, entityType: true, entityId: true },
      }),
    async (companyId, entityType, entityId, ancestry) => {
      const result = await prisma.goalLine.updateMany({ where: { companyId, entityType, entityId }, data: ancestry });
      return result.count;
    },
  );

  await backfillTable(
    "GoalNodeAggregate",
    () =>
      prisma.goalNodeAggregate.findMany({
        where: { memberId: null, teamId: null, departmentId: null, channelId: null, entityType: { not: "EMPRESA" } },
        distinct: ["companyId", "entityType", "entityId"],
        select: { companyId: true, entityType: true, entityId: true },
      }),
    async (companyId, entityType, entityId, ancestry) => {
      const result = await prisma.goalNodeAggregate.updateMany({
        where: { companyId, entityType, entityId },
        data: ancestry,
      });
      return result.count;
    },
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
