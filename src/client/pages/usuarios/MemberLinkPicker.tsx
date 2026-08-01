import { useState } from "react";
import { useEntityOptions } from "@/pages/metas/useEntityOptions";

// Vínculo de um usuário a um Membro do sistema: "SEM VÍNCULO" + busca por
// texto entre os Membros ainda não vinculados a outro usuário. Reaproveita
// o mesmo idioma de filtro-de-texto + <select> de EntityPicker.tsx, mas
// restrito ao nível MEMBRO (sem seletor de nível, que não se aplica aqui).
export function MemberLinkPicker({
  companyId,
  memberId,
  onChange,
  excludeMemberIds = [],
  disabled = false,
}: {
  companyId: string;
  memberId: string | null;
  onChange: (memberId: string | null) => void;
  excludeMemberIds?: string[];
  disabled?: boolean;
}) {
  const { options, isLoading } = useEntityOptions(companyId);
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLowerCase();

  const memberOptions = options.MEMBRO.filter((o) => o.entityId === memberId || !excludeMemberIds.includes(o.entityId)).filter(
    (o) =>
      !normalizedSearch ||
      o.label.toLowerCase().includes(normalizedSearch) ||
      o.breadcrumb?.toLowerCase().includes(normalizedSearch),
  );

  return (
    <div className="flex flex-col gap-1">
      <input
        type="text"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        disabled={disabled || isLoading}
        placeholder="Buscar Membro por nome..."
        className="w-full max-w-md rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
      />
      <select
        disabled={disabled || isLoading}
        value={memberId ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
        className="w-full max-w-md rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
      >
        <option value="">SEM VÍNCULO</option>
        {memberOptions.map((option) => (
          <option key={option.entityId} value={option.entityId}>
            {option.label}
            {option.breadcrumb ? ` (${option.breadcrumb})` : ""}
          </option>
        ))}
      </select>
      {normalizedSearch && memberOptions.length === 0 && (
        <p className="text-xs text-muted-foreground">Nenhum Membro encontrado para "{search}".</p>
      )}
    </div>
  );
}
