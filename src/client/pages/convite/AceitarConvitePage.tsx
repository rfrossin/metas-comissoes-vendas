import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, getErrorMessage } from "@/services/api";
import { supabase } from "@/services/supabase";

// Rota pública (fora de RequireAuth) — o convidado ainda não tem conta. O
// link do e-mail de convite (enviado pelo Supabase Auth) já autentica o
// navegador numa sessão Supabase temporária ao carregar esta página
// (detectSessionInUrl); aqui só se define a senha (updateUser) e então o
// backend vincula essa identidade ao Invite (aceitar-convite).
export function AceitarConvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [isSessionReady, setIsSessionReady] = useState(false);

  useEffect(() => {
    // getSession() sozinho corre risco de rodar antes do supabase-js acabar
    // de processar o hash (#access_token=...) da URL do link de e-mail.
    // onAuthStateChange dispara assim que a sessão é estabelecida a partir
    // do hash, então cobre o caso em que getSession() ainda não viu nada.
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

    // Só reporta erro depois de dar tempo do hash ser processado — evita
    // piscar "link inválido" antes da troca de token acontecer.
    const timeoutId = setTimeout(() => {
      if (!isMounted) return;
      setIsSessionReady((current) => {
        if (!current) {
          setError("Link inválido ou expirado. Peça ao Administrador para gerar um novo convite.");
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
      const { data: updateData, error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError || !updateData.user) {
        throw new Error(updateError?.message ?? "Não foi possível definir a senha.");
      }

      await api.post("/auth/aceitar-convite", { token, authUserId: updateData.user.id });
      await supabase.auth.signOut();

      setIsDone(true);
      setTimeout(() => navigate("/login"), 2000);
    } catch (err) {
      setError(getErrorMessage(err, "Não foi possível concluir o cadastro. O link pode ter expirado."));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isDone) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="w-full max-w-sm space-y-2 rounded-lg border border-border bg-card p-6 text-center">
          <h1 className="text-lg font-semibold text-foreground">Cadastro concluído!</h1>
          <p className="text-sm text-muted-foreground">Redirecionando para o login...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Concluir cadastro</h1>
          <p className="mt-1 text-sm text-muted-foreground">Defina uma senha para acessar o sistema.</p>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

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
          disabled={isSubmitting || !isSessionReady}
          className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {isSubmitting ? "Concluindo..." : "Concluir cadastro"}
        </button>
      </form>
    </div>
  );
}
