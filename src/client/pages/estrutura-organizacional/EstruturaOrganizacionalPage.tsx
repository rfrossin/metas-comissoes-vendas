import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { api } from "@/services/api";
import { useAuthStore } from "@/store/auth.store";
import { useScopedEntityOptions } from "@/pages/metas/useScopedEntityOptions";
import { InlineNameForm } from "./InlineNameForm";
import { ChannelRow, type Channel } from "./ChannelRow";
import { ResponsibleList, type Responsible } from "./ResponsibleList";
import { MembrosTab } from "./MembrosTab";
import { CargosTab } from "./CargosTab";

interface OrgTree {
  id: string;
  name: string;
  responsibles: Responsible[];
  channels: Channel[];
}

function extractErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error) && typeof error.response?.data?.message === "string") {
    return error.response.data.message;
  }
  return fallback;
}

// Estrutura: só a árvore da empresa (Canal→Departamento→Time) e o Cargo de
// cada Membro, visível para todos. Criar Canal/Departamento/Time continua
// exclusivo do Administrador. Criar/editar/desativar/excluir Membro (e ver
// Salário/Lideranças) migrou inteiramente para a aba Membros (Admin+Gestor,
// nunca Usuário).
export function EstruturaOrganizacionalPage() {
  const queryClient = useQueryClient();
  const companyId = useAuthStore((state) => state.user?.companyId) ?? "";
  const role = useAuthStore((state) => state.user?.role);
  const isAdmin = role === "ADMINISTRADOR";
  const canManageMembers = isAdmin || role === "LIDERANCA_NO";
  const [activeTab, setActiveTab] = useState<"estrutura" | "membros" | "cargos">("estrutura");
  const [isAddingChannel, setIsAddingChannel] = useState(false);
  const [channelError, setChannelError] = useState<string | null>(null);

  const { data: tree, isLoading } = useQuery({
    queryKey: ["org-tree"],
    queryFn: async () => {
      const { data } = await api.get<OrgTree>("/estrutura-organizacional/tree");
      return data;
    },
  });

  // PASSO 11.7: Gestor passou a poder criar/editar/excluir Departamento e
  // Time dentro do próprio escopo liderado (Canal continua Admin-only) —
  // `options.DEPARTAMENTO`/`TIME` no modo "led" já vêm exatamente com os
  // nós que ele lidera (nó atribuído + descendentes, mesma regra que o
  // servidor usa em assertNodeWithinLedScope), então os Sets abaixo bastam
  // pra decidir quais botões mostrar em cada nível — sem duplicar lógica.
  const { options: ledOptions } = useScopedEntityOptions(companyId, "led");
  const ledChannelIds = useMemo(() => new Set(ledOptions.CANAL.map((c) => c.entityId)), [ledOptions.CANAL]);
  const ledDepartmentIds = useMemo(() => new Set(ledOptions.DEPARTAMENTO.map((d) => d.entityId)), [ledOptions.DEPARTAMENTO]);
  const ledTeamIds = useMemo(() => new Set(ledOptions.TIME.map((t) => t.entityId)), [ledOptions.TIME]);

  const createChannelMutation = useMutation({
    mutationFn: (name: string) => api.post("/estrutura-organizacional/channels", { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-tree"] });
      setIsAddingChannel(false);
      setChannelError(null);
    },
    onError: (error) => setChannelError(extractErrorMessage(error, "Não foi possível criar o Canal.")),
  });

  // PASSO 9.3: Cargos é Admin-only pra ver (não só pra editar) — o formulário
  // já era isAdmin-gated dentro de CargosTab, mas a aba em si aparecia pra
  // todo mundo. GET /cargos continua sem checagem de role (é o picker de
  // Cargo usado no formulário de Membro, que Gestor também usa).
  const tabs = (["estrutura", "membros", "cargos"] as const).filter(
    (tab) => (tab !== "membros" || canManageMembers) && (tab !== "cargos" || isAdmin),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Estrutura Organizacional</h1>
        <p className="text-sm text-muted-foreground">
          Empresa → Canais → Departamentos → Times. Clique num item para expandir.
        </p>
      </div>

      <div className="flex gap-1 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 text-sm ${
              activeTab === tab
                ? "border-b-2 border-primary font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab === "estrutura" ? "Estrutura" : tab === "membros" ? "Membros" : "Cargos"}
          </button>
        ))}
      </div>

      {activeTab === "membros" && canManageMembers && <MembrosTab />}

      {activeTab === "cargos" && isAdmin && <CargosTab />}

      {activeTab === "estrutura" && (
        <>
          {isLoading && <p className="text-sm text-muted-foreground">Carregando estrutura organizacional...</p>}

          {tree && (
            <div className="rounded-lg border border-border bg-card p-4">
              <span className="text-xs font-semibold uppercase text-muted-foreground">Empresa</span>
              <h2 className="mb-2 text-base font-medium text-foreground">{tree.name}</h2>
              <ResponsibleList responsibles={tree.responsibles} />
            </div>
          )}

          {tree && tree.channels.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum canal cadastrado ainda.</p>
          )}

          <div className="space-y-3">
            {tree?.channels.map((channel) => (
              <ChannelRow
                key={channel.id}
                channel={channel}
                ledChannelIds={ledChannelIds}
                ledDepartmentIds={ledDepartmentIds}
                ledTeamIds={ledTeamIds}
              />
            ))}
          </div>

          {isAdmin &&
            (isAddingChannel ? (
              <InlineNameForm
                placeholder="Nome do canal"
                submitLabel="Adicionar canal"
                onSubmit={(name) => createChannelMutation.mutate(name)}
                onCancel={() => {
                  setIsAddingChannel(false);
                  setChannelError(null);
                }}
                isSubmitting={createChannelMutation.isPending}
              />
            ) : (
              <button
                type="button"
                onClick={() => setIsAddingChannel(true)}
                className="rounded-md border border-dashed border-border px-4 py-2 text-sm text-muted-foreground hover:border-primary hover:text-primary"
              >
                + Novo Canal
              </button>
            ))}

          {channelError && <p className="text-xs text-destructive">{channelError}</p>}
        </>
      )}
    </div>
  );
}
