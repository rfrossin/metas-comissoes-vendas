import * as XLSX from "xlsx";
import { prisma, withTenant } from "../config/prisma";
import type { Prisma } from "@prisma/client";
import { ConflictError, ForbiddenError } from "../utils/http-errors";
import { assertAdmin, assertNodeWithinLedScope, type RequestingUser } from "./scope.util";

type ResponsibleLevel = "EMPRESA" | "CANAL" | "DEPARTAMENTO" | "TIME";

const RESPONSIBLE_LEVELS: ResponsibleLevel[] = ["EMPRESA", "CANAL", "DEPARTAMENTO", "TIME"];

interface RawRow {
  Canal?: string;
  Departamento?: string;
  Time?: string;
  Nome?: string;
  Cargo?: string;
  SalarioCustomizado?: string;
  Responsavel?: string;
  NivelResponsavel?: string;
}

export interface ParsedRow {
  rowNumber: number;
  errors: string[];
  channelName: string | null;
  departmentName: string | null;
  teamName: string | null;
  memberName: string;
  cargoName: string;
  customFixedSalary: number | null;
  isResponsible: boolean;
  responsibleLevel: ResponsibleLevel | null;
}

// Tipo do Membro é derivado da própria coluna Responsavel (não precisa de
// uma coluna extra): linha marcada "Responsavel=Sim" vira GESTOR (é assim
// que a planilha já expressa "este Membro lidera uma hierarquia"); o resto
// vira OPERADOR.
export const BULK_IMPORT_TEMPLATE_HEADERS = [
  "Canal",
  "Departamento",
  "Time",
  "Nome",
  "Cargo",
  "SalarioCustomizado",
  "Responsavel",
  "NivelResponsavel",
] as const;

const HEADER_MAP: Record<string, keyof RawRow> = {
  canal: "Canal",
  departamento: "Departamento",
  time: "Time",
  nome: "Nome",
  cargo: "Cargo",
  salariocustomizado: "SalarioCustomizado",
  responsavel: "Responsavel",
  nivelresponsavel: "NivelResponsavel",
};

export function parseSpreadsheet(buffer: Buffer): Record<string, string>[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    return [];
  }

  const sheet = workbook.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "", raw: false });
}

function normalizeHeaders(raw: Record<string, string>): RawRow {
  const result: RawRow = {};

  for (const [key, value] of Object.entries(raw)) {
    const canonical = HEADER_MAP[key.trim().toLowerCase()];

    if (canonical) {
      result[canonical] = value;
    }
  }

  return result;
}

