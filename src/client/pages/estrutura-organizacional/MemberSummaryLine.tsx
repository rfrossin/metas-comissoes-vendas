export interface MemberSummary {
  id: string;
  fullName: string;
  cargo: { name: string };
}

// Linha só leitura de um Membro na árvore da Estrutura — Nome + Cargo,
// apenas. Editar/desativar/excluir Membro e ver Salário/Lideranças passou a
// ser exclusivo da aba Membros (Admin+Gestor).
export function MemberSummaryLine({ member }: { member: MemberSummary }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-sm">
      <span className="text-foreground">{member.fullName}</span>
      <span className="ml-2 text-xs text-muted-foreground">{member.cargo.name}</span>
    </div>
  );
}
