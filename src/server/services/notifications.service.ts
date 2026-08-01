import { prisma, writeWithTenant } from "../config/prisma";
import { supabaseAdmin } from "../config/supabase";
import { NotFoundError } from "../utils/http-errors";
import type { RequestingUser } from "./scope.util";

// Cria uma notificação para um usuário específico — hoje sem nenhum
// gerador de eventos automático (gatilho liberado, fechamento pendente
// etc.) ligado a este painel, só a infraestrutura (Fase 5 do plano de
// migração Supabase). userId aqui é User.id (o formato usado em todo o
// resto do backend); a função resolve o authUserId internamente antes de
// gravar, porque é essa coluna que a política RLS de Realtime usa.
export async function createNotification(
  companyId: string,
  targetUserId: string,
  title: string,
  body: string,
): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { id: targetUserId, companyId },
    select: { authUserId: true },
  });
  if (!user?.authUserId) {
    throw new NotFoundError("Usuário não encontrado ou ainda não migrado para o novo login.");
  }

  await writeWithTenant((tx) =>
    tx.notification.create({
      data: { companyId, userId: user.authUserId!, title, body },
    }),
  );
}

export async function listMyNotifications(companyId: string, requestingUser: RequestingUser) {
  const user = await prisma.user.findUnique({
    where: { id: requestingUser.id },
    select: { authUserId: true },
  });
  if (!user?.authUserId) return [];

  return prisma.notification.findMany({
    where: { companyId, userId: user.authUserId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

// Gera uma sessão Supabase de curta duração para o cliente autenticar o
// canal Realtime (client.realtime.setAuth()) — o login do dia a dia passa
// pelo backend e não estabelece sessão Supabase no navegador (só o fluxo
// de convite faz isso, ver AceitarConvitePage.tsx). generateLink com
// magiclink cria um hashed_token que o frontend troca localmente por uma
// sessão via supabase.auth.verifyOtp, sem enviar e-mail nenhum.
export async function getRealtimeAuthToken(requestingUser: RequestingUser): Promise<{ email: string; tokenHash: string }> {
  const user = await prisma.user.findUnique({
    where: { id: requestingUser.id },
    select: { email: true, authUserId: true },
  });
  if (!user?.authUserId) {
    throw new NotFoundError("Usuário ainda não migrado para o novo login.");
  }

  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email: user.email,
  });
  if (error || !data) {
    throw new Error(`Falha ao gerar token de sessão Realtime: ${error?.message}`);
  }

  return { email: user.email, tokenHash: data.properties.hashed_token };
}