function parseNumber(value: string | undefined): number | null {
  if (!value || value.trim() === "") {
    return null;
  }

  const normalized = value.replace(",", ".");
  const parsed = Number(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseRow(rowNumber: number, raw: RawRow): ParsedRow {
  const channelName = raw.Canal?.trim() || null;
  const departmentName = raw.Departamento?.trim() || null;
  const teamName = raw.Time?.trim() || null;
  const memberName = raw.Nome?.trim() || "";
  const cargoName = raw.Cargo?.trim() || "";
  const isResponsible = (raw.Responsavel?.trim().toLowerCase() ?? "") === "sim";
  const nivelRaw = raw.NivelResponsavel?.trim().toUpperCase() ?? "";
  const responsibleLevel = RESPONSIBLE_LEVELS.includes(nivelRaw as ResponsibleLevel)
    ? (nivelRaw as ResponsibleLevel)
    : null;

  const fields = {
    channelName,
    departmentName,
    teamName,
    memberName,
    cargoName,
    isResponsible,
    responsibleLevel,
  };

  return {
    rowNumber,
    errors: validateRowFields(fields),
    channelName,
    departmentName,
    teamName,
    memberName,
    cargoName,
    customFixedSalary: parseNumber(raw.SalarioCustomizado),
    isResponsible,
    responsibleLevel,
  };
}

interface RowFields {
  channelName: string | null;
  departmentName: string | null;
  teamName: string | null;
  memberName: string;
  cargoName: string;
  isResponsible: boolean;
  responsibleLevel: ResponsibleLevel | null;
}

// Regras de negócio da planilha, isoladas para poderem ser reaplicadas no
// commit (não confiamos apenas na validação já feita na prévia).
export function validateRowFields(fields: RowFields): string[] {
  const { channelName, departmentName, teamName, memberName, cargoName, isResponsible, responsibleLevel } =
    fields;
  const errors: string[] = [];

  if (!memberName) {
    errors.push("Nome é obrigatório.");
  }

  if (!cargoName) {
    errors.push("Cargo é obrigatório.");
  }

  if (isResponsible) {
    if (!responsibleLevel) {
      errors.push("Responsavel = Sim exige NivelResponsavel (EMPRESA, CANAL, DEPARTAMENTO ou TIME).");
    } else if (responsibleLevel === "CANAL" && !channelName) {
      errors.push("NivelResponsavel = CANAL exige a coluna Canal preenchida.");
    } else if (responsibleLevel === "DEPARTAMENTO" && (!channelName || !departmentName)) {
      errors.push("NivelResponsavel = DEPARTAMENTO exige Canal e Departamento preenchidos.");
    } else if (responsibleLevel === "TIME" && (!channelName || !departmentName || !teamName)) {
      errors.push("NivelResponsavel = TIME exige Canal, Departamento e Time preenchidos.");
    }
  } else if (teamName && (!channelName || !departmentName)) {
    errors.push("Time preenchido exige Canal e Departamento preenchidos.");
  }

  return errors;
}

export function parseWorkbookRows(buffer: Buffer): ParsedRow[] {
  const rawRows = parseSpreadsheet(buffer);
  // Linha 1 da planilha é o cabeçalho; os dados começam na linha 2.
  return rawRows.map((raw, index) => parseRow(index + 2, normalizeHeaders(raw)));
}

// Resolver "a seco": nunca escreve no banco, só descobre se uma entidade já
// existe ou seria criada — usado pela prévia, para o usuário conferir antes
// de confirmar. Cacheia por caminho de nome para não contar a mesma entidade
// como "nova" mais de uma vez quando várias linhas a referenciam.
function createDryRunResolver(companyId: string) {
  const channelIsNew = new Map<string, boolean>();
  const departmentIsNew = new Map<string, boolean>();
  const teamIsNew = new Map<string, boolean>();
  const cargoIsNew = new Map<string, boolean>();

  async function channel(name: string): Promise<boolean> {
    if (channelIsNew.has(name)) {
      return channelIsNew.get(name)!;
    }

    const existing = await prisma.channel.findFirst({ where: { companyId, name } });
    const isNew = !existing;
    channelIsNew.set(name, isNew);
    return isNew;
  }

  async function department(channelName: string, name: string): Promise<boolean> {
    const key = `${channelName}>${name}`;

    if (departmentIsNew.has(key)) {
      return departmentIsNew.get(key)!;
    }

    const channelNew = await channel(channelName);
    let isNew: boolean;

    if (channelNew) {
      isNew = true;
    } else {
      const ch = await prisma.channel.findFirst({ where: { companyId, name: channelName } });
      const existing = ch ? await prisma.department.findFirst({ where: { channelId: ch.id, name } }) : null;
      isNew = !existing;
    }

    departmentIsNew.set(key, isNew);
    return isNew;
  }

  async function team(channelName: string, departmentName: string, name: string): Promise<boolean> {
    const key = `${channelName}>${departmentName}>${name}`;

    if (teamIsNew.has(key)) {
      return teamIsNew.get(key)!;
    }

    const departmentNew = await department(channelName, departmentName);
    let isNew: boolean;

    if (departmentNew) {
      isNew = true;
    } else {
      const ch = await prisma.channel.findFirst({ where: { companyId, name: channelName } });
      const dept = ch
        ? await prisma.department.findFirst({ where: { channelId: ch.id, name: departmentName } })
        : null;
      const existing = dept ? await prisma.team.findFirst({ where: { departmentId: dept.id, name } }) : null;
      isNew = !existing;
    }

    teamIsNew.set(key, isNew);
    return isNew;
  }

  async function cargo(name: string): Promise<boolean> {
    if (cargoIsNew.has(name)) {
      return cargoIsNew.get(name)!;
    }

    const existing = await prisma.cargo.findFirst({ where: { companyId, name } });
    const isNew = !existing;
    cargoIsNew.set(name, isNew);
    return isNew;
  }

  function countNew(map: Map<string, boolean>) {
    return [...map.values()].filter(Boolean).length;
  }

  return {
    channel,
    department,
    team,
    cargo,
    summary: () => ({
      newChannels: countNew(channelIsNew),
      newDepartments: countNew(departmentIsNew),
      newTeams: countNew(teamIsNew),
      newCargos: countNew(cargoIsNew),
    }),
  };
}

export interface PreviewRow {
  rowNumber: number;
  valid: boolean;
  errors: string[];
  channelName: string | null;
  departmentName: string | null;
  teamName: string | null;
  memberName: string;
  cargoName: string;
  customFixedSalary: number | null;
  isResponsible: boolean;
  responsibleLevel: ResponsibleLevel | null;
  willCreateChannel: boolean;
  willCreateDepartment: boolean;
  willCreateTeam: boolean;
  willCreateCargo: boolean;
}

export interface BulkImportPreview {
  rows: PreviewRow[];
  summary: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
    newChannels: number;
    newDepartments: number;
    newTeams: number;
    newCargos: number;
    newMembers: number;
    newResponsibles: number;
  };
}

export async function buildPreview(companyId: string, rows: ParsedRow[]): Promise<BulkImportPreview> {
  const resolver = createDryRunResolver(companyId);
  const previewRows: PreviewRow[] = [];

  for (const row of rows) {
    let willCreateChannel = false;
    let willCreateDepartment = false;
    let willCreateTeam = false;
    let willCreateCargo = false;

    if (row.errors.length === 0) {
      willCreateCargo = await resolver.cargo(row.cargoName);

      if (row.isResponsible) {
        if (row.responsibleLevel !== "EMPRESA" && row.channelName) {
          willCreateChannel = await resolver.channel(row.channelName);
        }

        if ((row.responsibleLevel === "DEPARTAMENTO" || row.responsibleLevel === "TIME") && row.channelName && row.departmentName) {
          willCreateDepartment = await resolver.department(row.channelName, row.departmentName);
        }

        if (row.responsibleLevel === "TIME" && row.channelName && row.departmentName && row.teamName) {
          willCreateTeam = await resolver.team(row.channelName, row.departmentName, row.teamName);
        }
      } else if (row.teamName && row.channelName && row.departmentName) {
        willCreateChannel = await resolver.channel(row.channelName);
        willCreateDepartment = await resolver.department(row.channelName, row.departmentName);
        willCreateTeam = await resolver.team(row.channelName, row.departmentName, row.teamName);
      }
    }

    previewRows.push({
      rowNumber: row.rowNumber,
      valid: row.errors.length === 0,
      errors: row.errors,
      channelName: row.channelName,
      departmentName: row.departmentName,
      teamName: row.teamName,
      memberName: row.memberName,
      cargoName: row.cargoName,
      customFixedSalary: row.customFixedSalary,
      isResponsible: row.isResponsible,
      responsibleLevel: row.responsibleLevel,
      willCreateChannel,
      willCreateDepartment,
      willCreateTeam,
      willCreateCargo,
    });
  }

  const entitySummary = resolver.summary();
  const validRows = previewRows.filter((row) => row.valid);

  return {
    rows: previewRows,
    summary: {
      totalRows: previewRows.length,
      validRows: validRows.length,
      invalidRows: previewRows.length - validRows.length,
      ...entitySummary,
      newMembers: validRows.length,
      newResponsibles: validRows.filter((row) => row.isResponsible).length,
    },
  };
}

// Resolver persistente: mesma lógica de "achar ou criar", mas dentro de uma
// transação, reaproveitando entre linhas o que já foi criado nesta mesma
// importação (ex: duas linhas que citam o mesmo Canal só criam um Canal).
function createPersistingResolver(tx: Prisma.TransactionClient, companyId: string) {
  const channelIds = new Map<string, string>();
  const departmentIds = new Map<string, string>();
  const teamIds = new Map<string, string>();
  const cargoIds = new Map<string, string>();

  async function channel(name: string): Promise<string> {
    if (channelIds.has(name)) {
      return channelIds.get(name)!;
    }

    let existing = await tx.channel.findFirst({ where: { companyId, name } });

    if (!existing) {
      existing = await tx.channel.create({ data: { companyId, name } });
    }

    channelIds.set(name, existing.id);
    return existing.id;
  }

  async function department(channelName: string, name: string): Promise<string> {
    const key = `${channelName}>${name}`;

    if (departmentIds.has(key)) {
      return departmentIds.get(key)!;
    }

    const channelId = await channel(channelName);
    let existing = await tx.department.findFirst({ where: { channelId, name } });

    if (!existing) {
      existing = await tx.department.create({ data: { companyId, channelId, name } });
    }

    departmentIds.set(key, existing.id);
    return existing.id;
  }

  async function team(channelName: string, departmentName: string, name: string): Promise<string> {
    const key = `${channelName}>${departmentName}>${name}`;

    if (teamIds.has(key)) {
      return teamIds.get(key)!;
    }

    const departmentId = await department(channelName, departmentName);
    let existing = await tx.team.findFirst({ where: { departmentId, name } });

    if (!existing) {
      existing = await tx.team.create({ data: { companyId, departmentId, name } });
    }

    teamIds.set(key, existing.id);
    return existing.id;
  }

  async function cargo(name: string): Promise<string> {
    if (cargoIds.has(name)) {
      return cargoIds.get(name)!;
    }

    let existing = await tx.cargo.findFirst({ where: { companyId, name } });

    if (!existing) {
      existing = await tx.cargo.create({
        data: { companyId, name, defaultFixedSalary: 0, permissionLevel: "OPERACIONAL" },
      });
    }

    cargoIds.set(name, existing.id);
    return existing.id;
  }

  return { channel, department, team, cargo };
}

async function resolveResponsibleTargetForCommit(
  resolver: ReturnType<typeof createPersistingResolver>,
  row: ParsedRow,
) {
  switch (row.responsibleLevel) {
    case "EMPRESA":
      return { channelId: null, departmentId: null, teamId: null };
    case "CANAL": {
      const channelId = await resolver.channel(row.channelName!);
      return { channelId, departmentId: null, teamId: null };
    }
    case "DEPARTAMENTO": {
      const departmentId = await resolver.department(row.channelName!, row.departmentName!);
      return { channelId: null, departmentId, teamId: null };
    }
    case "TIME": {
      const teamId = await resolver.team(row.channelName!, row.departmentName!, row.teamName!);
      return { channelId: null, departmentId: null, teamId };
    }
    default:
      // Não deve acontecer: validado antes de chegar aqui.
      throw new ConflictError("Linha de responsável sem nível válido.");
  }
}

export interface BulkImportCommitResult {
  createdMembers: number;
  createdResponsibles: number;
}

// PASSO 5b: LIDERANCA_NO só pode importar linhas cujo Membro caia dentro da
// própria hierarquia — checado ANTES de abrir a transação (leitura contra o
// estado já commitado do banco; ver comentário em commitBulkImport sobre por
// que isso roda fora da transação). Linhas de Responsável (Membro sem Time,
// vira Tipo GESTOR) seguem a mesma regra de createMember sem Time: Admin-only.
async function assertRowWithinLedScope(companyId: string, requestingUser: RequestingUser, row: ParsedRow): Promise<void> {
  if (requestingUser.role === "ADMINISTRADOR") return;

  if (row.isResponsible) {
    throw new ForbiddenError(`Linha ${row.rowNumber}: só Administradores podem importar Responsáveis (Time Gestão).`);
  }

  if (!row.channelName || !row.departmentName || !row.teamName) {
    throw new ForbiddenError(`Linha ${row.rowNumber}: você só pode importar Membros vinculados a um Time.`);
  }

  const channel = await prisma.channel.findFirst({ where: { companyId, name: row.channelName } });
  if (!channel) {
    assertAdmin(requestingUser, `Linha ${row.rowNumber}: você não pode criar um novo Canal.`);
    return;
  }

  const department = await prisma.department.findFirst({ where: { channelId: channel.id, name: row.departmentName } });
  if (!department) {
    assertAdmin(requestingUser, `Linha ${row.rowNumber}: você não pode criar um novo Departamento neste Canal.`);
    return;
  }

  const team = await prisma.team.findFirst({ where: { departmentId: department.id, name: row.teamName } });
  if (!team) {
    assertAdmin(requestingUser, `Linha ${row.rowNumber}: você não pode criar um novo Time neste Departamento.`);
    return;
  }

  await assertNodeWithinLedScope(
    companyId,
    requestingUser,
    "TIME",
    team.id,
    `Linha ${row.rowNumber}: você não pode adicionar Membros a este Time.`,
  );
}

export async function commitBulkImport(
  companyId: string,
  requestingUser: RequestingUser,
  rows: ParsedRow[],
): Promise<BulkImportCommitResult> {
  const invalidRow = rows.find((row) => row.errors.length > 0);

  if (invalidRow) {
    throw new ConflictError(`Linha ${invalidRow.rowNumber} contém erros e não pode ser importada.`);
  }

  for (const row of rows) {
    await assertRowWithinLedScope(companyId, requestingUser, row);
  }

  return withTenant(
    async (tx) => {
      const resolver = createPersistingResolver(tx, companyId);
      let createdMembers = 0;
      let createdResponsibles = 0;

      for (const row of rows) {
        const cargoId = await resolver.cargo(row.cargoName);

        let teamId: string | null = null;

        if (!row.isResponsible && row.teamName && row.channelName && row.departmentName) {
          teamId = await resolver.team(row.channelName, row.departmentName, row.teamName);
        }

        const member = await tx.member.create({
          data: {
            companyId,
            teamId,
            cargoId,
            fullName: row.memberName,
            customFixedSalary: row.customFixedSalary,
            memberType: row.isResponsible ? "GESTOR" : "OPERADOR",
          },
        });
        createdMembers += 1;

        if (row.isResponsible && row.responsibleLevel) {
          const target = await resolveResponsibleTargetForCommit(resolver, row);
          await tx.nodeResponsible.create({
            data: { companyId, nodeType: row.responsibleLevel, memberId: member.id, ...target },
          });
          createdResponsibles += 1;
        }
      }

      return { createdMembers, createdResponsibles };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}
