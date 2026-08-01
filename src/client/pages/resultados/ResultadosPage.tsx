import { useState } from "react";
import { useAuthStore } from "@/store/auth.store";
import { ResultTypesSection } from "./ResultTypesSection";
import { LaunchSection } from "./LaunchSection";
import { AllResultsTab } from "./AllResultsTab";

type Tab = "lancamento" | "todos" | "tipos";

const ALL_TABS: { id: Tab; label: string }[] = [
  { id: "lancamento", label: "Lançamento por Membro" },
  { id: "todos", label: "Todos os Resultados" },
  { id: "tipos", label: "Tipos de Resultado" },
];

export function ResultadosPage() {
  const [tab, setTab] = useState<Tab>("lancamento");
  // PASSO 9.5: só quem pode criar/editar Tipos de Resultado (Admin) vê essa
  // aba — antes era visível pra todo mundo, só o formulário era Admin-only.
  const isAdmin = useAuthStore((state) => state.user?.role) === "ADMINISTRADOR";
  const tabs = ALL_TABS.filter((item) => item.id !== "tipos" || isAdmin);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Resultados</h1>
        <p className="text-sm text-muted-foreground">
          Lançamento de resultados regulares e deságios operacionais por Membro.
        </p>
      </div>

      <div className="flex gap-1 border-b border-border">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`px-3 py-2 text-sm ${
              tab === item.id
                ? "border-b-2 border-primary font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "lancamento" && <LaunchSection />}
      {tab === "todos" && <AllResultsTab />}
      {tab === "tipos" && isAdmin && <ResultTypesSection />}
    </div>
  );
}
