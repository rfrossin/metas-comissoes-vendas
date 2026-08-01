import { prisma, withTenant, writeWithTenant } from "../config/prisma";
import type { MemberStatus, MemberType, OrgNodeType } from "@prisma/client";
import { ConflictError, ForbiddenError, NotFoundError } from "../utils/http-errors";
import {
  assertAdmin,
  assertNodeWithinLedScope,
  resolveEditableNodeIds,
  resolveEditableMemberFilter,
  resolveLedMemberFilter,
  resolveLedNodeIds,
  resolveNativeVisibleMemberFilter,
  resolveRequesterMemberId,
  resolveResultsEditableMemberFilter,
  resolveVisibleMemberFilter,
  resolveVisibleNodeIds,
  type RequestingUser,
  type ScopeNodeIds,
} from "./scope.util";

const RESPONSIBLE_INCLUDE = {
  include: {
    member: {
      select: { id: true, fullName: true, cargo: { select: { name: true } } },
    },
  },
} as const;

export async function getOrgTree(companyId: string) {
  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      nodeResponsibles: {
        where: { nodeType: "EMPRESA" },
        ...RESPONSIBLE_INCLUDE,
      },
    },
  });

  const channels = await prisma.channel.findMany({
    where: { companyId },
    orderBy: { name: "asc" },
    include: {
      responsibles: RESPONSIBLE_INCLUDE,
      departments: {
        orderBy: { name: "asc" },
        include: {
          responsibles: RESPONSIBLE_INCLUDE,
          teams: {
            orderBy: { name: "asc" },
            include: {
              responsibles: RESPONSIBLE_INCLUDE,
              members: {
                orderBy: { fullName: "asc" },
                include: { cargo: { select: { id: true, name: true } } },
              },
            },
          },
        },
      },
    },
  });

  // Um Gestor sem Time (Coordenador/Gerente/Diretor) não é "sem hierarquia":
  // ele pertence à hierarquia que lidera (CANAL/DEPARTAMENTO/TIME/EMPRESA),
  // já representada pelos chips de `responsibles` em cada nível — por isso
  // a árvore não devolve mais um bucket separado "sem Time" (removido no
  // client junto com este ajuste).
  return {
    id: company.id,
    name: company.name,
    responsibles: company.nodeResponsibles,
    channels,
  };
}

// Listagem da aba Membros (Admin+Gestor, nunca Usuário — expõe Salário,
// dado sensível que a Estrutura não mostra). Todos os status (ao contrário
// de listAllActiveMembers, que só devolve ativos e não inclui Salário) e
// filtrada pelo mesmo escopo liderado que já vale para as ações de
// criar/editar/excluir Membro — um Gestor só vê (e só consegue agir sobre)
// quem está dentro do que ele lidera.
export async function listMembersForManagement(companyId: string, requestingUser: RequestingUser) {
  if (requestingUser.role === "OPERACIONAL") {
    throw new ForbiddenError("Usuários não têm acesso à gestão de Membros.");
  }

  const filter = await resolveLedMemberFilter(companyId, requestingUser);

  return prisma.member.findMany({
    where: filter === "ALL" ? { companyId } : { companyId, ...filter },
    orderBy: { fullName: "asc" },
    include: {
      cargo: { select: { id: true, name: true } },
      team: {
        select: {
          id: true,
          name: true,
          department: { select: { id: true, name: true, channel: { select: { id: true, name: true } } } },
        },
      },
      nodeResponsibleFor: {
        select: {
          nodeType: true,
          channelId: true,
          departmentId: true,
          teamId: true,
          channel: { select: { name: true } },
          department: { select: { name: true } },
          team: { select: { name: true } },
        },
      },
    },
  });
}

