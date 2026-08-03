import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { identityApi, getIdentityErrorMessage } from "@/services/identity-api";
import { useIdentityStore } from "@/store/identity.store";

// Primeiro passo do fluxo "identidade primeiro": cria-se o login, sem
// empresa nenhuma. Entrar numa empresa (criando uma ou pedindo acesso a
// uma existente) acontece depois, já autenticado, em /minha-conta.
export function CriarContaPage() {
  const navigate = useNavigate();
  const setIdentity = useIdentityStore((state) => state.setIdentity);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("A senha deve ter ao menos 8 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      setError("A confirmação não confere com a senha.");
      return;
    }

    setIsSubmitting(true);
    try {
      const { data } = await identityApi.post<{ token: string; email: string }>("/identidade/cadastrar", {
        name,
        email,
        password,
      });
      setIdentity(data.token, data.email);
      navigate("/minha-conta");
    } catch (err) {
      setError(getIdentityErrorMessage(err, "Não foi possível criar a conta."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Criar conta</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Depois de criar sua conta você poderá cadastrar uma empresa ou entrar em uma já existente.
          </p>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="space-y-1">
          <label className="text-sm text-foreground" htmlFor="name">
            Nome
          </label>
          <input
            id="name"
            type="text"
            required
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
          />
        </div>

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
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-foreground" htmlFor="confirmPassword">
            Confirmar senha
          </label>
          <input
            id="confirmPassword"
            type="password"
            required
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {isSubmitting ? "Criando conta..." : "Criar conta"}
        </button>

        <button
          type="button"
          onClick={() => navigate("/login")}
          className="w-full text-sm text-muted-foreground hover:text-foreground"
        >
          Já tenho conta
        </button>
      </form>
    </div>
  );
}
