import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { getErrorMessage } from "@/services/api";
import { supabase } from "@/services/supabase";

// Pública — o link do e-mail de "esqueci minha senha" (resetPasswordForEmail)
// autentica o navegador numa sessão Supabase temporária ao carregar esta
// página (detectSessionInUrl), igual ao convite — mas aqui o usuário já
// existe, então só chamamos updateUser, sem tocar em Invite/User.
export function RedefinirSenhaPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [isSessionReady, setIsSessionReady] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      if (session) {
        setIsSessionReady(true);
        setError(null);
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return;
      if (data.session) {
        setIsSessionReady(true);
      }
    });

    const timeoutId = setTimeout(() => {
      if (!isMounted) return;
      setIsSessionReady((current) => {
        if (!current) {
          setError("Link inválido ou expirado. Solicite um novo link em \"Esqueci minha senha\".");
        }
        return current;
      });
    }, 2000);

    return () => {
      isMounted = false;
      subscription.subscription.unsubscribe();
      clearTimeout(timeoutId);
    };
  }, []);

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
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw new Error(updateError.message);

      await supabase.auth.signOut();
      setIsDone(true);
      setTimeout(() => navigate("/login"), 2000);
    } catch (err) {
      setError(getErrorMessage(err, "Não foi possível redefinir a senha. O link pode ter expirado."));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isDone) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="w-full max-w-sm space-y-2 rounded-lg border border-border bg-card p-6 text-center">
          <h1 className="text-lg font-semibold text-foreground">Senha redefinida!</h1>
          <p className="text-sm text-muted-foreground">Redirecionando para o login...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Redefinir senha</h1>
          <p className="mt-1 text-sm text-muted-foreground">Defina uma nova senha para acessar o sistema.</p>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="space-y-1">
          <label className="text-sm text-foreground" htmlFor="password">
            Nova senha
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
            Confirmar nova senha
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
          disabled={isSubmitting || !isSessionReady}
          className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {isSubmitting ? "Salvando..." : "Redefinir senha"}
        </button>
      </form>
    </div>
  );
}
