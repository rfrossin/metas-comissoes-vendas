import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, getErrorMessage } from "@/services/api";
import { supabase } from "@/services/supabase";
import { LoadingState } from "@/components/AsyncState";
import { isValidPhone, maskPhoneInput } from "@shared/utils/phone.util";

interface InviteInfo {
  email: string;
  companyName: string;
  // Nome que o Admin digitou ao convidar — pré-preenche o campo.
  name: string;
  // true = esta identidade ainda não tem celular gravado (conta nova, ou
  // conta antiga anterior à obrigatoriedade). A tela exibe e exige o campo.
  needsPhone: boolean;
  // true = quem foi convidado JÁ tem login no sistema (está entrando em
  // mais uma empresa). Antes esta tela ignorava isso e mandava todo mundo
  // "definir uma senha": para quem já tinha conta, isso sobrescrevia a
  // senha usada nas outras empresas dela — e o fluxo travava aí, deixando
  // a empresa recém-aprovada sem nenhum usuário.
  identityExists: boolean;
}

// Rota pública (fora de RequireAuth). Dois caminhos, decididos pelo backend:
//   - identidade NÃO existe: o link do e-mail já autenticou o navegador numa
//     sessão Supabase temporária (detectSessionInUrl) e aqui a pessoa define
//     a senha dela (updateUser);
//   - identidade JÁ existe: pede a senha ATUAL e autentica normalmente
//     (signInWithPassword). Nada de updateUser neste caminho.
// Em ambos, o backend vincula a identidade ao Invite (aceitar-convite).
export function AceitarConvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDone, setIsDone] = useState(false);

  useEffect(() => {
    let isMounted = true;
    api
      .get<InviteInfo>(`/auth/convite/${token}`)
      .then(({ data }) => {
        if (!isMounted) return;
        setInfo(data);
        // O Admin já digitou um nome ao convidar; a pessoa só corrige se
        // estiver errado, em vez de redigitar do zero.
        setName(data.name ?? "");
      })
      .catch((err) => {
        if (isMounted) setInfoError(getErrorMessage(err, "Convite inválido ou expirado."));
      });
    return () => {
      isMounted = false;
    };
  }, [token]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!info) return;

    // Confirmação de senha só faz sentido para quem está criando uma.
    if (!info.identityExists) {
      if (password.length < 8) {
        setError("A senha deve ter ao menos 8 caracteres.");
        return;
      }
      if (password !== confirmPassword) {
        setError("A confirmação não confere com a senha.");
        return;
      }
    }

    // Celular: cobrado de toda identidade que ainda não tem o dado, tenha
    // ela conta ou não — é a regra de "todo usuário tem celular".
    if (info.needsPhone) {
      if (name.trim().length < 2) {
        setError("Informe seu nome.");
        return;
      }
      if (!isValidPhone(phone)) {
        setError("Informe um celular válido com DDD, ex.: (16) 99229-6316.");
        return;
      }
    }

    setIsSubmitting(true);
    try {
      let authUserId: string;

      if (info.identityExists) {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email: info.email,
          password,
        });
        if (signInError || !data.user) {
          throw new Error(signInError?.message ?? "Não foi possível entrar com essa senha.");
        }
        authUserId = data.user.id;
      } else {
        const { data, error: updateError } = await supabase.auth.updateUser({ password });
        if (updateError || !data.user) {
          throw new Error(updateError?.message ?? "Não foi possível definir a senha.");
        }
        authUserId = data.user.id;
      }

      await api.post("/auth/aceitar-convite", {
        token,
        authUserId,
        // Só vão quando a tela realmente pediu — para quem já tem os dados,
        // o backend ignora e preserva o que está gravado.
        ...(info.needsPhone ? { name: name.trim(), phone } : {}),
      });
      await supabase.auth.signOut();

      setIsDone(true);
      setTimeout(() => navigate("/login"), 2000);
    } catch (err) {
      // err instanceof Error primeiro: getErrorMessage só entende AxiosError,
      // então os erros do Supabase (AuthError) cairiam sempre no texto
      // genérico, escondendo a causa real ("senha incorreta", etc.).
      setError(
        err instanceof Error
          ? err.message
          : getErrorMessage(err, "Não foi possível concluir. O link pode ter expirado."),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (infoError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="w-full max-w-sm space-y-2 rounded-lg border border-border bg-card p-6 text-center">
          <h1 className="text-lg font-semibold text-foreground">Convite indisponível</h1>
          <p className="text-sm text-muted-foreground">{infoError}</p>
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="text-sm text-muted-foreground underline hover:text-foreground"
          >
            Ir para o login
          </button>
        </div>
      </div>
    );
  }

  if (isDone) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="w-full max-w-sm space-y-2 rounded-lg border border-border bg-card p-6 text-center">
          <h1 className="text-lg font-semibold text-foreground">Tudo certo!</h1>
          <p className="text-sm text-muted-foreground">Redirecionando para o login...</p>
        </div>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <LoadingState />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            {info.identityExists ? "Entrar na empresa" : "Concluir cadastro"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {info.identityExists ? (
              <>
                Confirme sua senha para entrar em <strong>{info.companyName}</strong> com a conta {info.email}.
              </>
            ) : (
              <>
                Defina uma senha para acessar <strong>{info.companyName}</strong>.
              </>
            )}
          </p>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {info.needsPhone && (
          <>
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
              <label className="text-sm text-foreground" htmlFor="phone">
                Celular
              </label>
              <input
                id="phone"
                type="tel"
                required
                inputMode="numeric"
                autoComplete="tel"
                placeholder="(16) 99229-6316"
                value={phone}
                onChange={(event) => setPhone(maskPhoneInput(event.target.value))}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              />
            </div>
          </>
        )}

        <div className="space-y-1">
          <label className="text-sm text-foreground" htmlFor="password">
            {info.identityExists ? "Sua senha" : "Senha"}
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete={info.identityExists ? "current-password" : "new-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
          />
        </div>

        {!info.identityExists && (
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
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {isSubmitting ? "Concluindo..." : info.identityExists ? "Entrar na empresa" : "Concluir cadastro"}
        </button>

        {info.identityExists && (
          <button
            type="button"
            onClick={() => navigate("/esqueci-senha")}
            className="w-full text-sm text-muted-foreground hover:text-foreground"
          >
            Esqueci minha senha
          </button>
        )}
      </form>
    </div>
  );
}
