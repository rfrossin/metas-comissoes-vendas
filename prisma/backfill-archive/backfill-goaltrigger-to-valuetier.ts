// One-off (idempotente, mantido no repo — mesmo padrão de
// backfill-receivables-beneficiary-entity.ts e backfill-conditional-trigger-level.ts):
// migra os Degraus da trilha META de `GoalTrigger` (compartilhado por toda a
// GoalCampaign) para `ReceivablesValueTier` (receivablesBaseId-scoped, mesma
// tabela que a trilha RESULTADO já usa) — ver .planosistemametas, 9ª rodada.
//
// Rodar ANTES do `prisma db push` que remove `ReceivablesTierRule.goalTriggerId`.
//
// Duas situações encontradas nos dados reais:
// 1. Regras com `goalTriggerId` ainda válido: cria um `ReceivablesValueTier`
//    próprio da Base (order/percentage/colorFlag copiados do GoalTrigger) e
//    reaponta a regra para ele.
// 2. Regras já órfãs (`goalTriggerId=null` E `valueTierId=null` — dano já
//    causado pelo bug antes deste fix, confirmado com o usuário como dado de
//    teste descartável): removidas, já que não há limiar nenhum para
//    recuperar. A recompensa configurada nelas também é descartada junto
//    (usuário vai reconfigurar os Degraus do zero na tela, já corrigida).
import "dotenv/config";
import { prismaAdmin as prisma } from "../src/server/config/prisma-admin";

async function main() {
  // Cruft de ReceivablesValueTier pré-existente (sem nenhuma ReceivablesTierRule
  // apontando para ela — encontrado em "Meta Coordenadores - Atacado") precisa
  // sair ANTES de criar as novas linhas, senão colide com @@unique([receivablesBaseId, order]).
  const referencedValueTierIds = new Set(
    (await prisma.receivablesTierRule.findMany({ where: { valueTierId: { not: null } }, select: { valueTierId: true } })).map((r) => r.valueTierId),
  );
  const danglingValueTiers = (await prisma.receivablesValueTier.findMany()).filter((vt) => !referencedValueTierIds.has(vt.id));
  console.log(`ReceivablesValueTier órfãos pré-existentes (sem nenhuma regra apontando): ${danglingValueTiers.length}`);
  if (danglingValueTiers.length > 0) {
    const { count } = await prisma.receivablesValueTier.deleteMany({ where: { id: { in: danglingValueTiers.map((vt) => vt.id) } } });
    console.log(`  Excluídos: ${count}`);
  }

  const rulesWithTrigger = await prisma.receivablesTierRule.findMany({
    where: { goalTriggerId: { not: null } },
    include: { goalTrigger: true },
  });
  console.log(`\nRegras com goalTriggerId válido: ${rulesWithTrigger.length}`);

  for (const rule of rulesWithTrigger) {
    const trigger = rule.goalTrigger!;
    const valueTier = await prisma.receivablesValueTier.create({
      data: {
        companyId: rule.companyId,
        receivablesBaseId: rule.receivablesBaseId,
        order: trigger.order,
        thresholdValue: trigger.percentage,
        colorFlag: trigger.colorFlag,
      },
    });
    await prisma.receivablesTierRule.update({
      where: { id: rule.id },
      data: { valueTierId: valueTier.id, goalTriggerId: null },
    });
    console.log(`  OK: regra ${rule.id} (base ${rule.receivablesBaseId}) -> novo valueTier ${valueTier.id} (order=${trigger.order}, %=${trigger.percentage})`);
  }

  const orphanRules = await prisma.receivablesTierRule.findMany({
    where: { goalTriggerId: null, valueTierId: null },
  });
  console.log(`\nRegras órfãs (sem limiar algum, aprovado pelo usuário para excluir): ${orphanRules.length}`);
  if (orphanRules.length > 0) {
    const { count } = await prisma.receivablesTierRule.deleteMany({
      where: { id: { in: orphanRules.map((r) => r.id) } },
    });
    console.log(`  Excluídas: ${count}`);
  }

  console.log("\nBackfill concluído.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