// Todos os membros ativos (Time Gestão + operacionais) — usado por outros
// módulos (Resultados, Metas, Recebíveis) para selecionar "de quem" é o dado.
// Inclui a hierarquia completa do Time (Departamento/Canal) para permitir
// filtros em cascata, e os nós dos quais o membro é Responsável — usado pelo
// seletor de Entidades no Escopo de Metas para sinalizar "é Responsável de X".
export async function listAllActiveMembers(companyId: string) {
  return prisma.member.findMany({
    where: { companyId, status: "ATIVO" },
    orderBy: { fullName: "asc" },
    select: {
      id: true,
      fullName: true,
      cargo: { select: { id: true, name: true } },
      team: {
        select: {
          id: true,
          name: true,
          department: {
            select: {
              id: true,
              name: true,
              channel: { select: { id: true, name: true } },
            },
          },
        },
      },
      nodeResponsibleFor: {
        select: {
          nodeType: true,
          channelId: true,
          departmentId: true,
          teamId: true,
          channel: { select: { name: true } },
          department: { select: { name: true } },
          team: { select: { name: true } },
        },
      },
    },
  });
}

export type ScopedOptionsMode = "led" | "visible" | "editable" | "native" | "results";

const SCOPED_MEMBER_INCLUDE = {
  cargo: { select: { id: true, name: true } },
  team: {
    select: {
      id: true,
      name: true,
      department: { select: { id: true, name: true, channel: { select: { id: true, name: true } } } },
    },
  },
  nodeResponsibleFor: {
    select: {
      nodeType: true,
      channelId: true,
      departmentId: true,
      teamId: true,
      channel: { select: { name: true } },
      department: { select: { name: true } },
      team: { select: { name: true } },
    },
  },
} as const;

// PASSO 9.1 — versão "podada" da árvore + lista de Membros, usada como
// fonte de dados de seletores (TeamSelect, LeadershipEditor, EntityPicker/
// EntityMultiPicker em modo escopado, HierarchyFilter) que precisam mostrar
// só o que o usuário tem permissão de escolher, em vez da empresa inteira
// (que é o que getOrgTree/listAllActiveMembers sempre devolveram, de
// propósito — outros consumidores como Sazonalidade/Agrupamento de Meta/
// Entidades Analisadas de Recebível continuam usando aqueles, sem filtro).
//
// "native" reaproveita o mesmo conjunto de nós de "visible": a exclusão de
// líder e a diferença entre resolveNativeVisibleMemberFilter/
// resolveVisibleMemberFilter só afetam quais MEMBROS entram, nunca quais
// NÓS — na camada de nós os dois coincidem para Gestor, e Usuário nunca
// chega a usar seletor de hierarquia em modo "native" (a tela já trava em
// "só eu mesmo" antes de precisar de um seletor).
//
// "results" reaproveita o mesmo conjunto de nós de "editable": o toggle
// User.canLaunchOwnMemberResults (que resolveResultsEditableMemberFilter
// soma por cima de resolveEditableMemberFilter) nunca adiciona escopo de
// HIERARQUIA — só libera um Membro específico (o vinculado ao próprio
// usuário), então não muda quais Canais/Departamentos/Times aparecem, só
// pode incluir 1 Membro a mais na lista.
export async function getScopedOrgOptions(companyId: string, requestingUser: RequestingUser, mode: ScopedOptionsMode) {
  const nodeIds: ScopeNodeIds =
    mode === "led"
      ? await resolveLedNodeIds(companyId, requestingUser)
      : mode === "editable" || mode === "results"
        ? await resolveEditableNodeIds(companyId, requestingUser)
        : await resolveVisibleNodeIds(companyId, requestingUser);

  const memberFilter =
    mode === "led"
      ? await resolveLedMemberFilter(companyId, requestingUser)
      : mode === "editable"
        ? await resolveEditableMemberFilter(companyId, requestingUser)
        : mode === "native"
          ? await resolveNativeVisibleMemberFilter(companyId, requestingUser)
          : mode === "results"
            ? await resolveResultsEditableMemberFilter(companyId, requestingUser)
            : await resolveVisibleMemberFilter(companyId, requestingUser);

  const unrestricted = nodeIds.channelIds === "ALL";

  const [channels, departments, teams, members] = await Promise.all([
    prisma.channel.findMany({
      where: { companyId, ...(nodeIds.channelIds === "ALL" ? {} : { id: { in: [...nodeIds.channelIds] } }) },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.department.findMany({
      where: { companyId, ...(nodeIds.departmentIds === "ALL" ? {} : { id: { in: [...nodeIds.departmentIds] } }) },
      orderBy: { name: "asc" },
      select: { id: true, name: true, channelId: true, channel: { select: { name: true } } },
    }),
    prisma.team.findMany({
      where: { companyId, ...(nodeIds.teamIds === "ALL" ? {} : { id: { in: [...nodeIds.teamIds] } }) },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        departmentId: true,
        department: { select: { name: true, channel: { select: { name: true } } } },
      },
    }),
    prisma.member.findMany({
      where: { companyId, status: "ATIVO", ...(memberFilter === "ALL" ? {} : { AND: [memberFilter] }) },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, ...SCOPED_MEMBER_INCLUDE },
    }),
  ]);

  return { unrestricted, channels, departments, teams, members };
}

