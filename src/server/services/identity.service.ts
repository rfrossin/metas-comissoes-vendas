import jwt from "jsonwebtoken";
import { prisma } from "../config/prisma";
import { supabaseAdmin, supabaseAuth } from "../config/supabase";
import { env } from "../config/env";
import { ConflictError, UnauthorizedError } from "../utils/http-errors";

// Terceiro escopo de token do sistema, ao lado de "platform"
// (platform-auth.service.ts) e do token de tenant (auth.service.ts).
//
// Existe porque um usuário SEM EMPRESA não cabe no token de tenant: aquele
// carrega companyId, que alimenta o tenantMiddleware e, por consequência, o
// GUC app.company_id usado pelas políticas de RLS. Emitir um token de
// tenant com companyId vazio para essa pessoa colocaria string vazia no
// GUC — exatamente o tipo de brecha que o RLS existe para impedir.
//
// Por isso este token NÃO passa pelo authMiddleware/tenantMiddleware: ele
// só abre as rotas de identidade (ver identity-auth.middleware.ts), que
// nunca tocam dados de empresa.
export interface IdentityTokenPayload {
  authUserId: string;
  email: string;
  scope: "identity";
}

export function signIdentityToken(authUserId: string, email: string): string {
  return jwt.sign(
    { authUserId, email, scope: "identity" } satisfies IdentityTokenPayload,
    env.jwtSecret,
    { expiresIn: "8h" },
  );
}

interface SignUpInput {
  name: string;
  email: string;
  password: string;
}

// Cadastro público de IDENTIDADE — não cria Company nem User, de
// propósito. A pessoa passa a existir no sistema sem pertencer a lugar
// nenhum; entrar numa empresa é um segundo passo (convite do Admin ou
// pedido via código da empresa).
export async function signUpIdentity(input: SignUpInput): Promise<{ token: string; email: string; name: string }> {
  const email = input.email.trim().toLowerCase();

  // createUser com email_confirm: true — sem etapa de confirmação por
  // e-mail. O acesso a qualquer dado real ainda depende de um Admin
  // aprovar a entrada na empresa, então a confirmação de e-mail não é o
  // que protege nada aqui; ela só adicionaria um passo a mais antes de uma
  // tela que, sozinha, não dá acesso a nada.
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { name: input.name.trim() },
    // memberships vazio = identidade sem empresa. É este array que o
    // login lê para decidir entre entrar direto, escolher empresa, ou
    // cair na tela "você ainda não tem empresa".
    app_metadata: { memberships: [] },
  });

  if (error || !data.user) {
    // O Supabase responde "already been registered" quando o e-mail já
    // existe. Traduzimos para uma mensagem acionável: a pessoa deve fazer
    // login, não criar outra conta — é justamente o fluxo que queremos
    // que ela siga para entrar numa segunda empresa.
    if (error?.message?.toLowerCase().includes("already been registered")) {
      throw new ConflictError("Já existe uma conta com este e-mail. Faça login para continuar.");
    }
    throw new Error(`Falha ao criar conta: ${error?.message ?? "erro desconhecido"}`);
  }

  return {
    token: signIdentityToken(data.user.id, email),
    email,
    name: input.name.trim(),
  };
}

export interface IdentityCompanySummary {
  companyId: string;
  companyName: string;
  role: string;
}

// Estado da identidade logada: quem ela é e a quais empresas pertence.
// Alimenta a tela de "usuário sem empresa" e a decisão do front sobre
// mandar a pessoa para o app ou para o painel de identidade.
export async function getIdentityState(authUserId: string): Promise<{
  email: string;
  name: string;
  createdAt: string;
  companies: IdentityCompanySummary[];
}> {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(authUserId);
  if (error || !data.user) {
    throw new UnauthorizedError("Sessão inválida. Faça login novamente.");
  }

  // A fonte de verdade das memberships é o app_metadata, mas ele guarda só
  // companyId — o nome vem do banco. Filtramos por leftAt: quem saiu da
  // empresa não deve vê-la listada, mesmo que o metadata ainda não tenha
  // sido limpo (o metadata é atualizado na saída, isto é defesa em
  // profundidade contra ficar dessincronizado).
  const memberships = ((data.user.app_metadata as { memberships?: { companyId: string; role: string }[] })
    .memberships ?? []);

  const activeUsers = memberships.length
    ? await prisma.user.findMany({
        where: {
          authUserId,
          companyId: { in: memberships.map((m) => m.companyId) },
          leftAt: null,
          isActive: true,
        },
        select: { companyId: true, role: true, company: { select: { name: true } } },
      })
    : [];

  return {
    email: data.user.email ?? "",
    name: (data.user.user_metadata as { name?: string } | null)?.name ?? "",
    createdAt: data.user.created_at,
    companies: activeUsers.map((u) => ({
      companyId: u.companyId,
      companyName: u.company.name,
      role: u.role,
    })),
  };
}

// Login de identidade: mesma credencial do login normal, mas devolve um
// token de escopo "identity". Usado pela tela de login quando o usuário
// não tem nenhuma empresa — ver auth.service.ts (status NO_COMPANY).
export async function loginIdentity(email: string, password: string): Promise<{ token: string; email: string }> {
  const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    throw new UnauthorizedError("Credenciais inválidas");
  }
  return { token: signIdentityToken(data.user.id, data.user.email ?? email), email: data.user.email ?? email };
}
