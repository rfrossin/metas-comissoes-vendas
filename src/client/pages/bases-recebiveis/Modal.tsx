import { useEffect } from "react";
import type { ReactNode } from "react";

// Modal genérico em Tailwind puro (sem shadcn — nenhum componente de UI
// gerado ainda no projeto). Backdrop fixo + painel centralizado com scroll
// interno; fecha no Escape, no clique fora, ou no botão "×".
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-md px-2 py-1 text-muted-foreground hover:bg-secondary/50"
          >
            ×
          </button>
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
