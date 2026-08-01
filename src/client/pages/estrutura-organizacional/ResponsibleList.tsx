export interface Responsible {
  id: string;
  member: { id: string; fullName: string; cargo: { name: string } };
}

// Só leitura: quem lidera este nó (chips) — editar lideranças passou a ser
// exclusivo da aba Membros, no cadastro do próprio Membro Tipo Gestor (ver
// MemberForm/LeadershipEditor).
export function ResponsibleList({ responsibles }: { responsibles: Responsible[] }) {
  if (responsibles.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {responsibles.map((responsible) => (
        <span
          key={responsible.id}
          className="flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
        >
          {responsible.member.fullName}
          <span className="text-muted-foreground">({responsible.member.cargo.name})</span>
        </span>
      ))}
    </div>
  );
}
