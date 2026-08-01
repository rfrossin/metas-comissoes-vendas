import "dotenv/config";
import { prismaAdmin as prisma } from "../src/server/config/prisma-admin";

// Backfill único: preenche ReceivablesConditionalTrigger.verificationLevel
// (novo, ainda nullable nesta rodada) copiando de entityType (que vai ser
// removido, junto de entityId, na próxima etapa) — os Gatilhos Condicionais
// voltam a usar um Nível relativo ao Beneficiário em vez de uma Entidade
// fixa. Idempotente — só toca linhas ainda sem verificationLevel.
async function main() {
  const pending = await prisma.receivablesConditionalTrigger.findMany({
    where: { verificationLevel: null },
    include: { receivablesBase: { select: { name: true } } },
  });

  console.log(`${pending.length} Gatilho(s) Condicional(is) pendente(s) de backfill`);

  for (const trigger of pending) {
    await prisma.receivablesConditionalTrigger.update({
      where: { id: trigger.id },
      data: { verificationLevel: trigger.entityType },
    });
    console.log(`- Condição ${trigger.id} (Base "${trigger.receivablesBase.name}") -> verificationLevel=${trigger.entityType} (era entityId=${trigger.entityId})`);
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