// Criar/editar/excluir Canal continua exclusivo do Administrador — Canal
// não tem "pai" liderável abaixo de Empresa (só uma atribuição EMPRESA
// habilitaria, o que equivaleria a poder quase-Admin). Departamento/Time
// (abaixo) passaram, no PASSO 11.7, a aceitar também um Gestor cujo escopo
// liderado cubra o nó-pai (criar) ou o próprio nó (editar/excluir) — mesmo
// padrão já usado por createMember/updateMember.
export async function createChannel(companyId: string, requestingUser: RequestingUser, name: string) {
  assertAdmin(requestingUser, "Só Administradores podem criar um novo Canal.");
  return writeWithTenant((tx) => tx.channel.create({ data: { companyId, name } }));
}

export async function updateChannel(companyId: string, requestingUser: RequestingUser, id: string, name: string) {
  assertAdmin(requestingUser, "Só Administradores podem editar um Canal.");
  const channel = await prisma.channel.findFirst({ where: { id, companyId } });

  if (!channel) {
    throw new NotFoundError("Canal não encontrado");
  }

  return writeWithTenant((tx) => tx.channel.update({ where: { id }, data: { name } }));
}

export async function deleteChannel(companyId: string, requestingUser: RequestingUser, id: string) {
  assertAdmin(requestingUser, "Só Administradores podem excluir um Canal.");
  const channel = await prisma.channel.findFirst({
    where: { id, companyId },
    include: { _count: { select: { departments: true, responsibles: true } } },
  });

  if (!channel) {
    throw new NotFoundError("Canal não encontrado");
  }

  if (channel._count.departments > 0) {
    throw new ConflictError("Não é possível excluir: há Departamentos vinculados a este Canal.");
  }

  if (channel._count.responsibles > 0) {
    throw new ConflictError("Não é possível excluir: remova os Responsáveis deste Canal antes.");
  }

  await writeWithTenant((tx) => tx.channel.delete({ where: { id } }));
}

export async function createDepartment(companyId: string, requestingUser: RequestingUser, channelId: string, name: string) {
  const channel = await prisma.channel.findFirst({ where: { id: channelId, companyId } });

  if (!channel) {
    throw new NotFoundError("Canal não encontrado");
  }

  await assertNodeWithinLedScope(companyId, requestingUser, "CANAL", channelId);

  return writeWithTenant((tx) => tx.department.create({ data: { companyId, channelId, name } }));
}

export async function updateDepartment(companyId: string, requestingUser: RequestingUser, id: string, name: string) {
  const department = await prisma.department.findFirst({ where: { id, companyId } });

  if (!department) {
    throw new NotFoundError("Departamento não encontrado");
  }

  await assertNodeWithinLedScope(companyId, requestingUser, "DEPARTAMENTO", id);

  return writeWithTenant((tx) => tx.department.update({ where: { id }, data: { name } }));
}

