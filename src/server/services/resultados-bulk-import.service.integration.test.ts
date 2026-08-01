import { beforeEach, describe, expect, it } from "vitest";
import { prismaTest, resetDatabase, runWithTenant, seedTwoTenants, type TwoTenantFixtures } from "../test/fixtures";
import { commitResultsImport, type ParsedResultRow } from "./resultados-bulk-import.service";

// Fase 4 do plano de migração Supabase: o maior risco de RLS em escritas é
// exaustão do pool de conexões do Supavisor sob transações longas — os
// imports em massa já usam timeout de 30s (bulk-import.service.ts,
// resultados-bulk-import.service.ts). Este teste confirma que o role
// restrito (app_backend) sustenta um import de volume realista, inclusive
// concorrente, sem esgotar conexões nem violar RLS no meio do caminho.
describe("resultados-bulk-import.service — import em massa sob role restrito (RLS de escrita)", () => {
  let fixtures: TwoTenantFixtures;

  beforeEach(async () => {
    await resetDatabase();
    fixtures = await seedTwoTenants();
  });

  function buildRows(companyLabel: "A" | "B", count: number): ParsedResultRow[] {
    return Array.from({ length: count }, (_, i) => ({
      rowNumber: i + 1,
      errors: [],
      memberName: `Membro ${companyLabel}`,
      typeName: "Vendas",
      date: new Date(Date.UTC(2026, 6, 1 + (i % 28))),
      value: 100 + i,
      reason: null,
      kind: "resultado" as const,
    }));
  }

  it("commit de 100 linhas em uma única transação de escrita completa sem exaurir a conexão", async () => {
    const { tenantA } = fixtures;

    await prismaTest.resultType.create({
      data: { companyId: tenantA.companyId, name: "Vendas", unit: "MOEDA" },
    });

    const rows = buildRows("A", 100);

    const result = await runWithTenant(tenantA.companyId, () =>
      commitResultsImport(tenantA.companyId, tenantA.adminUser, rows),
    );

    expect(result.createdEntries).toBe(100);
    expect(result.createdAdjustments).toBe(0);

    const count = await prismaTest.resultEntry.count({ where: { companyId: tenantA.companyId } });
    expect(count).toBe(100);
  }, 40_000);

  it("dois imports concorrentes (empresas diferentes) completam sem interferência nem deadlock de pool", async () => {
    const { tenantA, tenantB } = fixtures;

    await prismaTest.resultType.create({ data: { companyId: tenantA.companyId, name: "Vendas", unit: "MOEDA" } });
    await prismaTest.resultType.create({ data: { companyId: tenantB.companyId, name: "Vendas", unit: "MOEDA" } });

    const rowsA = buildRows("A", 40);
    const rowsB = buildRows("B", 40);

    const [resultA, resultB] = await Promise.all([
      runWithTenant(tenantA.companyId, () => commitResultsImport(tenantA.companyId, tenantA.adminUser, rowsA)),
      runWithTenant(tenantB.companyId, () => commitResultsImport(tenantB.companyId, tenantB.adminUser, rowsB)),
    ]);

    expect(resultA.createdEntries).toBe(40);
    expect(resultB.createdEntries).toBe(40);

    // Prova que set_config(..., true) é de fato LOCAL à transação — a
    // corrida entre as duas conexões não vazou o companyId de uma para a
    // outra (cada import só criou linhas na própria empresa).
    const countA = await prismaTest.resultEntry.count({ where: { companyId: tenantA.companyId } });
    const countB = await prismaTest.resultEntry.count({ where: { companyId: tenantB.companyId } });
    expect(countA).toBe(40);
    expect(countB).toBe(40);
  }, 40_000);
});
