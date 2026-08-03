import { lazy, Suspense } from "react";
import { Navigate, Routes, Route } from "react-router-dom";
import { RequireAuth } from "./RequireAuth";
import { RequireAuthNoShell } from "./RequireAuthNoShell";
import { RequireRole } from "./RequireRole";
import { RequirePlatformAuth } from "./RequirePlatformAuth";
import { LoadingState } from "@/components/AsyncState";

// Telas de entrada (login/recuperação/convite) ficam ESTÁTICAS de
// propósito: são a primeira coisa que qualquer visitante carrega, e um
// chunk separado só adicionaria um ida-e-volta de rede antes do login
// aparecer.
import { LoginPage } from "@/pages/auth/LoginPage";
import { CadastrarEmpresaPage } from "@/pages/auth/CadastrarEmpresaPage";
import { EsqueciSenhaPage } from "@/pages/auth/EsqueciSenhaPage";
import { RedefinirSenhaPage } from "@/pages/auth/RedefinirSenhaPage";
import { AceitarConvitePage } from "@/pages/convite/AceitarConvitePage";

// Demais telas carregadas sob demanda — antes, todo visitante baixava as
// 27 páginas (incluindo Recharts e xlsx, pesadíssimos) antes de ver a tela
// de login. Em 4G ruim isso eram vários segundos de tela branca.
const PlataformaLoginPage = lazy(() => import("@/pages/plataforma/PlataformaLoginPage").then((m) => ({ default: m.PlataformaLoginPage })));
const PlataformaPainelPage = lazy(() => import("@/pages/plataforma/PlataformaPainelPage").then((m) => ({ default: m.PlataformaPainelPage })));
const EstruturaOrganizacionalPage = lazy(() =>
  import("@/pages/estrutura-organizacional/EstruturaOrganizacionalPage").then((m) => ({ default: m.EstruturaOrganizacionalPage })),
);
const ResultadosPage = lazy(() => import("@/pages/resultados/ResultadosPage").then((m) => ({ default: m.ResultadosPage })));
const BasesMetasPage = lazy(() => import("@/pages/bases-metas/BasesMetasPage").then((m) => ({ default: m.BasesMetasPage })));
const MetasPage = lazy(() => import("@/pages/metas/MetasPage").then((m) => ({ default: m.MetasPage })));
const GoalLineDetailPage = lazy(() => import("@/pages/metas/GoalLineDetailPage").then((m) => ({ default: m.GoalLineDetailPage })));
const MyGoalLineDetailPage = lazy(() => import("@/pages/metas/MyGoalLineDetailPage").then((m) => ({ default: m.MyGoalLineDetailPage })));
const AcompanhamentoPage = lazy(() => import("@/pages/acompanhamento/AcompanhamentoPage").then((m) => ({ default: m.AcompanhamentoPage })));
const BasesRecebiveisPage = lazy(() => import("@/pages/bases-recebiveis/BasesRecebiveisPage").then((m) => ({ default: m.BasesRecebiveisPage })));
const ReceivablesBaseDetailPage = lazy(() =>
  import("@/pages/bases-recebiveis/ReceivablesBaseDetailPage").then((m) => ({ default: m.ReceivablesBaseDetailPage })),
);
const MyReceivablesBaseDetailPage = lazy(() =>
  import("@/pages/bases-recebiveis/MyReceivablesBaseDetailPage").then((m) => ({ default: m.MyReceivablesBaseDetailPage })),
);
const BeneficiaryReceivablesBaseDetailPage = lazy(() =>
  import("@/pages/bases-recebiveis/BeneficiaryReceivablesBaseDetailPage").then((m) => ({ default: m.BeneficiaryReceivablesBaseDetailPage })),
);
const RecebiveisPage = lazy(() => import("@/pages/recebiveis/RecebiveisPage").then((m) => ({ default: m.RecebiveisPage })));
const FechamentoPage = lazy(() => import("@/pages/fechamento/FechamentoPage").then((m) => ({ default: m.FechamentoPage })));
const MemberClosingDetailPage = lazy(() => import("@/pages/fechamento/MemberClosingDetailPage").then((m) => ({ default: m.MemberClosingDetailPage })));
const ImprimirFechamentosPage = lazy(() => import("@/pages/fechamento/ImprimirFechamentosPage").then((m) => ({ default: m.ImprimirFechamentosPage })));
const UsuariosPage = lazy(() => import("@/pages/usuarios/UsuariosPage").then((m) => ({ default: m.UsuariosPage })));

