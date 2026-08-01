import type { ScopeType } from "@/pages/bases-metas/ScopeSelector";
import { PERMISSION_LEVEL_LABELS } from "@/store/auth.store";

export type PermissionLevel = "OPERACIONAL" | "LIDERANCA_NO" | "ADMINISTRADOR";

export { PERMISSION_LEVEL_LABELS };

export type AccessLevel = "VISUALIZAR" | "EDITAR";

export const ACCESS_LEVEL_LABELS: Record<AccessLevel, string> = {
  VISUALIZAR: "Visualizar",
  EDITAR: "Editar",
};

export interface MemberHierarchy {
  id: string;
  fullName: string;
  cargo: { id: string; name: string; permissionLevel: PermissionLevel };
  team: {
    id: string;
    name: string;
    department: { id: string; name: string; channel: { id: string; name: string } };
  } | null;
}

export interface MyProfile {
  id: string;
  email: string;
  role: PermissionLevel;
  member: MemberHierarchy | null;
  company: { id: string; name: string };
}

export interface ScopeAssignment {
  id: string;
  scopeType: ScopeType;
  scopeId: string | null;
  scopeName: string;
  accessLevel: AccessLevel;
}

export interface CompanyUser {
  id: string;
  email: string;
  role: PermissionLevel;
  isActive: boolean;
  createdAt: string;
  canLaunchOwnMemberResults: boolean;
  member: MemberHierarchy | null;
  scopeAssignments: { id: string; scopeType: ScopeType; scopeId: string | null; accessLevel: AccessLevel }[];
}

export interface PendingInvite {
  id: string;
  name: string;
  email: string;
  token: string;
  expiresAt: string;
  createdAt: string;
  cargo?: { id: string; name: string } | null;
  team?: { id: string; name: string } | null;
}

export function hierarchyLabel(member: MemberHierarchy | null): string {
  if (!member?.team) return "—";
  return `${member.team.department.channel.name} / ${member.team.department.name} / ${member.team.name}`;
}
