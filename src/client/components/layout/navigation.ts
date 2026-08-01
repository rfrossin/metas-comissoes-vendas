import {
  BarChart3,
  Target,
  Activity,
  SlidersHorizontal,
  Wallet,
  ListChecks,
  Lock,
  Users,
  Building2,
  type LucideIcon,
} from "lucide-react";
import type { PermissionLevel } from "@/store/auth.store";

const ALL_ROLES: PermissionLevel[] = ["ADMINISTRADOR", "LIDERANCA_NO", "OPERACIONAL"];

export interface NavLeaf {
  to: string;
  label: string;
  icon: LucideIcon;
  allow: PermissionLevel[];
}

export interface NavGroup {
  label: string;
  icon: LucideIcon;
  items: NavLeaf[];
}

// 4 grupos pedidos (Resultados / Metas / Recebíveis / Configurações) cobrindo
// as 8 rotas reais do produto — nenhuma tela existente foi removida, só
// reorganizada. Mapeamento segue a esteira de PRODUCT.md: Metas absorve
// Acompanhamento (é "Acompanhamento Meta x Resultados") e Bases para Metas
// (motor de sazonalidade, insumo de Metas); Recebíveis absorve Fechamento
// (congela o período antes de virar Recebível, mesma etapa da esteira) e
// Bases de Recebível; Configurações absorve Estrutura Organizacional (setup
// raramente tocado, não operação diária).
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Resultados",
    icon: BarChart3,
    items: [{ to: "/resultados", label: "Resultados", icon: BarChart3, allow: ALL_ROLES }],
  },
  {
    label: "Metas",
    icon: Target,
    items: [
      { to: "/metas", label: "Metas", icon: Target, allow: ALL_ROLES },
      { to: "/acompanhamento", label: "Acompanhamento", icon: Activity, allow: ALL_ROLES },
      { to: "/bases-metas", label: "Bases para Metas", icon: SlidersHorizontal, allow: ["ADMINISTRADOR"] },
    ],
  },
  {
    label: "Recebíveis",
    icon: Wallet,
    items: [
      { to: "/recebiveis", label: "Recebíveis", icon: Wallet, allow: ALL_ROLES },
      { to: "/bases-recebiveis", label: "Bases de Recebível", icon: ListChecks, allow: ALL_ROLES },
      { to: "/fechamento", label: "Fechamento", icon: Lock, allow: ALL_ROLES },
    ],
  },
  {
    label: "Configurações",
    icon: Users,
    items: [
      { to: "/usuarios", label: "Usuários", icon: Users, allow: ALL_ROLES },
      { to: "/estrutura-organizacional", label: "Estrutura Organizacional", icon: Building2, allow: ALL_ROLES },
    ],
  },
];

export function flattenNavItems(role: PermissionLevel | undefined): NavLeaf[] {
  if (!role) return [];
  return NAV_GROUPS.flatMap((group) => group.items).filter((item) => item.allow.includes(role));
}