export async function deleteDepartment(companyId: string, requestingUser: RequestingUser, id: string) {
  const department = await prisma.department.findFirst({
    where: { id, companyId },
    include: { _count: { select: { teams: true, responsibles: true } } },
  });

  if (!department) {
    throw new NotFoundError("Departamento não encontrado");
  }

  await assertNodeWithinLedScope(companyId, requestingUser, "DEPARTAMENTO", id);

  if (department._count.teams > 0) {
    throw new ConflictError("Não é possível excluir: há Times vinculados a este Departamento.");
  }

  if (department._count.responsibles > 0) {
    throw new ConflictError("Não é possível excluir: remova os Responsáveis deste Departamento antes.");
  }

  await writeWithTenant((tx) => tx.department.delete({ where: { id } }));
}

export async function createTeam(companyId: string, requestingUser: RequestingUser, departmentId: string, name: string) {
  const department = await prisma.department.findFirst({
    where: { id: departmentId, companyId },
  });

  if (!department) {
    throw new NotFoundError("Departamento não encontrado");
  }

  await assertNodeWithinLedScope(companyId, requestingUser, "DEPARTAMENTO", departmentId);

  return writeWithTenant((tx) => tx.team.create({ data: { companyId, departmentId, name } }));
}

export async function updateTeam(companyId: string, requestingUser: RequestingUser, id: string, name: string) {
  const team = await prisma.team.findFirst({ where: { id, companyId } });

  if (!team) {
    throw new NotFoundError("Time não encontrado");
  }

  await assertNodeWithinLedScope(companyId, requestingUser, "TIME", id);

  return writeWithTenant((tx) => tx.team.update({ where: { id }, data: { name } }));
}

export async function deleteTeam(companyId: string, requestingUser: RequestingUser, id: string) {
  const team = await prisma.team.findFirst({
    where: { id, companyId },
    include: { _count: { select: { members: true, responsibles: true } } },
  });

  if (!team) {
    throw new NotFoundError("Time não encontrado");
  }

  await assertNodeWithinLedScope(companyId, requestingUser, "TIME", id);

  if (team._count.members > 0) {
    throw new ConflictError("Não é possível excluir: há Membros vinculados a este Time.");
  }

  if (team._count.responsibles > 0) {
    throw new ConflictError("Não é possível excluir: remova os Responsáveis deste Time antes.");
  }

  await writeWithTenant((tx) => tx.team.delete({ where: { id } }));
}

// Uma hierarquia que um Membro Tipo GESTOR lidera — mesmo formato de nó
// usado em toda a Estrutura Organizacional (EMPRESA/CANAL/DEPARTAMENTO/
// TIME), sem memberId (é sempre o próprio Membro sendo criado/editado).
export type LeadershipTarget =
  | { nodeType: "EMPRESA" }
  | { nodeType: "CANAL"; channelId: string }
  | { nodeType: "DEPARTAMENTO"; departmentId: string }
  | { nodeType: "TIME"; teamId: string };

interface MemberCreateInput {
  fullName: string;
  cargoId: string;
  teamId: string | null;
  memberType: MemberType;
  customFixedSalary: number | null;
  leaderships: LeadershipTarget[];
}

interface MemberUpdateInput {
  fullName: string;
  cargoId: string;
  memberType: MemberType;
  customFixedSalary: number | null;
  status: MemberStatus;
  leaderships: LeadershipTarget[];
}

async function assertCargoBelongsToCompany(companyId: string, cargoId: string) {
  const cargo = await prisma.cargo.findFirst({ where: { id: cargoId, companyId } });

  if (!cargo) {
    throw new NotFoundError("Cargo não encontrado");
  }
}

