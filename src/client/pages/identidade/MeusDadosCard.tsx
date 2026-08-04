import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { identityApi, getIdentityErrorMessage } from "@/services/identity-api";
import { isValidPhone, maskPhoneInput } from "@shared/utils/phone.util";

interface MeusDadosCardProps {
  name: string;
  phone: string;
  email: string;
}

// Dados da PESSOA, não da participação dela numa empresa: editar aqui vale
// para todas as empresas em que ela está, de uma vez. Por isso este bloco
// vive no painel de identidade e não na Gestão de Usuários de cada empresa
// (lá se edita Cargo, Vínculo e Membro, que são por empresa).
export function MeusDadosCard({ name, phone, email }: MeusDadosCardProps) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(name);
  const [phoneDraft, setPhoneDraft] = useState(maskPhoneInput(phone));
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (payload: { name: string; phone: string }) => identityApi.patch("/identidade/eu", payload),
    onSuccess: () => {
      setError(null);
      setIsEditing(false);
      queryClient.invalidateQueries({ queryKey: ["identidade", "eu"] });
    },
    onError: (err: unknown) => setError(getIdentityErrorMessage(err, "Não foi possível salvar seus dados.")),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (nameDraft.trim().length < 2) {
      setError("Informe seu nome.");
      return;
    }
    if (!isValidPhone(phoneDraft)) {
      setError("Informe um celular válido com DDD, ex.: (16) 99229-6316.");
      return;
    }
    mutation.mutate({ name: nameDraft.trim(), phone: phoneDraft });
  }

  function handleCancel() {
    // Volta ao que está salvo: sem isto, cancelar deixaria o rascunho
    // editado na tela, parecendo que a alteração foi aceita.
    setNameDraft(name);
    setPhoneDraft(maskPhoneInput(phone));
    setError(null);
    setIsEditing(false);
  }

  if (!isEditing) {
    return (
      <section className="space-y-3 rounded-lg border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-medium text-foreground">Meus dados</h2>
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground hover:bg-secondary/50"
          >
            Editar
          </button>
        </div>

        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Nome</dt>
            <dd className="text-foreground">{name || "—"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">E-mail</dt>
            <dd className="text-foreground">{email}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Celular</dt>
            <dd className={phone ? "text-foreground" : "text-destructive"}>
              {phone ? maskPhoneInput(phone) : "Não informado"}
            </dd>
          </div>
        </dl>

        <p className="text-xs text-muted-foreground">
          Estes dados são da sua conta e valem para todas as empresas em que você participa. O e-mail identifica sua
          conta e não pode ser alterado aqui.
        </p>
      </section>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-border bg-card p-6">
      <h2 className="text-lg font-medium text-foreground">Meus dados</h2>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="space-y-1">
        <label className="text-sm text-foreground" htmlFor="meus-dados-nome">
          Nome
        </label>
        <input
          id="meus-dados-nome"
          type="text"
          required
          autoComplete="name"
          value={nameDraft}
          onChange={(event) => setNameDraft(event.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm text-muted-foreground" htmlFor="meus-dados-email">
          E-mail
        </label>
        <input
          id="meus-dados-email"
          type="email"
          value={email}
          disabled
          className="w-full cursor-not-allowed rounded-md border border-input bg-secondary/30 px-3 py-2 text-sm text-muted-foreground"
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm text-foreground" htmlFor="meus-dados-celular">
          Celular
        </label>
        <input
          id="meus-dados-celular"
          type="tel"
          required
          inputMode="numeric"
          autoComplete="tel"
          placeholder="(16) 99229-6316"
          value={phoneDraft}
          onChange={(event) => setPhoneDraft(maskPhoneInput(event.target.value))}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {mutation.isPending ? "Salvando..." : "Salvar"}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={mutation.isPending}
          className="rounded-md border border-input bg-background px-4 py-2 text-sm text-foreground hover:bg-secondary/50 disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
