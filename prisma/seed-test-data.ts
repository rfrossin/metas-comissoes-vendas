import "dotenv/config";
import { prismaAdmin as prisma } from "../src/server/config/prisma-admin";
import { Prisma } from "@prisma/client";

// Popula a "Empresa Teste Manual" (criada por seed-supabase-admin.ts) com
// estrutura organizacional e resultados realistas, para teste manual do
// app. Idempotente por nome: reaproveita Canal/Departamento/Time se já
// existirem, mas NÃO reaproveita Member/ResultEntry (rodar 2x duplica
// membros e lançamentos) — script de uso único por design.

const COMPANY_NAME = "Empresa Teste Manual";

type Perfil = "Junior" | "Pleno" | "Senior";
const PESO_PERFIL: Record<Perfil, number> = { Junior: 0.7, Pleno: 1.0, Senior: 1.4 };

interface VendedorSeed {
  nome: string;
  perfil: Perfil;
}

interface TimeSeed {
  nome: string;
  gestor: string;
  vendedores: VendedorSeed[];
}

interface DepartamentoSeed {
  nome: string;
  responsavel: string; // nome do gestor de um dos times, promovido a responsável do depto
  times: TimeSeed[];
}

interface CanalSeed {
  nome: string;
  responsavel: string;
  departamentos: DepartamentoSeed[];
}

const ESTRUTURA: CanalSeed[] = [
  {
    nome: "Varejo",
    responsavel: "Ana Ferreira",
    departamentos: [
      {
        nome: "Varejo SP",
        responsavel: "Ana Ferreira",
        times: [
          {
            nome: "Varejo SP A",
            gestor: "Ana Ferreira",
            vendedores: [
              { nome: "Bruno Costa", perfil: "Pleno" },
              { nome: "Camila Duarte", perfil: "Junior" },
            ],
          },
          {
            nome: "Varejo SP B",
            gestor: "Carla Souza",
            vendedores: [
              { nome: "Diego Alves", perfil: "Junior" },
              { nome: "Eduarda Freitas", perfil: "Pleno" },
            ],
          },
        ],
      },
      {
        nome: "Varejo RJ",
        responsavel: "Elisa Martins",
        times: [
          {
            nome: "Varejo RJ A",
            gestor: "Elisa Martins",
            vendedores: [
              { nome: "Felipe Nunes", perfil: "Pleno" },
              { nome: "Giovana Pires", perfil: "Senior" },
            ],
          },
          {
            nome: "Varejo RJ B",
            gestor: "Gabriela Lima",
            vendedores: [
              { nome: "Hugo Ribeiro", perfil: "Senior" },
              { nome: "Ivone Castro", perfil: "Pleno" },
            ],
          },
        ],
      },
    ],
  },
  {
    nome: "Corporativo",
    responsavel: "Isabela Rocha",
    departamentos: [
      {
        nome: "Key Accounts",
        responsavel: "Isabela Rocha",
        times: [
          {
            nome: "KA Nacional",
            gestor: "Isabela Rocha",
            vendedores: [
              { nome: "João Pereira", perfil: "Senior" },
              { nome: "Karina Melo", perfil: "Senior" },
            ],
          },
          {
            nome: "KA Regional",
            gestor: "Larissa Dias",
            vendedores: [
              { nome: "Marcos Teixeira", perfil: "Pleno" },
              { nome: "Nicole Farias", perfil: "Pleno" },
            ],
          },
        ],
      },
      {
        nome: "Distribuidores",
        responsavel: "Natália Cardoso",
        times: [
          {
            nome: "Dist. Sul",
            gestor: "Natália Cardoso",
            vendedores: [
              { nome: "Otávio Barros", perfil: "Junior" },
              { nome: "Paula Andrade", perfil: "Pleno" },
            ],
          },
          {
            nome: "Dist. Norte",
            gestor: "Patrícia Gomes",
            vendedores: [
              { nome: "Rafael Moreira", perfil: "Pleno" },
              { nome: "Sabrina Nogueira", perfil: "Junior" },
            ],
          },
        ],
      },
    ],
  },
];

const FATURAMENTO_ANUAL: Record<number, number> = { 2024: 10_000_000, 2025: 12_500_000, 2026: 9_000_000 };

// Faixas de contagem semanal (NUMERAL) por perfil — sem soma-alvo, só
// plausibilidade proporcional ao mesmo peso de "Valor de Vendas".
const NOVOS_CLIENTES_RANGE: Record<Perfil, [number, number]> = {
  Junior: [0, 2],
  Pleno: [1, 3],
  Senior: [2, 5],
};
const CLIENTES_ATENDIDOS_RANGE: Record<Perfil, [number, number]> = {
  Junior: [4, 9],
  Pleno: [7, 14],
  Senior: [11, 20],
};

// Mersenne Twister simplificado via LCG determinístico — reprodutível
// entre runs (mesma seed = mesmos dados), útil se precisarmos regenerar.
function makeRng(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}
const rng = makeRng(42);

