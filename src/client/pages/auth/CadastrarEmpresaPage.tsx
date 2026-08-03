import { useNavigate } from "react-router-dom";

// Rota mantida só por compatibilidade: links antigos de "Nova Empresa"
// ainda circulam por e-mail e em favoritos.
//
// O formulário que existia aqui criava um pedido de empresa SEM identidade
// vinculada. Na aprovação, isso gerava um convite que mandava a pessoa
// "definir uma senha" — sem sentido para quem já tinha conta, e ninguém
// concluía: a empresa nascia vazia. Agora o caminho é único e vinculado:
// cria-se a conta primeiro e pede-se a empresa já logado, em /minha-conta.
export function CadastrarEmpresaPage() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Cadastrar nova empresa</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Para cadastrar uma empresa, primeiro crie sua conta (ou entre na que você já tem). Assim a empresa já nasce
            vinculada a você como Administrador quando o pedido for aprovado.
          </p>
        </div>

        <button
          type="button"
          onClick={() => navigate("/criar-conta")}
          className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
        >
          Criar conta
        </button>

        <button
          type="button"
          onClick={() => navigate("/login")}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary/50"
        >
          Já tenho conta
        </button>
      </div>
    </div>
  );
}