export function AppRoutes() {
  return (
    <Suspense fallback={<div className="p-6"><LoadingState /></div>}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/cadastrar-empresa" element={<CadastrarEmpresaPage />} />
      <Route path="/esqueci-senha" element={<EsqueciSenhaPage />} />
      <Route path="/redefinir-senha" element={<RedefinirSenhaPage />} />
      <Route path="/convite/:token" element={<AceitarConvitePage />} />
      <Route path="/admin-plataforma/login" element={<PlataformaLoginPage />} />
      <Route
        path="/admin-plataforma"
        element={
          <RequirePlatformAuth>
            <PlataformaPainelPage />
          </RequirePlatformAuth>
        }
      />
      <Route path="/" element={<Navigate to="/estrutura-organizacional" replace />} />

      <Route
        path="/estrutura-organizacional"
        element={
          <RequireAuth>
            <EstruturaOrganizacionalPage />
          </RequireAuth>
        }
      />
      <Route
        path="/resultados"
        element={
          <RequireAuth>
            <ResultadosPage />
          </RequireAuth>
        }
      />
      <Route
        path="/bases-metas"
        element={
          <RequireAuth>
            <RequireRole allow={["ADMINISTRADOR"]}>
              <BasesMetasPage />
            </RequireRole>
          </RequireAuth>
        }
      />
      <Route
        path="/metas"
        element={
          <RequireAuth>
            <MetasPage />
          </RequireAuth>
        }
      />
      <Route
        path="/metas/:campaignId/linha/:entityType/:entityId"
        element={
          <RequireAuth>
            <GoalLineDetailPage />
          </RequireAuth>
        }
      />
      <Route
        path="/metas/minhas/:campaignId/linha/:entityType/:entityId"
        element={
          <RequireAuth>
            <MyGoalLineDetailPage />
          </RequireAuth>
        }
      />
      <Route
        path="/acompanhamento"
        element={
          <RequireAuth>
            <AcompanhamentoPage />
          </RequireAuth>
        }
      />
      <Route
        path="/bases-recebiveis"
        element={
          // PASSO 9.10: a página agora tem a aba "Minhas Bases" (autoatendimento,
          // todos os papéis) além de "Bases de Recebível" (gestão, Admin+Gestor,
          // barrada dentro do próprio componente) — a rota deixou de ser
          // bloqueada para Usuário.
          <RequireAuth>
            <BasesRecebiveisPage />
          </RequireAuth>
        }
      />
      <Route
        path="/bases-recebiveis/:id"
        element={
          <RequireAuth>
            <RequireRole allow={["ADMINISTRADOR", "LIDERANCA_NO"]}>
              <ReceivablesBaseDetailPage />
            </RequireRole>
          </RequireAuth>
        }
      />
      <Route
        path="/bases-recebiveis/minhas/:id"
        element={
          <RequireAuth>
            <MyReceivablesBaseDetailPage />
          </RequireAuth>
        }
      />
      <Route
        path="/bases-recebiveis/:id/beneficiario/:memberId"
        element={
          <RequireAuth>
            <RequireRole allow={["ADMINISTRADOR", "LIDERANCA_NO"]}>
              <BeneficiaryReceivablesBaseDetailPage />
            </RequireRole>
          </RequireAuth>
        }
      />
      <Route
        path="/recebiveis"
        element={
          <RequireAuth>
            <RecebiveisPage />
          </RequireAuth>
        }
      />
      <Route
        path="/fechamento"
        element={
          // PASSO 9.12: Usuário passou a ter acesso de leitura (só o próprio
          // Fechamento) — RequireRole ganhou OPERACIONAL; a página trava o
          // Escopo em si mesmo e esconde Fechar/Reabrir pra esse papel.
          <RequireAuth>
            <RequireRole allow={["ADMINISTRADOR", "LIDERANCA_NO", "OPERACIONAL"]}>
              <FechamentoPage />
            </RequireRole>
          </RequireAuth>
        }
      />
      <Route
        path="/fechamento/:memberId/:referenceMonth"
        element={
          <RequireAuth>
            <RequireRole allow={["ADMINISTRADOR", "LIDERANCA_NO", "OPERACIONAL"]}>
              <MemberClosingDetailPage />
            </RequireRole>
          </RequireAuth>
        }
      />
      <Route
        path="/fechamento/imprimir"
        element={
          <RequireAuthNoShell>
            <ImprimirFechamentosPage />
          </RequireAuthNoShell>
        }
      />
      <Route path="/permissoes" element={<Navigate to="/usuarios" replace />} />
      <Route
        path="/usuarios"
        element={
          <RequireAuth>
            <UsuariosPage />
          </RequireAuth>
        }
      />
    </Routes>
    </Suspense>
  );
}
