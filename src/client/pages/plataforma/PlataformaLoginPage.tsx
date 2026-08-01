import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { platformApi, getPlatformErrorMessage } from "@/services/platform-api";
import { usePlatformAuthStore, type PlatformUser } from "@/store/platform-auth.store";

interface PlatformLoginResponse {
  token: string;
  platformUser: PlatformUser;
}

export function PlataformaLoginPage() {
  const navigate = useNavigate();
  const setSession = usePlatformAuthStore((state) => state.setSession);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const { data } = await platformApi.post<PlatformLoginResponse>("/plataforma/login", { email, password });
      setSession(data.token, data.platformUser);
      navigate("/admin-plataforma");
    } catch (err) {
      setError(getPlatformErrorMessage(err, "Email ou senha inválidos"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6"
      >
        <h1 className="text-xl font-semibold text-foreground">Painel da Plataforma</h1>

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
      </form>
    </div>
  );
}
