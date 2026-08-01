import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/services/supabase";

// Pública — dispara o e-mail de recuperação via Supabase Auth
// (resetPasswordForEmail). O link do e-mail leva a /redefinir-senha, que
// reaproveita o mesmo padrão de sessão temporária de AceitarConvitePage.
export function EsqueciSenhaPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDone, setIsDone] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/redefinir-senha`,
      });
      if (resetError) throw new Error(resetError.message);
      setIsDone(true);
    } catch (err) {
      // Não expõe se o e-mail existe ou não (evita enumeração de contas) —
      // sempre mostra a mesma confirmação de sucesso.
      setIsDone(true);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isDone) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6 text-center">
          <h1 className="text-xl font-semibold text-foreground">Verifique seu e-mail</h1>
          <p className="text-sm text-muted-foreground">
            Se houver uma conta com o e-mail <strong>{email}</strong>, enviamos um link para redefinir a senha.
          </p>
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            Voltar para o login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Esqueci minha senha</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Informe seu e-mail de login para receber um link de redefinição de senha.
          </p>
        </div>

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

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {isSubmitting ? "Enviando..." : "Enviar link de redefinição"}
        </button>

        <button
          type="button"
          onClick={() => navigate("/login")}
          className="w-full text-sm text-muted-foreground hover:text-foreground"
        >
          Voltar para o login
        </button>
      </form>
    </div>
  );
}