async function resolveLeadershipTarget(companyId: string, data: LeadershipTarget) {
  switch (data.nodeType) {
    case "EMPRESA":
      return { channelId: null, departmentId: null, teamId: null };
    case "CANAL": {
      const channel = await prisma.channel.findFirst({ where: { id: data.channelId, companyId } });
      if (!channel) throw new NotFoundError("Canal não encontrado");
      return { channelId: data.channelId, departmentId: null, teamId: null };
    }
    case "DEPARTAMENTO": {
      const department = await prisma.department.findFirst({ where: { id: data.departmentId, companyId } });
      if (!department) throw new NotFoundError("Departamento não encontrado");
      return { channelId: null, departmentId: data.departmentId, teamId: null };
    }
    case "TIME": {
      const team = await prisma.team.findFirst({ where: { id: data.teamId, companyId } });
      if (!team) throw new NotFoundError("Time não encontrado");
      return { channelId: null, departmentId: null, teamId: data.teamId };
    }
  }
}

function leadershipNodeId(data: LeadershipTarget): string | null {
  switch (data.nodeType) {
    case "EMPRESA":
      return null;
    case "CANAL":
      return data.channelId;
    case "DEPARTAMENTO":
      return data.departmentId;
    case "TIME":
      return data.teamId;
  }
}

// Valida a lista de lideranças de um Membro Gestor (sem duplicados, cada nó
// existe na empresa, e o requisitante tem escopo liderado sobre cada um —
// mesma regra de qualquer outra escrita em Estrutura Organizacional) e
// devolve as linhas já resolvidas, prontas para gravar em NodeResponsible.
async function resolveLeadershipRows(companyId: string, requestingUser: RequestingUser, targets: LeadershipTarget[]) {
  const seen = new Set<string>();
  const rows: { nodeType: OrgNodeType; channelId: string | null; departmentId: string | null; teamId: string | null }[] = [];

  for (const target of targets) {
    const key = `${target.nodeType}:${leadershipNodeId(target) ?? ""}`;
    if (seen.has(key)) {
      throw new ConflictError("Uma mesma hierarquia não pode ser atribuída como liderança mais de uma vez.");
    }
    seen.add(key);

    const resolved = await resolveLeadershipTarget(companyId, target);
    await assertNodeWithinLedScope(companyId, requestingUser, target.nodeType, leadershipNodeId(target));
    rows.push({ nodeType: target.nodeType, ...resolved });
  }

  return rows;
}

// Membro com Time (teamId) ou sem Time (Admin-only, ex: Diretoria sem
// alocação operacional) — unificado num só fluxo, já que a aba Membros cria
// qualquer Membro num único formulário. Tipo GESTOR pode vir com Lideranças
// (uma ou mais hierarquias) atribuídas na mesma chamada.
export async function createMember(companyId: string, requestingUser: RequestingUser, data: MemberCreateInput) {
  if (data.teamId) {
    const team = await prisma.team.findFirst({ where: { id: data.teamId, companyId } });
    if (!team) throw new NotFoundError("Time não encontrado");
    await assertNodeWithinLedScope(companyId, requestingUser, "TIME", data.teamId);
  } else {
    assertAdmin(requestingUser, "Só Administradores podem criar um Membro sem Time.");
  }

  await assertCargoBelongsToCompany(companyId, data.cargoId);
  const leaderships = data.memberType === "GESTOR" ? data.leaderships : [];
  const leadershipRows = await resolveLeadershipRows(companyId, requestingUser, leaderships);

  return withTenant(async (tx) => {
    const member = await tx.member.create({
      data: {
        companyId,
        teamId: data.teamId,
        fullName: data.fullName,
        cargoId: data.cargoId,
        memberType: data.memberType,
        customFixedSalary: data.customFixedSalary,
      },
      include: { cargo: { select: { id: true, name: true } } },
    });

    if (leadershipRows.length > 0) {
      await tx.nodeResponsible.createMany({
        data: leadershipRows.map((row) => ({ companyId, memberId: member.id, ...row })),
      });
    }

    return member;
  });
}

