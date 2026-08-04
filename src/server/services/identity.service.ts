import jwt from "jsonwebtoken";
import { prisma } from "../config/prisma";
import { supabaseAdmin, supabaseAuth } from "../config/supabase";
import { env } from "../config/env";
import { ConflictError, NotFoundError, UnauthorizedError } from "../utils/http-errors";
import { acceptInvite } from "./permissoes.service";

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
  // Só dígitos (DDD + número) — o controller já normalizou e validou.
  phone: string;
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
    // phone vai em user_metadata, não no campo `phone` nativo do Supabase:
    // aquele é o identificador de login por SMS e exige provider de SMS
    // configurado (não temos) — usá-lo faria o createUser falhar. Aqui é só
    // um dado de contato da pessoa, ao lado do nome.
    user_metadata: { name: input.name.trim(), phone: input.phone },
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
  phone: string;
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

  const metadata = data.user.user_metadata as { name?: string; phone?: string } | null;

  return {
    email: data.user.email ?? "",
    name: metadata?.name ?? "",
    // Vazio só para identidades anteriores ao backfill; o cadastro passou a
    // exigir o celular, então toda conta nova nasce com ele preenchido.
    phone: metadata?.phone ?? "",
    createdAt: data.user.created_at,
    companies: activeUsers.map((u) => ({
      companyId: u.companyId,
      companyName: u.company.name,
      role: u.role,
    })),
  };
}

// Edição dos dados da PESSOA (nome e celular), feita pela própria pessoa
// em /minha-conta. Vale para todas as empresas dela de uma vez — é esse o
// ponto de o dado morar na identidade e não em cada linha de User.
//
// E-mail fica de fora de propósito: ele é a chave que identifica o usuário
// (um usuário por e-mail) e trocá-lo mexe na credencial de login e nas
// referências dos convites — é uma operação de outra natureza, não um
// campo de perfil.
export async function updateMyIdentity(
  authUserId: string,
  input: { name: string; phone: string },
): Promise<{ name: string; phone: string }> {
  const { data: current, error: readError } = await supabaseAdmin.auth.admin.getUserById(authUserId);
  if (readError || !current.user) {
    throw new UnauthorizedError("Sessão inválida. Faça login novamente.");
  }

  // Merge sobre o metadata existente: updateUserById SUBSTITUI o
  // user_metadata inteiro, então mandar só {name, phone} apagaria qualquer
  // outra chave que já estivesse gravada ali.
  const metadata = (current.user.user_metadata ?? {}) as Record<string, unknown>;

  const { data, error } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
    user_metadata: { ...metadata, name: input.name.trim(), phone: input.phone },
  });
  if (error || !data.user) {
    throw new Error(`Não foi possível salvar seus dados: ${error?.message ?? "erro desconhecido"}`);
  }

  return { name: input.name.trim(), phone: input.phone };
}

// Troca um token de TENANT válido por um de IDENTIDADE, sem pedir a senha
// de novo. Existe para o item "Entrar em outra empresa" do menu do header:
// quem já está logado numa empresa não deveria ter de deslogar só para
// acessar o painel de conta e pedir entrada em outra.
//
// Seguro porque parte de uma sessão já autenticada: o userId vem do token
// de tenant (validado pelo authMiddleware), e daqui só se extrai o
// authUserId correspondente — nenhuma escalada de privilégio, já que o
// escopo "identity" dá menos acesso que o de tenant, não mais.
export async function issueIdentityTokenForUser(userId: string): Promise<{ token: string; email: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { authUserId: true, email: true },
  });
  if (!user?.authUserId) {
    throw new UnauthorizedError("Este usuário não tem identidade vinculada.");
  }
  return { token: signIdentityToken(user.authUserId, user.email), email: user.email };
}

// Convites PENDENTES dirigidos ao e-mail desta identidade — o lado do
// convidado (listPendingInvites em permissoes.service.ts é o lado do
// Admin, que vê os convites que a empresa dele emitiu).
//
// Existe para o convite não depender só do link do e-mail: se ele se
// perdeu na caixa de spam, o convite continua acessível dentro do painel.
export async function listMyPendingInvites(authUserId: string) {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(authUserId);
  if (error || !data.user?.email) return [];

  const invites = await prisma.invite.findMany({
    where: {
      // insensitive: o e-mail do convite é digitado à mão pelo Admin e
      // pode divergir no caixa ("Rossin@" vs "rossin@") — sem isto o
      // convidado simplesmente não veria o próprio convite.
      email: { equals: data.user.email, mode: "insensitive" },
      status: "PENDENTE",
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      token: true,
      expiresAt: true,
      company: { select: { name: true } },
      cargo: { select: { name: true } },
    },
  });

  return invites.map((invite) => ({
    id: invite.id,
    token: invite.token,
    companyName: invite.company.name,
    cargoName: invite.cargo?.name ?? null,
    expiresAt: invite.expiresAt,
  }));
}

// Aceite de convite DE DENTRO do painel, por quem já está autenticado.
//
// Diferente de acceptInvite (rota pública): lá a identidade é provada pelo
// link do e-mail e a pessoa precisa definir/confirmar senha. Aqui ela já
// provou quem é pelo token de identidade, então basta validar que o
// convite é mesmo para o e-mail dela — o que impede alguém de aceitar um
// convite alheio de posse do token.
export async function acceptInviteAsIdentity(authUserId: string, inviteToken: string) {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(authUserId);
  if (error || !data.user?.email) {
    throw new UnauthorizedError("Sessão inválida. Faça login novamente.");
  }

  const invite = await prisma.invite.findUnique({
    where: { token: inviteToken },
    select: { email: true },
  });
  if (!invite) {
    throw new NotFoundError("Convite inválido ou já utilizado.");
  }
  if (invite.email.toLowerCase() !== data.user.email.toLowerCase()) {
    // Mesma mensagem de "não encontrado": revelar que o convite existe,
    // mas é de outra pessoa, já é informação a mais.
    throw new NotFoundError("Convite inválido ou já utilizado.");
  }

  // Daqui em diante é exatamente o mesmo caminho do aceite público —
  // incluindo papel derivado do Cargo e reativação de quem já saiu.
  return acceptInvite(inviteToken, authUserId);
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
