import { prisma, withTenant } from "../config/prisma";
import { parseSpreadsheet } from "./bulk-import.service";
import { assertCanMutateResults, assertNoMemberClosingForType, assertPeriodOpen } from "./resultados.service";
import { ConflictError, ForbiddenError } from "../utils/http-errors";
import type { RequestingUser } from "./scope.util";

interface RawRow {
  Membro?: string;
  Tipo?: string;
  Data?: string;
  Valor?: string;
  Motivo?: string;
}

const HEADER_MAP: Record<string, keyof RawRow> = {
  membro: "Membro",
  tipo: "Tipo",
  data: "Data",
  valor: "Valor",
  motivo: "Motivo",
};

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

// Aceita tanto AAAA-MM-DD (formato do <input type="date">) quanto DD/MM/AAAA
// (formato citado na spec para planilhas — Resultados §2: "Formato DIA/MÊS/ANO").
function parseRowDate(value: string): Date | null {
  const trimmed = value.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);

  if (isoMatch) {
    return new Date(Date.UTC(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3])));
  }

  const brMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);

  if (brMatch) {
    return new Date(Date.UTC(Number(brMatch[3]), Number(brMatch[2]) - 1, Number(brMatch[1])));
  }

  return null;
}

function parseRowValue(value: string | undefined): number | null {
  if (!value || value.trim() === "") {
    return null;
  }

  const parsed = Number(value.trim().replace(",", "."));
  return Number.isNaN(parsed) ? null : parsed;
}

export interface ParsedResultRow {
  rowNumber: number;
  errors: string[];
  memberName: string;
  typeName: string;
  date: Date | null;
  value: number | null;
  reason: string | null;
  kind: "resultado" | "desagio" | null;
}

interface ResultRowFields {
  memberName: string;
  typeName: string;
  date: Date | null;
  value: number | null;
  reason: string | null;
}

export function validateResultRowFields(fields: ResultRowFields): string[] {
  const errors: string[] = [];

  if (!fields.memberName) {
    errors.push("Membro é obrigatório.");
  }

  if (!fields.typeName) {
    errors.push("Tipo é obrigatório.");
  }

  if (!fields.date) {
    errors.push("Data inválida (use AAAA-MM-DD ou DD/MM/AAAA).");
  }

  if (fields.value === null) {
    errors.push("Valor é obrigatório e deve ser numérico.");
  }

  return errors;
}

function parseRow(rowNumber: number, raw: RawRow): ParsedResultRow {
  const memberName = raw.Membro?.trim() || "";
  const typeName = raw.Tipo?.trim() || "";
  const date = raw.Data ? parseRowDate(raw.Data) : null;
  const value = parseRowValue(raw.Valor);
  const reason = raw.Motivo?.trim() || null;

  const errors = validateResultRowFields({ memberName, typeName, date, value, reason });

  return {
    rowNumber,
    errors,
    memberName,
    typeName,
    date,
    value,
    reason,
    kind: value !== null ? (value < 0 ? "desagio" : "resultado") : null,
  };
}

export function parseResultsWorkbookRows(buffer: Buffer): ParsedResultRow[] {
  const rawRows = parseSpreadsheet(buffer);
  // Linha 1 é o cabeçalho; os dados começam na linha 2.
  return rawRows.map((raw, index) => parseRow(index + 2, normalizeHeaders(raw)));
}

async function resolveByName(
  name: string,
  cache: Map<string, string | null>,
  lookup: (name: string) => Promise<{ id: string } | null>,
) {
  const key = name.toLowerCase();

  if (cache.has(key)) {
    return cache.get(key)!;
  }

  const found = await lookup(name);
  const id = found?.id ?? null;
  cache.set(key, id);
  return id;
}

export interface PreviewResultRow {
  rowNumber: number;
  valid: boolean;
  errors: string[];
  memberName: string;
  typeName: string;
  date: string | null;
  value: number | null;
  reason: string | null;
  kind: "resultado" | "desagio" | null;
}

export interface ResultsBulkImportPreview {
  rows: PreviewResultRow[];
  summary: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
    newResultEntries: number;
    newAdjustments: number;
  };
}

