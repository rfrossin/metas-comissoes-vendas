import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, getErrorMessage } from "@/services/api";

export function CadastrarEmpresaPage() {
  const navigate = useNavigate();
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDone, setIsDone] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await api.post("/auth/cadastrar-empresa", { companyName, contactName, contactEmail });
      setIsDone(true);
    } catch (err) {
      setError(getErrorMessage(err, "Não foi possível enviar o pedido de cadastro."));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isDone) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6 text-center">
          <h1 className="text-xl font-semibold text-foreground">Pedido enviado</h1>
          <p className="text-sm text-muted-foreground">
            Recebemos seu pedido de cadastro. Assim que ele for liberado, você receberá um e-mail em{" "}
            <strong>{contactEmail}</strong> com um link para definir sua senha e acessar o sistema.
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
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6"
      >
        <div>
          <h1 className="text-xl font-semibold text-foreground">Cadastrar nova empresa</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Seu pedido será avaliado pela nossa equipe. Você recebe um e-mail assim que for liberado.
          </p>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="space-y-1">
          <label className="text-sm text-foreground" htmlFor="companyName">
            Nome da empresa
          </label>
          <input
            id="companyName"
            type="text"
            required
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-foreground" htmlFor="contactName">
            Seu nome
          </label>
          <input
            id="contactName"
            type="text"
            required
            value={contactName}
            onChange={(event) => setContactName(event.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-foreground" htmlFor="contactEmail">
            Seu e-mail
          </label>
          <input
            id="contactEmail"
            type="email"
            required
            autoComplete="email"
            value={contactEmail}
            onChange={(event) => setContactEmail(event.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {isSubmitting ? "Enviando..." : "Enviar pedido"}
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
