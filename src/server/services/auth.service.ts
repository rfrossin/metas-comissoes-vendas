import jwt from "jsonwebtoken";
import { prisma } from "../config/prisma";
import { supabaseAdmin, supabaseAuth } from "../config/supabase";
import { env } from "../config/env";
import { UnauthorizedError } from "../utils/http-errors";

interface LoginInput {
  email: string;
  password: string;
}

// Formato gravado em auth.users.app_metadata pelo Supabase — nunca editável
// pelo próprio usuário (diferente de user_metadata), por isso é seguro usar
// para autorização. Uma identidade (um e-mail, único globalmente no
// Supabase) pode ter N memberships, uma por empresa em que participa.
export interface Membership {
  userId: string;
  companyId: string;
  role: string;
}

interface AppMetadataShape {
  memberships?: Membership[];
}

function signAppToken(membership: Membership): string {
  return jwt.sign(
    { userId: membership.userId, companyId: membership.companyId, role: membership.role },
    env.jwtSecret,
    { expiresIn: "8h" },
  );
}

export type LoginResult =
  | {
      status: "OK";
      token: string;
      user: { id: string; email: string; role: string; companyId: string; memberId: string | null };
    }
  | {
      status: "CHOOSE_COMPANY";
      // Token efêmero de curta duração, só para autorizar a chamada de
      // troca de empresa (POST /auth/escolher-empresa) sem pedir a senha de
      // novo — não substitui o token completo da aplicação.
      preAuthToken: string;
      companies: { companyId: string; companyName: string; role: string }[];
    };

// Login delega a verificação de e-mail/senha ao Supabase Auth
// (signInWithPassword). O token retornado ao cliente continua sendo um JWT
// PRÓPRIO da aplicação — não o token do Supabase — para preservar o shape
// de req.user ({id, companyId, role}) usado pelos 305 call-sites do
// backend sem qualquer alteração.
export async function login({ email, password }: LoginInput): Promise<LoginResult> {
  const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    throw new UnauthorizedError("Credenciais inválidas");
  }

  const appMetadata = data.user.app_metadata as AppMetadataShape;
  const memberships = appMetadata.memberships ?? [];

  if (memberships.length === 0) {
    throw new UnauthorizedError("Este usuário não está vinculado a nenhuma empresa.");
  }

  if (memberships.length > 1) {
    const companies = await prisma.company.findMany({
      where: { id: { in: memberships.map((m) => m.companyId) } },
      select: { id: true, name: true },
    });
    const companyNameById = new Map(companies.map((c) => [c.id, c.name]));

    return {
      status: "CHOOSE_COMPANY",
      preAuthToken: jwt.sign({ authUserId: data.user.id, purpose: "choose-company" }, env.jwtSecret, {
        expiresIn: "5m",
      }),
      companies: memberships.map((m) => ({
        companyId: m.companyId,
        companyName: companyNameById.get(m.companyId) ?? m.companyId,
        role: m.role,
      })),
    };
  }

  const membership = memberships[0];
  const user = await prisma.user.findFirst({
    where: { id: membership.userId, companyId: membership.companyId },
    select: { id: true, email: true, role: true, companyId: true, memberId: true, isActive: true },
  });

  if (!user || !user.isActive) {
    throw new UnauthorizedError("Credenciais inválidas");
  }

  return {
    status: "OK",
    token: signAppToken(membership),
    user: { id: user.id, email: user.email, role: user.role, companyId: user.companyId, memberId: user.memberId },
  };
}

// Segunda etapa do login quando a identidade tem mais de uma membership —
// troca o preAuthToken (emitido acima) + companyId escolhido por um token
// completo da aplicação, sem pedir a senha novamente.
export async function chooseCompany(preAuthToken: string, companyId: string): Promise<LoginResult> {
  let payload: { authUserId: string; purpose: string };
  try {
    payload = jwt.verify(preAuthToken, env.jwtSecret) as typeof payload;
  } catch {
    throw new UnauthorizedError("Sessão de login expirada, faça login novamente.");
  }
  if (payload.purpose !== "choose-company") {
    throw new UnauthorizedError("Token inválido para esta operação.");
  }

  const { data, error } = await supabaseAdmin.auth.admin.getUserById(payload.authUserId);
  if (error || !data.user) {
    throw new UnauthorizedError("Sessão de login expirada, faça login novamente.");
  }

  const appMetadata = data.user.app_metadata as AppMetadataShape;
  const membership = (appMetadata.memberships ?? []).find((m) => m.companyId === companyId);
  if (!membership) {
    throw new UnauthorizedError("Você não tem acesso a esta empresa.");
  }

  const user = await prisma.user.findFirst({
    where: { id: membership.userId, companyId: membership.companyId },
    select: { id: true, email: true, role: true, companyId: true, memberId: true, isActive: true },
  });
  if (!user || !user.isActive) {
    throw new UnauthorizedError("Credenciais inválidas");
  }

  return {
    status: "OK",
    token: signAppToken(membership),
    user: { id: user.id, email: user.email, role: user.role, companyId: user.companyId, memberId: user.memberId },
  };
}

// Lista as empresas que o usuário LOGADO (já com token de app válido) pode
// acessar — usado pelo seletor de empresa no Header, para trocar sem
// deslogar. req.user.id aqui é o User.id interno; precisamos do
// authUserId correspondente para reconsultar o app_metadata.
export async function listMyCompanies(requestingUserId: string): Promise<Membership[]> {
  const user = await prisma.user.findUnique({
    where: { id: requestingUserId },
    select: { authUserId: true },
  });
  if (!user?.authUserId) return [];

  const { data, error } = await supabaseAdmin.auth.admin.getUserById(user.authUserId);
  if (error || !data.user) return [];

  const appMetadata = data.user.app_metadata as AppMetadataShape;
  return appMetadata.memberships ?? [];
}

// Troca de empresa ativa para um usuário já logado — reemite o token da
// aplicação para a membership escolhida, sem exigir senha (a posse do
// token atual já prova a identidade).
export async function switchCompany(requestingUserId: string, companyId: string): Promise<LoginResult> {
  const memberships = await listMyCompanies(requestingUserId);
  const membership = memberships.find((m) => m.companyId === companyId);
  if (!membership) {
    throw new UnauthorizedError("Você não tem acesso a esta empresa.");
  }

  const user = await prisma.user.findFirst({
    where: { id: membership.userId, companyId: membership.companyId },
    select: { id: true, email: true, role: true, companyId: true, memberId: true, isActive: true },
  });
  if (!user || !user.isActive) {
    throw new UnauthorizedError("Credenciais inválidas");
  }

  return {
    status: "OK",
    token: signAppToken(membership),
    user: { id: user.id, email: user.email, role: user.role, companyId: user.companyId, memberId: user.memberId },
  };
}
