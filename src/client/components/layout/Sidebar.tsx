import { NavLink } from "react-router-dom";
import { useAuthStore } from "@/store/auth.store";
import { NAV_GROUPS } from "./navigation";

const leafClasses = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
    isActive ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-secondary/50"
  }`;

const leafClassesCollapsed = ({ isActive }: { isActive: boolean }) =>
  `flex items-center justify-center rounded-md p-2 ${
    isActive ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-secondary/50"
  }`;

export function Sidebar({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const role = useAuthStore((state) => state.user?.role);

  return (
    <nav className="flex flex-1 flex-col gap-4 overflow-y-auto">
      {NAV_GROUPS.map((group) => {
        const items = group.items.filter((item) => role && item.allow.includes(role));
        if (items.length === 0) return null;

        return (
          <div key={group.label} className="flex flex-col gap-1">
            {!collapsed && (
              <p className="px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
                {group.label}
              </p>
            )}
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={onNavigate}
                  title={collapsed ? item.label : undefined}
                  aria-label={item.label}
                  className={collapsed ? leafClassesCollapsed : leafClasses}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </NavLink>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
