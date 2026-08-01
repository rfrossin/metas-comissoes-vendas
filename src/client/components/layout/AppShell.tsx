import { useEffect, useState, type ReactNode } from "react";
import { CommandPalette } from "./CommandPalette";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";

const SIDEBAR_COLLAPSED_KEY = "metas-comissoes:sidebar-collapsed";

function loadCollapsedPreference(): boolean {
  return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
}

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadCollapsedPreference);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

  // Atalhos globais: Ctrl/Cmd+K abre a busca rápida de telas, Ctrl/Cmd+B
  // recolhe/expande o menu lateral — convenção já usada por VSCode/Notion/
  // Linear, reconhecível sem precisar de onboarding.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const modifier = event.metaKey || event.ctrlKey;
      if (!modifier) return;

      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      } else if (event.key.toLowerCase() === "b") {
        event.preventDefault();
        setSidebarCollapsed((collapsed) => !collapsed);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Sidebar fixa em telas médias+, alterna entre w-64 (expandida) e w-16
          (rail de ícones); vira gaveta off-canvas abaixo de md (achado da
          critique: w-64 fixo não recolhia e estourava a tela em mobile —
          título/campos cortados no meio da palavra). */}
      <aside
        className={`hidden flex-col border-r border-border p-3 transition-[width] duration-150 md:flex ${
          sidebarCollapsed ? "w-16" : "w-64"
        }`}
      >
        <Sidebar collapsed={sidebarCollapsed} />
      </aside>

      {/* Renderizada só quando aberta — não só transladada para fora da tela.
          Um elemento fixed com -translate-x-full continua contribuindo pro
          scrollWidth do documento em alguns motores (confirmado: 375px de
          viewport virava 481px de scrollWidth com o menu "escondido" assim),
          gerando barra de rolagem horizontal falsa. */}
      {mobileNavOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-foreground/40 md:hidden" onClick={() => setMobileNavOpen(false)} aria-hidden="true" />
          <aside className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-background p-3 md:hidden">
            <Sidebar collapsed={false} onNavigate={() => setMobileNavOpen(false)} />
          </aside>
        </>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((collapsed) => !collapsed)}
          onOpenMobileNav={() => setMobileNavOpen(true)}
          onOpenSearch={() => setSearchOpen(true)}
        />
        {/* Container flexível, não-opinativo: a densidade/grid de cada
            macroambiente é composta pela própria página (space-y-6 + grid/flex
            interno, ver DESIGN.md > Layout) — o shell só garante que ela tenha
            a largura máxima disponível ao lado da sidebar. */}
        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>

      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
