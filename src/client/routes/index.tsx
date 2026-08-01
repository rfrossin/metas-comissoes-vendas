import { Navigate, Routes, Route } from "react-router-dom";
import { RequireAuth } from "./RequireAuth";
import { RequireRole } from "./RequireRole";
import { RequirePlatformAuth } from "./RequirePlatformAuth";
import { LoginPage } from "@/pages/auth/LoginPage";
import { CadastrarEmpresaPage } from "@/pages/auth/CadastrarEmpresaPage";
import { EsqueciSenhaPage } from "@/pages/auth/EsqueciSenhaPage";
import { RedefinirSenhaPage } from "@/pages/auth/RedefinirSenhaPage";
import { PlataformaLoginPage } from "@/pages/plataforma/PlataformaLoginPage";
import { PlataformaPainelPage } from "@/pages/plataforma/PlataformaPainelPage";
import { EstruturaOrganizacionalPage } from "@/pages/estrutura-organizacional/EstruturaOrganizacionalPage";
import { ResultadosPage } from "@/pages/resultados/ResultadosPage";
import { BasesMetasPage } from "@/pages/bases-metas/BasesMetasPage";
import { MetasPage } from "@/pages/metas/MetasPage";
import { GoalLineDetailPage } from "@/pages/metas/GoalLineDetailPage";
import { MyGoalLineDetailPage } from "@/pages/metas/MyGoalLineDetailPage";
import { AcompanhamentoPage } from "@/pages/acompanhamento/AcompanhamentoPage";
import { BasesRecebiveisPage } from "@/pages/bases-recebiveis/BasesRecebiveisPage";
import { ReceivablesBaseDetailPage } from "@/pages/bases-recebiveis/ReceivablesBaseDetailPage";
import { MyReceivablesBaseDetailPage } from "@/pages/bases-recebiveis/MyReceivablesBaseDetailPage";
import { BeneficiaryReceivablesBaseDetailPage } from "@/pages/bases-recebiveis/BeneficiaryReceivablesBaseDetailPage";
import { RecebiveisPage } from "@/pages/recebiveis/RecebiveisPage";
import { FechamentoPage } from "@/pages/fechamento/FechamentoPage";
import { MemberClosingDetailPage } from "@/pages/fechamento/MemberClosingDetailPage";
import { UsuariosPage } from "@/pages/usuarios/UsuariosPage";
import { AceitarConvitePage } from "@/pages/convite/AceitarConvitePage";

export function AppRoutes() {
  return (
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
  );
}
