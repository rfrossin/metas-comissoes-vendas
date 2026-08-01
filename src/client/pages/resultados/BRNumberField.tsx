import type { ResultUnit } from "./ResultTypesSection";

// Achado da critique (Riley/stress-tester): `<input type="number">` deixa o
// próprio navegador interpretar o texto digitado como notação EN (ponto =
// decimal) — "5.000" (cinco mil, na notação BR que o resto do produto usa
// via toLocaleString("pt-BR")) virava silenciosamente 5. Aqui o campo é
// texto puro: ponto é sempre separador de milhar (removido), vírgula é
// sempre o separador decimal — a mesma convenção que já aparece em toda
// tabela do módulo — e o valor nunca é aceito sem essa conversão explícita.
const ALLOWED_CHARS = /^-?[0-9.,]*$/;

export function parseBRNumber(raw: string): number | null {
  const trimmed = raw.trim();

  if (trimmed === "") {
    return null;
  }

  if (!ALLOWED_CHARS.test(trimmed)) {
    return NaN;
  }

  const commaCount = (trimmed.match(/,/g) ?? []).length;

  if (commaCount > 1) {
    return NaN;
  }

  const normalized = trimmed.replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);

  return normalized === "" || normalized === "-" ? NaN : parsed;
}

function formatPreview(parsed: number, unit: ResultUnit | undefined): string {
  if (unit === "MOEDA") {
    return parsed.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  return parsed.toLocaleString("pt-BR");
}

export function BRNumberField({
  id,
  label,
  value,
  onChange,
  unit,
  allowNegative,
  negativeHint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  unit: ResultUnit | undefined;
  allowNegative: boolean;
  negativeHint?: string;
}) {
  const parsed = parseBRNumber(value);
  const isInvalidFormat = Number.isNaN(parsed);
  const isNegative = !allowNegative && parsed !== null && !Number.isNaN(parsed) && parsed < 0;
  const hasError = isInvalidFormat || isNegative;
  const errorId = `${id}-error`;

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        required
        placeholder="0,00"
        aria-invalid={hasError}
        aria-describedby={hasError ? errorId : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`w-full rounded-md border bg-background px-2 py-1 text-sm text-foreground ${
          hasError ? "border-destructive" : "border-input"
        }`}
      />
      {isInvalidFormat && (
        <p id={errorId} className="text-xs text-destructive">
          Formato inválido — use vírgula para decimais (ex.: 5.000,50).
        </p>
      )}
      {!isInvalidFormat && isNegative && (
        <p id={errorId} className="text-xs text-destructive">
          {negativeHint ?? "Este campo não aceita valor negativo."}
        </p>
      )}
      {!isInvalidFormat && !isNegative && parsed !== null && (
        <p className="text-xs text-muted-foreground">Você lançará: {formatPreview(parsed, unit)}</p>
      )}
    </div>
  );
}
