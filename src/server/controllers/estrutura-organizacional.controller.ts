import type { Request, Response } from "express";
import { z } from "zod";
import {
  createChannel,
  createDepartment,
  createMember,
  createTeam,
  deleteChannel,
  deleteDepartment,
  deleteMember,
  deleteTeam,
  getOrgTree,
  getScopedOrgOptions,
  listAllActiveMembers,
  listMembersForManagement,
  updateChannel,
  updateDepartment,
  updateMember,
  updateTeam,
} from "../services/estrutura-organizacional.service";
import { ConflictError, ForbiddenError, NotFoundError } from "../utils/http-errors";

const nameSchema = z.object({ name: z.string().min(1) });
const departmentCreateSchema = nameSchema.extend({ channelId: z.string().min(1) });
const teamCreateSchema = nameSchema.extend({ departmentId: z.string().min(1) });

const scopedOptionsModeSchema = z.enum(["led", "visible", "editable", "native", "results"]);

const memberTypeSchema = z.enum(["OPERADOR", "GESTOR"]);

// Uma hierarquia que o Membro (Tipo GESTOR) lidera — mesmo formato de nó
// usado no resto da Estrutura Organizacional, sem memberId (é sempre o
// próprio Membro sendo criado/editado).
const leadershipTargetSchema = z.discriminatedUnion("nodeType", [
  z.object({ nodeType: z.literal("EMPRESA") }),
  z.object({ nodeType: z.literal("CANAL"), channelId: z.string().min(1) }),
  z.object({ nodeType: z.literal("DEPARTAMENTO"), departmentId: z.string().min(1) }),
  z.object({ nodeType: z.literal("TIME"), teamId: z.string().min(1) }),
]);

// Datas de vínculo (entrada/saída na empresa): delimitam de quando até
// quando o Membro tem Recebíveis e Fechamentos. Formato YYYY-MM-DD, ambas
// opcionais — sem entrada vale desde sempre, sem saída o vínculo segue
// aberto.
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato AAAA-MM-DD");
const employmentDatesSchema = {
  entryDate: isoDateSchema.nullable().optional().default(null),
  exitDate: isoDateSchema.nullable().optional().default(null),
};

const memberCreateSchema = z.object({
  fullName: z.string().min(1),
  cargoId: z.string().min(1),
  teamId: z.string().min(1).nullable(),
  memberType: memberTypeSchema,
  customFixedSalary: z.number().nonnegative().nullable().optional().default(null),
  leaderships: z.array(leadershipTargetSchema).optional().default([]),
  ...employmentDatesSchema,
});

// teamId propositalmente ausente aqui — imutável após a criação (Regra de
// Ouro: transferência de Time = inativar + criar novo Membro).
const memberUpdateSchema = z.object({
  fullName: z.string().min(1),
  cargoId: z.string().min(1),
  memberType: memberTypeSchema,
  customFixedSalary: z.number().nonnegative().nullable().optional().default(null),
  status: z.enum(["ATIVO", "INATIVO"]),
  leaderships: z.array(leadershipTargetSchema).optional().default([]),
  ...employmentDatesSchema,
});

function respondToError(error: unknown, res: Response) {
  if (error instanceof NotFoundError) {
    res.status(404).json({ message: error.message });
    return;
  }

  if (error instanceof ConflictError) {
    res.status(409).json({ message: error.message });
    return;
  }

  if (error instanceof ForbiddenError) {
    res.status(403).json({ message: error.message });
    return;
  }

  throw error;
}

export async function getTreeHandler(req: Request, res: Response) {
  const tree = await getOrgTree(req.user!.companyId);
  res.json(tree);
}

export async function createChannelHandler(req: Request, res: Response) {
  const parsed = nameSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: "Dados inválidos" });
    return;
  }

  try {
    const channel = await createChannel(req.user!.companyId, req.user!, parsed.data.name);
    res.status(201).json(channel);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function updateChannelHandler(req: Request, res: Response) {
  const parsed = nameSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: "Dados inválidos" });
    return;
  }

  try {
    const channel = await updateChannel(req.user!.companyId, req.user!, req.params.id, parsed.data.name);
    res.json(channel);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function deleteChannelHandler(req: Request, res: Response) {
  try {
    await deleteChannel(req.user!.companyId, req.user!, req.params.id);
    res.status(204).send();
  } catch (error) {
    respondToError(error, res);
  }
}

export async function createDepartmentHandler(req: Request, res: Response) {
  const parsed = departmentCreateSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: "Dados inválidos" });
    return;
  }

  try {
    const department = await createDepartment(
      req.user!.companyId,
      req.user!,
      parsed.data.channelId,
      parsed.data.name,
    );
    res.status(201).json(department);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function updateDepartmentHandler(req: Request, res: Response) {
  const parsed = nameSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: "Dados inválidos" });
    return;
  }

  try {
    const department = await updateDepartment(req.user!.companyId, req.user!, req.params.id, parsed.data.name);
    res.json(department);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function deleteDepartmentHandler(req: Request, res: Response) {
  try {
    await deleteDepartment(req.user!.companyId, req.user!, req.params.id);
    res.status(204).send();
  } catch (error) {
    respondToError(error, res);
  }
}

export async function createTeamHandler(req: Request, res: Response) {
  const parsed = teamCreateSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: "Dados inválidos" });
    return;
  }

  try {
    const team = await createTeam(req.user!.companyId, req.user!, parsed.data.departmentId, parsed.data.name);
    res.status(201).json(team);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function updateTeamHandler(req: Request, res: Response) {
  const parsed = nameSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: "Dados inválidos" });
    return;
  }

  try {
    const team = await updateTeam(req.user!.companyId, req.user!, req.params.id, parsed.data.name);
    res.json(team);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function deleteTeamHandler(req: Request, res: Response) {
  try {
    await deleteTeam(req.user!.companyId, req.user!, req.params.id);
    res.status(204).send();
  } catch (error) {
    respondToError(error, res);
  }
}

export async function createMemberHandler(req: Request, res: Response) {
  const parsed = memberCreateSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: "Dados inválidos" });
    return;
  }

  try {
    const member = await createMember(req.user!.companyId, req.user!, parsed.data);
    res.status(201).json(member);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function updateMemberHandler(req: Request, res: Response) {
  const parsed = memberUpdateSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: "Dados inválidos" });
    return;
  }

  try {
    const member = await updateMember(req.user!.companyId, req.user!, req.params.id, parsed.data);
    res.json(member);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function deleteMemberHandler(req: Request, res: Response) {
  try {
    await deleteMember(req.user!.companyId, req.user!, req.params.id);
    res.status(204).send();
  } catch (error) {
    respondToError(error, res);
  }
}

export async function listAllActiveMembersHandler(req: Request, res: Response) {
  const members = await listAllActiveMembers(req.user!.companyId);
  res.json(members);
}

export async function listMembersForManagementHandler(req: Request, res: Response) {
  try {
    const members = await listMembersForManagement(req.user!.companyId, req.user!);
    res.json(members);
  } catch (error) {
    respondToError(error, res);
  }
}

export async function getScopedOrgOptionsHandler(req: Request, res: Response) {
  const parsed = scopedOptionsModeSchema.safeParse(req.query.mode);
  if (!parsed.success) {
    res.status(400).json({ message: "Parâmetro 'mode' inválido (use led, visible, editable, native ou results)." });
    return;
  }

  try {
    const options = await getScopedOrgOptions(req.user!.companyId, req.user!, parsed.data);
    res.json(options);
  } catch (error) {
    respondToError(error, res);
  }
}
