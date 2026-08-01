import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuthStore } from "@/store/auth.store";
import { ManageBasesTab } from "./ManageBasesTab";
import { MyReceivablesBasesTab } from "./MyReceivablesBasesTab";

// PASSO 9.10: "Bases de Recebível" (gestão, como antes) só para Admin+Gestor;
// "Minhas Bases" (autoatendimento) para TODOS os papéis, inclusive Usuário —
// mesmo padrão de abas do PASSO 8 (Estrutura Organizacional/Membros).
// PASSO 18: aba ativa passou a viver na URL (?tab=), mesmo ajuste já feito
// em MetasPage.tsx (PASSO 16) — necessário para o "Voltar" da tela de
// detalhe de Base reabrir na aba "Minhas Bases".
export function BasesRecebiveisPage() {
  const role = useAuthStore((state) => state.user?.role);
  const canManage = role === "ADMINISTRADOR" || role === "LIDERANCA_NO";
  const tabs = (["gerenciar", "minhas"] as const).filter((tab) => tab !== "gerenciar" || canManage);
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTabState] = useState<"gerenciar" | "minhas">(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam === "minhas") return "minhas";
    if (tabParam === "gerenciar" && canManage) return "gerenciar";
    return canManage ? "gerenciar" : "minhas";
  });

  function setActiveTab(tab: "gerenciar" | "minhas") {
    setActiveTabState(tab);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", tab);
        return next;
      },
      { replace: true },
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Bases de Recebível</h1>
      </div>

      {tabs.length > 1 && (
        <div className="flex gap-1 border-b border-border">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 text-sm ${
                activeTab === tab ? "border-b-2 border-primary font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab === "gerenciar" ? "Bases de Recebível" : "Minhas Bases"}
            </button>
          ))}
        </div>
      )}

      {activeTab === "gerenciar" && canManage && <ManageBasesTab />}
      {activeTab === "minhas" && <MyReceivablesBasesTab />}
    </div>
  );
}