function randomInRange(min: number, max: number): number {
  return min + rng() * (max - min);
}
function randomIntInRange(min: number, max: number): number {
  return Math.floor(randomInRange(min, max + 1));
}

// Semanas (segunda-feira) cobertas pelo ano, recortadas por [from, to].
function mondaysInRange(from: Date, to: Date): Date[] {
  const result: Date[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  // Anda até a próxima segunda-feira (getUTCDay: 0=domingo, 1=segunda).
  const dayOfWeek = cursor.getUTCDay();
  const offsetToMonday = dayOfWeek === 0 ? 1 : dayOfWeek === 1 ? 0 : 8 - dayOfWeek;
  cursor.setUTCDate(cursor.getUTCDate() + offsetToMonday);

  while (cursor <= to) {
    result.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return result;
}

// Fator de sazonalidade leve: Nov/Dez mais fortes, Jan/Fev mais fracos.
function seasonalityFactor(date: Date): number {
  const month = date.getUTCMonth(); // 0-indexed
  if (month === 10 || month === 11) return 1.25; // nov, dez
  if (month === 0 || month === 1) return 0.8; // jan, fev
  return 1.0;
}

async function main() {
  const company = await prisma.company.findFirst({ where: { name: COMPANY_NAME } });
  if (!company) {
    throw new Error(`Empresa "${COMPANY_NAME}" não encontrada — rode seed-supabase-admin.ts primeiro.`);
  }
  const companyId = company.id;

  // Cargo único para todos (mesmo padrão usado em seed.ts) — o campo
  // relevante para permissão é Member.memberType (OPERADOR/GESTOR), não o
  // Cargo em si. Cargo não tem @@unique([companyId, name]), daí o
  // findFirst manual em vez de upsert.
  const cargoGestor =
    (await prisma.cargo.findFirst({ where: { companyId, name: "Gestor de Time" } })) ??
    (await prisma.cargo.create({
      data: { companyId, name: "Gestor de Time", defaultFixedSalary: 6000, permissionLevel: "LIDERANCA_NO" },
    }));
  const cargoVendedor =
    (await prisma.cargo.findFirst({ where: { companyId, name: "Vendedor" } })) ??
    (await prisma.cargo.create({
      data: { companyId, name: "Vendedor", defaultFixedSalary: 3000, permissionLevel: "OPERACIONAL" },
    }));

  const resultTypeVendas = await prisma.resultType.upsert({
    where: { companyId_name: { companyId, name: "Valor de Vendas" } },
    update: {},
    create: { companyId, name: "Valor de Vendas", unit: "MOEDA" },
  });
  const resultTypeNovosClientes = await prisma.resultType.upsert({
    where: { companyId_name: { companyId, name: "Novos Clientes" } },
    update: {},
    create: { companyId, name: "Novos Clientes", unit: "NUMERAL" },
  });
  const resultTypeClientesAtendidos = await prisma.resultType.upsert({
    where: { companyId_name: { companyId, name: "Clientes Atendidos" } },
    update: {},
    create: { companyId, name: "Clientes Atendidos", unit: "NUMERAL" },
  });

  // Coleta todos os vendedores com peso, para calcular a fração de cada um
  // no faturamento anual da empresa antes de criar qualquer Member.
  const todosVendedores = ESTRUTURA.flatMap((c) => c.departamentos.flatMap((d) => d.times.flatMap((t) => t.vendedores)));
  const pesoTotal = todosVendedores.reduce((sum, v) => sum + PESO_PERFIL[v.perfil], 0);

  const memberIdByName = new Map<string, string>();
  const perfilByName = new Map<string, Perfil>();
  const vendedorMemberIds: string[] = [];

  let totalMembers = 0;
  let totalResponsibles = 0;

  for (const canal of ESTRUTURA) {
    const channel = await prisma.channel.create({ data: { companyId, name: `Canal ${canal.nome}` } });

    for (const depto of canal.departamentos) {
      const department = await prisma.department.create({
        data: { companyId, channelId: channel.id, name: `Depto ${depto.nome}` },
      });

      for (const time of depto.times) {
        const team = await prisma.team.create({
          data: { companyId, departmentId: department.id, name: `Time ${time.nome}` },
        });

        const gestorMember = await prisma.member.create({
          data: {
            companyId,
            teamId: team.id,
            cargoId: cargoGestor.id,
            fullName: time.gestor,
            memberType: "GESTOR",
            status: "ATIVO",
          },
        });
        memberIdByName.set(time.gestor, gestorMember.id);
        totalMembers++;

        // Responsável do Time — sempre o gestor do próprio time.
        await prisma.nodeResponsible.create({
          data: { companyId, nodeType: "TIME", teamId: team.id, memberId: gestorMember.id },
        });
        totalResponsibles++;

        for (const vendedor of time.vendedores) {
          const member = await prisma.member.create({
            data: {
              companyId,
              teamId: team.id,
              cargoId: cargoVendedor.id,
              fullName: vendedor.nome,
              memberType: "OPERADOR",
              status: "ATIVO",
            },
          });
          memberIdByName.set(vendedor.nome, member.id);
          perfilByName.set(vendedor.nome, vendedor.perfil);
          vendedorMemberIds.push(member.id);
          totalMembers++;
        }
      }

      // Responsável do Departamento — o gestor indicado (já criado acima,
      // reaproveita o memberId existente em vez de criar um Member novo).
      const deptoResponsavelId = memberIdByName.get(depto.responsavel);
      if (!deptoResponsavelId) throw new Error(`Responsável de depto não encontrado: ${depto.responsavel}`);
      await prisma.nodeResponsible.create({
        data: { companyId, nodeType: "DEPARTAMENTO", departmentId: department.id, memberId: deptoResponsavelId },
      });
      totalResponsibles++;
    }

    const canalResponsavelId = memberIdByName.get(canal.responsavel);
    if (!canalResponsavelId) throw new Error(`Responsável de canal não encontrado: ${canal.responsavel}`);
    await prisma.nodeResponsible.create({
      data: { companyId, nodeType: "CANAL", channelId: channel.id, memberId: canalResponsavelId },
    });
    totalResponsibles++;
  }

  console.log(`Estrutura criada: ${totalMembers} membros, ${totalResponsibles} responsáveis.`);

  // ============================================================
  // Resultados
  // ============================================================

  const today = new Date(); // execução real — cobre até "agora" em 2026
  const periods: Array<{ year: number; from: Date; to: Date }> = [
    { year: 2024, from: new Date(Date.UTC(2024, 0, 1)), to: new Date(Date.UTC(2024, 11, 31)) },
    { year: 2025, from: new Date(Date.UTC(2025, 0, 1)), to: new Date(Date.UTC(2025, 11, 31)) },
    {
      year: 2026,
      from: new Date(Date.UTC(2026, 0, 1)),
      to: today < new Date(Date.UTC(2026, 11, 31)) ? today : new Date(Date.UTC(2026, 11, 31)),
    },
  ];

  const BATCH_SIZE = 500;
  let buffer: Prisma.ResultEntryCreateManyInput[] = [];
  let totalEntries = 0;

  async function flush() {
    if (buffer.length === 0) return;
    await prisma.resultEntry.createMany({ data: buffer });
    totalEntries += buffer.length;
    buffer = [];
  }

  const somaVendasPorAno: Record<number, number> = { 2024: 0, 2025: 0, 2026: 0 };

  for (const { year, from, to } of periods) {
    const mondays = mondaysInRange(from, to);
    const totalAno = FATURAMENTO_ANUAL[year];

    for (const vendedorNome of memberIdByName.keys()) {
      const perfil = perfilByName.get(vendedorNome);
      if (!perfil) continue; // é gestor, não vendedor — sem lançamento

      const memberId = memberIdByName.get(vendedorNome)!;
      const pesoVendedor = PESO_PERFIL[perfil];
      const totalVendedorAno = totalAno * (pesoVendedor / pesoTotal);

      // Distribui o total anual do vendedor entre as semanas, ponderado
      // por sazonalidade + ruído aleatório — depois normaliza para a soma
      // bater exatamente com totalVendedorAno.
      const pesosSemanais = mondays.map((m) => seasonalityFactor(m) * randomInRange(0.7, 1.3));
      const somaPesos = pesosSemanais.reduce((s, p) => s + p, 0);

      mondays.forEach((monday, idx) => {
        const fracao = pesosSemanais[idx] / somaPesos;
        const valorVendas = Math.round(totalVendedorAno * fracao * 100) / 100;

        buffer.push({
          companyId,
          memberId,
          typeId: resultTypeVendas.id,
          date: monday,
          value: new Prisma.Decimal(valorVendas),
        });
        somaVendasPorAno[year] += valorVendas;

        const [ncMin, ncMax] = NOVOS_CLIENTES_RANGE[perfil];
        buffer.push({
          companyId,
          memberId,
          typeId: resultTypeNovosClientes.id,
          date: monday,
          value: new Prisma.Decimal(randomIntInRange(ncMin, ncMax)),
        });

        const [caMin, caMax] = CLIENTES_ATENDIDOS_RANGE[perfil];
        buffer.push({
          companyId,
          memberId,
          typeId: resultTypeClientesAtendidos.id,
          date: monday,
          value: new Prisma.Decimal(randomIntInRange(caMin, caMax)),
        });
      });

      if (buffer.length >= BATCH_SIZE) await flush();
    }
  }
  await flush();

  console.log(`Resultados inseridos: ${totalEntries} linhas.`);
  console.log("Soma de Valor de Vendas por ano (conferir contra o alvo):");
  for (const [year, total] of Object.entries(FATURAMENTO_ANUAL)) {
    const gerado = somaVendasPorAno[Number(year)];
    console.log(`  ${year}: alvo=${total.toLocaleString("pt-BR")} gerado=${Math.round(gerado).toLocaleString("pt-BR")}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
