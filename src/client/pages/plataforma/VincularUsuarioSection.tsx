import { useState, type FormEvent } from "react";
import { platformApi, getPlatformErrorMessage } from "@/services/platform-api";

interface CompanyOption {
  id: string;
  name: string;
}

interface IdentityOption {
  authUserId: string;
  email: string;
}

interface Props {
  companies: CompanyOption[];
  // Identidades conhecidas: as sem empresa mais as já vinculadas a alguma
  // (uma pessoa pode ser adicionada a uma segunda empresa).
  identities: IdentityOption[];
  onLinked: () => void;
}

// Atalho de gestão: vincula uma identidade existente a uma empresa sem
// passar por convite. Não envia e-mail — o acesso vale no próximo login.
export function VincularUsuarioSection({ companies, identities, onLinked }: Props) {
  const [authUserId, setAuthUserId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [role, setRole] = useState<"OPERACIONAL" | "LIDERANCA_NO" | "ADMINISTRADOR">("OPERACIONAL");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setIsBusy(true);
    try {
      const { data } = await platformApi.post<{ email: string; companyName: string }>("/plataforma/vinculos", {
        authUserId,
        companyId,
        role,
      });
      setSuccess(`${data.email} agora faz parte de ${data.companyName}.`);
      setAuthUserId("");
      setCompanyId("");
      onLinked();
    } catch (err) {
      setError(getPlatformErrorMessage(err, "Não foi possível vincular o usuário."));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Adicionar usuário a uma empresa</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Vincula uma conta que já existe a uma empresa, sem enviar convite. O acesso passa a valer no próximo login
          da pessoa.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {success && <p className="text-sm text-success">{success}</p>}

      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
        <select
          required
          value={authUserId}
          onChange={(event) => setAuthUserId(event.target.value)}
          className="w-64 rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
        >
          <option value="">Selecione o usuário</option>
          {identities.map((identity) => (
            <option key={identity.authUserId} value={identity.authUserId}>
              {identity.email}
            </option>
          ))}
        </select>

        <select
          required
          value={companyId}
          onChange={(event) => setCompanyId(event.target.value)}
          className="w-56 rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
        >
          <option value="">Selecione a empresa</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>

        <select
          value={role}
          onChange={(event) => setRole(event.target.value as typeof role)}
          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
        >
          <option value="OPERACIONAL">Operacional</option>
          <option value="LIDERANCA_NO">Liderança de Nó</option>
          <option value="ADMINISTRADOR">Administrador</option>
        </select>

        <button
          type="submit"
          disabled={isBusy || !authUserId || !companyId}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {isBusy ? "Vinculando..." : "Vincular"}
        </button>
      </form>
    </section>
  );
}
