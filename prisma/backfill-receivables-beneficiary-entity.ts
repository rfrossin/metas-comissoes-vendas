import "dotenv/config";
import { prismaAdmin as prisma } from "../src/server/config/prisma-admin";

// Backfill único: preenche ReceivablesBeneficiary.entityType/entityId (novas
// colunas, ainda nullable nesta rodada) copiando da ReceivablesBase pai
// (apurationLevel/entityId, colunas que serão removidas da Base logo em
// seguida) — preserva o comportamento já configurado pelo usuário antes da
// mudança para "Entidade de Análise por Beneficiário". Idempotente — só
// toca beneficiários ainda sem entityType/entityId.
async function main() {
  const pending = await prisma.receivablesBeneficiary.findMany({
    where: { entityType: null },
    include: { receivablesBase: { select: { apurationLevel: true, entityId: true, name: true } } },
  });

  console.log(`${pending.length} beneficiário(s) pendente(s) de backfill`);

  for (const beneficiary of pending) {
    await prisma.receivablesBeneficiary.update({
      where: { id: beneficiary.id },
      data: {
        entityType: beneficiary.receivablesBase.apurationLevel,
        entityId: beneficiary.receivablesBase.entityId,
      },
    });
    console.log(
      `- Beneficiário ${beneficiary.id} (Base "${beneficiary.receivablesBase.name}") -> entityType=${beneficiary.receivablesBase.apurationLevel}, entityId=${beneficiary.receivablesBase.entityId}`,
    );
  }

  console.log("Backfill concluído.");
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
