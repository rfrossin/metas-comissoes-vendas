import jwt from "jsonwebtoken";
import { prisma } from "../config/prisma";
import { supabaseAdmin, supabaseAuth } from "../config/supabase";
import { env } from "../config/env";
import { ConflictError, ForbiddenError, UnauthorizedError } from "../utils/http-errors";
import { sendMail } from "./mailer.service";

// Identidade separada de User/Company — o Super Admin/Suporte da
// plataforma não pertence a nenhum tenant. Payload distinto de
// auth.service.ts (userId/companyId/role) para não ser aceito por engano
// pelo authMiddleware de tenant, e vice-versa.
export interface PlatformTokenPayload {
  platformUserId: string;
  role: "SUPER_ADMIN" | "SUPORTE";
  scope: "platform";
}

interface PlatformLoginInput {
  email: string;
  password: string;
}

export interface PlatformLoginResult {
  token: string;
  platformUser: { id: string; name: string; email: string; role: "SUPER_ADMIN" | "SUPORTE" };
}

// Mesmo padrão de auth.service.ts: a senha é verificada pelo Supabase Auth
// (signInWithPassword), o token emitido ao cliente é um JWT próprio.
export async function platformLogin({ email, password }: PlatformLoginInput): Promise<PlatformLoginResult> {
  const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    throw new UnauthorizedError("Credenciais inválidas");
  }

  const platformUser = await prisma.platformUser.findFirst({
    where: { authUserId: data.user.id },
  });
  if (!platformUser) {
    // Mesma mensagem da branch de senha errada acima — evita que alguém com
    // uma conta Supabase válida (mas sem PlatformUser vinculado) descubra,
    // por diferença de mensagem, que o e-mail existe no Auth mas não tem
    // acesso à plataforma.
    throw new UnauthorizedError("Credenciais inválidas");
  }

  const token = jwt.sign(
    { platformUserId: platformUser.id, role: platformUser.role, scope: "platform" } satisfies PlatformTokenPayload,
    env.jwtSecret,
    { expiresIn: "8h" },
  );

  return {
    token,
    platformUser: {
      id: platformUser.id,
      name: platformUser.name,
      email: platformUser.email,
      role: platformUser.role,
    },
  };
}

interface CreatePlatformUserInput {
  name: string;
  email: string;
  role: "SUPER_ADMIN" | "SUPORTE";
}

// Só um SUPER_ADMIN cria novos PlatformUser — SUPORTE nunca escala o
// próprio acesso nem cria outros. A identidade nasce no Supabase Auth via
// generateLink (mesmo padrão de sendInviteEmail em permissoes.service.ts):
// o novo Super Admin define a própria senha pelo link, nunca recebe senha
// em texto claro.
export async function createPlatformUser(
  requestingUser: { role: "SUPER_ADMIN" | "SUPORTE" },
  input: CreatePlatformUserInput,
): Promise<{ id: string; name: string; email: string; role: "SUPER_ADMIN" | "SUPORTE" }> {
  if (requestingUser.role !== "SUPER_ADMIN") {
    throw new ForbiddenError("Só o Super Admin pode adicionar novos usuários da plataforma.");
  }

  const existing = await prisma.platformUser.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new ConflictError("Já existe um usuário da plataforma com este e-mail.");
  }

  const redirectTo = `${env.frontendUrl}/redefinir-senha`;
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "invite",
    email: input.email,
    options: { redirectTo },
  });
  if (error || !data) {
    throw new Error(`Falha ao gerar link de convite: ${error?.message}`);
  }

  const platformUser = await prisma.platformUser.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash: "",
      authUserId: data.user.id,
      role: input.role,
    },
  });

  await sendMail({
    to: input.email,
    subject: "Convite para acessar o Painel da Plataforma",
    html: `
      <p>Você foi convidado a acessar o Painel da Plataforma (Metas e Comissões) como <strong>${input.role === "SUPER_ADMIN" ? "Super Admin" : "Suporte"}</strong>.</p>
      <p><a href="${data.properties.action_link}">Clique aqui para definir sua senha e entrar</a></p>
    `,
  }).catch(() => undefined);

  return { id: platformUser.id, name: platformUser.name, email: platformUser.email, role: platformUser.role };
}

export async function listPlatformUsers(): Promise<
  { id: string; name: string; email: string; role: "SUPER_ADMIN" | "SUPORTE" }[]
> {
  return prisma.platformUser.findMany({
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: "asc" },
  });
}
