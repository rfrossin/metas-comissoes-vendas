import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, getErrorMessage } from "@/services/api";
import { useAuthStore, type AuthUser, type CompanyMembership } from "@/store/auth.store";

type LoginResponse =
  | { status: "OK"; token: string; user: AuthUser }
  | { status: "CHOOSE_COMPANY"; preAuthToken: string; companies: CompanyMembership[] };

export function LoginPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Preenchido só quando a identidade tem mais de uma empresa — a tela
  // troca para o seletor sem pedir a senha de novo.
  const [companyChoice, setCompanyChoice] = useState<{ preAuthToken: string; companies: CompanyMembership[] } | null>(
    null,
  );

  function applyLoginResult(data: LoginResponse) {
    if (data.status === "CHOOSE_COMPANY") {
      setCompanyChoice({ preAuthToken: data.preAuthToken, companies: data.companies });
      return;
    }
    setSession(data.token, data.user);
    navigate("/estrutura-organizacional");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const { data } = await api.post<LoginResponse>("/auth/login", { email, password });
      applyLoginResult(data);
    } catch (err) {
      setError(getErrorMessage(err, "Email ou senha inválidos"));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleChooseCompany(companyId: string) {
    if (!companyChoice) return;
    setError(null);
    setIsSubmitting(true);

    try {
      const { data } = await api.post<LoginResponse>("/auth/escolher-empresa", {
        preAuthToken: companyChoice.preAuthToken,
        companyId,
      });
      applyLoginResult(data);
    } catch (err) {
      setError(getErrorMessage(err, "Não foi possível entrar nesta empresa."));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (companyChoice) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6">
          <h1 className="text-xl font-semibold text-foreground">Escolha a empresa</h1>
          <p className="text-sm text-muted-foreground">
            Seu login dá acesso a mais de uma empresa. Selecione com qual você quer entrar.
          </p>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-2">
            {companyChoice.companies.map((company) => (
              <button
                key={company.companyId}
                type="button"
                disabled={isSubmitting}
                onClick={() => handleChooseCompany(company.companyId)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-left text-sm text-foreground hover:bg-secondary/50 disabled:opacity-50"
              >
                {company.companyName}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setCompanyChoice(null)}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Voltar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6"
      >
        <h1 className="text-xl font-semibold text-foreground">Entrar</h1>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="space-y-1">
          <label className="text-sm text-foreground" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-foreground" htmlFor="password">
            Senha
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {isSubmitting ? "Entrando..." : "Entrar"}
        </button>

        <button
          type="button"
          onClick={() => navigate("/esqueci-senha")}
          className="w-full text-sm text-muted-foreground hover:text-foreground"
        >
          Esqueci minha senha
        </button>

        <button
          type="button"
          onClick={() => navigate("/cadastrar-empresa")}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary/50"
        >
          Nova Empresa
        </button>
      </form>
    </div>
  );
}
