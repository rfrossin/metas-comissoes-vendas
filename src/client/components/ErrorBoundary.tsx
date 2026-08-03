import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

// Rede de segurança de último recurso: sem isto, qualquer exceção durante o
// render (ex.: um campo inesperadamente null vindo da API) derrubava a
// árvore inteira do React e deixava a tela BRANCA, sem nenhuma saída a não
// ser o usuário descobrir sozinho que precisa recarregar.
//
// Precisa ser class component: getDerivedStateFromError/componentDidCatch
// não têm equivalente em hooks.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("Erro não tratado na interface:", error, errorInfo);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md space-y-3 rounded-lg border border-border bg-card p-6 text-center">
          <h1 className="text-lg font-semibold text-foreground">Algo deu errado</h1>
          <p className="text-sm text-muted-foreground">
            A tela encontrou um erro inesperado. Recarregar costuma resolver — se persistir, avise o suporte.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            Recarregar página
          </button>
        </div>
      </div>
    );
  }
}