// Nota: teamId propositalmente não é editável por aqui — a "Regra de Ouro" da
// spec exige que a transferência de time seja feita inativando este registro
// e criando um novo, nunca alterando o time de um membro já existente.
//
// Lideranças são substituídas por completo a cada save (mesmo padrão de
// replaceUserScopeAssignments): rebaixar memberType para OPERADOR no mesmo
// save já limpa as lideranças automaticamente (leaderships força [] acima),
// sem precisar de uma rodada extra ou bloqueio.
export async function updateMember(companyId: string, requestingUser: RequestingUser, id: string, data: MemberUpdateInput) {
  const member = await prisma.member.findFirst({ where: { id, companyId } });

  if (!member) {
    throw new NotFoundError("Membro não encontrado");
  }

  const requesterMemberId = await resolveRequesterMemberId(companyId, requestingUser);
  if (requestingUser.role === "LIDERANCA_NO" && member.id === requesterMemberId) {
    throw new ForbiddenError("Você não pode editar o seu próprio cadastro de Membro.");
  }
  await assertNodeWithinLedScope(companyId, requestingUser, "TIME", member.teamId);
  await assertCargoBelongsToCompany(companyId, data.cargoId);

  const leaderships = data.memberType === "GESTOR" ? data.leaderships : [];
  const leadershipRows = await resolveLeadershipRows(companyId, requestingUser, leaderships);

  return withTenant(async (tx) => {
    const updated = await tx.member.update({
      where: { id },
      data: {
        fullName: data.fullName,
        cargoId: data.cargoId,
        memberType: data.memberType,
        customFixedSalary: data.customFixedSalary,
        status: data.status,
        ...(data.status === "INATIVO" && member.status === "ATIVO" ? { inactivatedAt: new Date() } : {}),
      },
      include: { cargo: { select: { id: true, name: true } } },
    });

    await tx.nodeResponsible.deleteMany({ where: { companyId, memberId: id } });
    if (leadershipRows.length > 0) {
      await tx.nodeResponsible.createMany({
        data: leadershipRows.map((row) => ({ companyId, memberId: id, ...row })),
      });
    }

    return updated;
  });
}

// PASSO 11.7: excluir Membro é Admin-only, sem exceção pra Gestor — achado
// durante o levantamento (o código antigo usava só assertNodeWithinLedScope,
// deixando qualquer Gestor com o Time no escopo liderado excluir Membro,
// contradizendo a regra confirmada pelo usuário). Criar/editar Membro (e
// suas Lideranças) dentro do escopo liderado continua permitido a Gestor —
// só a exclusão do cadastro em si passou a ser Admin-only.
export async function deleteMember(companyId: string, requestingUser: RequestingUser, id: string) {
  assertAdmin(requestingUser, "Só Administradores podem excluir um Membro.");

  const member = await prisma.member.findFirst({
    where: { id, companyId },
    include: {
      _count: {
        select: {
          nodeResponsibleFor: true,
          // Resultados ficam sempre no cadastro do Membro (nunca no
          // Usuário/login — ver deleteUser em permissoes.service.ts) — as 6
          // relações abaixo têm FK obrigatória (memberId sem onDelete:
          // SetNull), então excluir o Membro quebraria a constraint do
          // banco. Checadas aqui pra dar um erro amigável em vez de deixar
          // estourar um erro genérico de banco na tentativa de exclusão.
          resultEntries: true,
          operationalAdjustments: true,
          receivablesBeneficiary: true,
          memberClosings: true,
          closureAuditLogs: true,
          financialSnapshots: true,
        },
      },
    },
  });

  if (!member) {
    throw new NotFoundError("Membro não encontrado");
  }

  if (member._count.nodeResponsibleFor > 0) {
    throw new ConflictError("Não é possível excluir: remova este membro como Responsável antes.");
  }

  const hasHistory =
    member._count.resultEntries > 0 ||
    member._count.operationalAdjustments > 0 ||
    member._count.receivablesBeneficiary > 0 ||
    member._count.memberClosings > 0 ||
    member._count.closureAuditLogs > 0 ||
    member._count.financialSnapshots > 0;
  if (hasHistory) {
    throw new ConflictError(
      "Este Membro possui Resultados, Ajustes, Recebíveis ou Fechamentos vinculados e não pode ser excluído. Desative-o em vez disso.",
    );
  }

  await writeWithTenant((tx) => tx.member.delete({ where: { id } }));
}