export async function buildResultsPreview(
  companyId: string,
  rows: ParsedResultRow[],
): Promise<ResultsBulkImportPreview> {
  const memberCache = new Map<string, string | null>();
  const typeCache = new Map<string, string | null>();
  const previewRows: PreviewResultRow[] = [];

  for (const row of rows) {
    const errors = [...row.errors];

    if (errors.length === 0) {
      const memberId = await resolveByName(row.memberName, memberCache, (name) =>
        prisma.member.findFirst({
          where: { companyId, status: "ATIVO", fullName: { equals: name, mode: "insensitive" } },
          select: { id: true },
        }),
      );
      const typeId = await resolveByName(row.typeName, typeCache, (name) =>
        prisma.resultType.findFirst({
          where: { companyId, name: { equals: name, mode: "insensitive" } },
          select: { id: true },
        }),
      );

      if (!memberId) {
        errors.push(`Membro "${row.memberName}" não encontrado (deve já existir e estar Ativo).`);
      }

      if (!typeId) {
        errors.push(`Tipo de Resultado "${row.typeName}" não encontrado (cadastre antes de importar).`);
      }
    }

    previewRows.push({
      rowNumber: row.rowNumber,
      valid: errors.length === 0,
      errors,
      memberName: row.memberName,
      typeName: row.typeName,
      date: row.date ? row.date.toISOString().slice(0, 10) : null,
      value: row.value,
      reason: row.reason,
      kind: row.kind,
    });
  }

  const validRows = previewRows.filter((row) => row.valid);

  return {
    rows: previewRows,
    summary: {
      totalRows: previewRows.length,
      validRows: validRows.length,
      invalidRows: previewRows.length - validRows.length,
      newResultEntries: validRows.filter((row) => row.kind === "resultado").length,
      newAdjustments: validRows.filter((row) => row.kind === "desagio").length,
    },
  };
}

export interface ResultsBulkImportCommitResult {
  createdEntries: number;
  createdAdjustments: number;
}

// PASSO 5b: cada linha só pode ser gravada se o requisitante tiver
// permissão para mutar Resultados daquele Membro (mesma regra de
// resultados.service.ts — nativa para LIDERANCA_NO, canInsertOwnResults
// para OPERACIONAL). Membros de importação de Resultados sempre já
// existem (nunca são criados por esta planilha), então resolver o nome
// contra o estado já commitado do banco (fora da transação) é seguro —
// sem o problema de visibilidade entre linhas que a importação de
// Estrutura Organizacional tem (essa cria Membros/Times novos on-the-fly).
async function assertRowsCanMutateResults(companyId: string, requestingUser: RequestingUser, rows: ParsedResultRow[]): Promise<void> {
  if (requestingUser.role === "ADMINISTRADOR") return;

  for (const row of rows) {
    const member = await prisma.member.findFirst({
      where: { companyId, status: "ATIVO", fullName: { equals: row.memberName, mode: "insensitive" } },
      select: { id: true },
    });
    if (!member) {
      throw new ForbiddenError(`Linha ${row.rowNumber}: Membro "${row.memberName}" não encontrado.`);
    }
    await assertCanMutateResults(companyId, requestingUser, member.id);
  }
}

export async function commitResultsImport(
  companyId: string,
  requestingUser: RequestingUser,
  rows: ParsedResultRow[],
): Promise<ResultsBulkImportCommitResult> {
  const invalidRow = rows.find((row) => row.errors.length > 0);

  if (invalidRow) {
    throw new ConflictError(`Linha ${invalidRow.rowNumber} contém erros e não pode ser importada.`);
  }

  await assertRowsCanMutateResults(companyId, requestingUser, rows);

  return withTenant(
    async (tx) => {
      let createdEntries = 0;
      let createdAdjustments = 0;

      for (const row of rows) {
        const member = await tx.member.findFirst({
          where: { companyId, status: "ATIVO", fullName: { equals: row.memberName, mode: "insensitive" } },
        });
        const type = await tx.resultType.findFirst({
          where: { companyId, name: { equals: row.typeName, mode: "insensitive" } },
        });

        if (!member || !type || !row.date || row.value === null) {
          throw new ConflictError(`Linha ${row.rowNumber} não pôde ser resolvida no momento da gravação.`);
        }

        await assertPeriodOpen(companyId, row.date, tx);
        await assertNoMemberClosingForType(companyId, member.id, row.date, type.id, tx);

        if (row.value < 0) {
          await tx.operationalAdjustment.create({
            data: {
              companyId,
              memberId: member.id,
              typeId: type.id,
              value: row.value,
              dateReference: row.date,
              reason: row.reason,
              createdByUserId: requestingUser.id,
            },
          });
          createdAdjustments += 1;
        } else {
          await tx.resultEntry.create({
            data: { companyId, memberId: member.id, typeId: type.id, date: row.date, value: row.value },
          });
          createdEntries += 1;
        }
      }

      return { createdEntries, createdAdjustments };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}
