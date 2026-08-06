// Estados de carregamento/erro compartilhados por todo o app. Nasceram em
// pages/acompanhamento/ (único módulo que tratava erro de rede) e foram
// promovidos para cá quando o mesmo tratamento passou a valer para as
// demais telas — sem isto, uma falha de rede era indistinguível de "sem
// dados": a query sumia, o componente só via isLoading=false e uma lista
// vazia, e chegava a exibir "Nenhum registro cadastrado" para o usuário.

export const LOADING_TEXT = "Carregando dados...";
export const ERROR_TEXT = "Não foi possível carregar os dados.";
export const RETRY_TEXT = "Tentar novamente";

export function LoadingState({ className = "text-sm text-muted-foreground" }: { className?: string }) {
  return <p className={className}>{LOADING_TEXT}</p>;
}

// Estado de erro com ação de recuperação — o botão é essencial: numa
// oscilação de rede (mobile), o usuário precisa de um caminho de volta que
// não seja recarregar a página inteira.
// `message` é opcional de propósito: sem ela o componente segue exibindo o
// ERROR_TEXT genérico, então nenhum uso existente muda. Quem tem uma
// mensagem melhor do servidor (via getErrorMessage) passa adiante — sem
// isso, um 403 de permissão, uma empresa bloqueada e uma falha de rede
// ficam indistinguíveis na tela, o que já custou caro para diagnosticar.
export function ErrorState({
  onRetry,
  message,
  className = "text-sm text-destructive",
}: {
  onRetry: () => void;
  message?: string;
  className?: string;
}) {
  return (
    <p className={className}>
      {message ?? ERROR_TEXT}{" "}
      <button type="button" onClick={onRetry} className="font-medium underline underline-offset-2 hover:no-underline">
        {RETRY_TEXT}
      </button>
    </p>
  );
}
