import { ERROR_TEXT, LOADING_TEXT, RETRY_TEXT } from "./copy";

export function LoadingState({ className = "text-sm text-muted-foreground" }: { className?: string }) {
  return <p className={className}>{LOADING_TEXT}</p>;
}

// Estado de erro com ação de recuperação — sem isto, uma falha de rede era
// indistinguível de "sem dados" (a query some, o componente só via
// isLoading=false e dados vazios).
export function ErrorState({ onRetry, className = "text-sm text-destructive" }: { onRetry: () => void; className?: string }) {
  return (
    <p className={className}>
      {ERROR_TEXT}{" "}
      <button type="button" onClick={onRetry} className="font-medium underline underline-offset-2 hover:no-underline">
        {RETRY_TEXT}
      </button>
    </p>
  );
}
