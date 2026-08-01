import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { useAuthStore } from "@/store/auth.store";
import { ProgressBar } from "./ProgressBar";

interface PeriodProgress {
  metaValue: string;
  realizadoValue: string;
  percentage: string | null;
}

interface MyGoalLineSummary {
  goalLineId: string;
  goalCampaignId: string;
  campaignName: string;
  resultTypeName: string;
  resultTypeUnit: "MOEDA" | "NUMERAL";
  hasDailyRationale: boolean;
  diario: PeriodProgress | null;
  semanal: PeriodProgress | null;
  mensal: PeriodProgress;
  trimestral: PeriodProgress;
  acumulado: PeriodProgress;
}

// "Minhas Metas" (mesmo espírito de "Minhas Bases", bases-recebiveis) —
// autoatendimento disponível para TODOS os papéis: as Linhas de Meta em
// nível Membro do próprio usuário, em campanhas vigentes (hoje dentro do
// período), com barras de progresso Diário/Semanal (quando a Linha tem
// racional para isso)/Mensal/Trimestral/Acumulado Total. Sem Membro
// vinculado, lista vazia.
export function MinhasMetasTab() {
  const ownMemberId = useAuthStore((state) => state.user?.memberId) ?? null;
  const navigate = useNavigate();

  const { data: lines, isLoading } = useQuery({
    queryKey: ["my-goal-lines"],
    queryFn: async () => {
      const { data } = await api.get<MyGoalLineSummary[]>("/metas/minhas");
      return data;
    },
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Suas Metas individuais em campanhas vigentes, com o progresso por período.
      </p>

      {!ownMemberId && (
        <p className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
          Seu usuário não está vinculado a um Membro — não há Metas para exibir aqui.
        </p>
      )}

      {!!ownMemberId && isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}

      {!!ownMemberId && !isLoading && lines?.length === 0 && (
        <p className="text-sm text-muted-foreground">Você não tem Metas individuais em campanhas vigentes no momento.</p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {lines?.map((line) => (
          <div
            key={line.goalLineId}
            onClick={() => navigate(`/metas/minhas/${line.goalCampaignId}/linha/MEMBRO/${ownMemberId}?lineId=${line.goalLineId}`)}
            className="cursor-pointer space-y-3 rounded-lg border border-border p-4 hover:bg-secondary/30"
          >
            <div>
              <h3 className="text-sm font-semibold text-foreground">{line.campaignName}</h3>
              <p className="text-xs text-muted-foreground">{line.resultTypeName}</p>
            </div>

            <div className="space-y-3">
              {line.diario && <ProgressBar label="Diário" {...line.diario} unit={line.resultTypeUnit} />}
              {line.semanal && <ProgressBar label="Semanal" {...line.semanal} unit={line.resultTypeUnit} />}
              <ProgressBar label="Mensal" {...line.mensal} unit={line.resultTypeUnit} />
              <ProgressBar label="Trimestral" {...line.trimestral} unit={line.resultTypeUnit} />
              <ProgressBar label="Acumulado Total" {...line.acumulado} unit={line.resultTypeUnit} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
