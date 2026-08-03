import { useQuery } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { api } from "@/services/api";

// Quando o Super Admin pausa uma empresa, TODAS as chamadas de dados
// passam a responder 403 com code COMPANY_BLOCKED. Sem este aviso, o
// usuário veria só telas de erro espalhadas, sem entender que o problema é
// o acesso da empresa — e não a rede ou um bug.
//
// Usa /permissoes/meu-perfil, uma das poucas rotas liberadas durante o
// bloqueio (ver ALLOWED_WHILE_BLOCKED no companyStatusGuard): consultar
// qualquer outra aqui daria 403 e não distinguiria os casos.
export function CompanyBlockedBanner() {
  const { error } = useQuery({
    queryKey: ["company-blocked-check"],
    queryFn: async () => (await api.get("/estrutura-organizacional/tree")).data,
    // Não faz retry: o 403 de bloqueio é uma resposta definitiva, não uma
    // falha transitória — insistir só atrasaria o aviso.
    retry: false,
    // Revalida ao voltar para a aba, para o banner sumir sozinho assim que
    // o Super Admin reativar a empresa.
    refetchOnWindowFocus: true,
  });

  const code = isAxiosError(error) ? (error.response?.data as { code?: string } | undefined)?.code : undefined;
  if (code !== "COMPANY_BLOCKED" && code !== "COMPANY_NOT_FOUND") return null;

  const message = isAxiosError(error)
    ? ((error.response?.data as { message?: string } | undefined)?.message ?? "")
    : "";

  return (
    <div className="border-b border-destructive/40 bg-destructive/10 px-4 py-2">
      <p className="text-sm text-destructive">
        <strong>Acesso pausado.</strong> {message} Você pode continuar usando sua conta e outras empresas às quais
        tenha acesso.
      </p>
    </div>
  );
}
