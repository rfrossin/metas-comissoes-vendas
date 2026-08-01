import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { useAuthStore } from "@/store/auth.store";
import { flattenNavItems } from "./navigation";

// Busca rápida entre telas (Ctrl/Cmd+K) — não é busca de dados de negócio
// (não existe endpoint de busca global no produto hoje); navega entre as
// telas que o papel do usuário já pode acessar.
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const role = useAuthStore((state) => state.user?.role);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo(() => flattenNavItems(role), [role]);
  const results = useMemo(
    () => items.filter((item) => item.label.toLowerCase().includes(query.trim().toLowerCase())),
    [items, query],
  );

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && results[activeIndex]) {
      navigate(results[activeIndex].to);
      onClose();
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-foreground/40 pt-24" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg border border-border bg-popover shadow-sm"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ir para..."
            aria-label="Buscar tela"
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground/70">Esc</kbd>
        </div>

        <div className="max-h-72 overflow-y-auto p-1">
          {results.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">Nenhuma tela encontrada.</p>}
          {results.map((item, index) => {
            const Icon = item.icon;
            return (
              <button
                key={item.to}
                type="button"
                onClick={() => {
                  navigate(item.to);
                  onClose();
                }}
                onMouseEnter={() => setActiveIndex(index)}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${
                  index === activeIndex ? "bg-secondary text-secondary-foreground" : "text-foreground"
                }`}
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
