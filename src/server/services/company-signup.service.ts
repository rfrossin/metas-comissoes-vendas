import crypto from "node:crypto";
import { Decimal } from "decimal.js";
import { prisma } from "../config/prisma";
import { prismaAdmin } from "../config/prisma-admin";
import { env } from "../config/env";
import { ConflictError, ForbiddenError, NotFoundError } from "../utils/http-errors";
import { sendMail } from "./mailer.service";
import { addMembershipToIdentity, sendInviteEmail } from "./permissoes.service";
import { generateInviteCode } from "../utils/invite-code.util";

const INVITE_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias — mesma regra do convite comum.

interface SubmitSignupInput {
  companyName: string;
  contactName: string;
  contactEmail: string;
  // Presente quando o pedido parte de alguém JÁ LOGADO (fluxo atual, via
  // /api/identidade/cadastrar-empresa). Ausente nos pedidos legados feitos
  // da tela de login.
  requesterAuthUserId?: string;
}

// Pública (sem autenticação) — o solicitante ainda não tem conta em lugar
// nenhum. Só registra o pedido e avisa o Super Admin por e-mail; não cria
// Company nem User. A criação real acontece em approveSignupRequest.
export async function submitCompanySignupRequest(input: SubmitSignupInput) {
  const existingPending = await prisma.companySignupRequest.findFirst({
    where: { contactEmail: input.contactEmail, status: "PENDENTE" },
  });
  if (existingPending) {
    throw new ConflictError("Já existe um pedido pendente para este e-mail.");
  }

  const request = await prismaAdmin.companySignupRequest.create({
    data: {
      companyName: input.companyName,
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      requesterAuthUserId: input.requesterAuthUserId ?? null,
    },
  });

  await sendMail({
    to: env.platformAdminEmail,
    subject: `Novo pedido de liberação: ${input.companyName}`,
    html: `
      <p>Um novo pedido de cadastro de empresa foi submetido.</p>
      <ul>
        <li><strong>Empresa:</strong> ${input.companyName}</li>
        <li><strong>Contato:</strong> ${input.contactName}</li>
        <li><strong>E-mail:</strong> ${input.contactEmail}</li>
      </ul>
      <p>Acesse o painel da plataforma para aprovar ou rejeitar este pedido.</p>
    `,
  }).catch(() => undefined);

  return request;
}

function assertSuperAdmin(platformUser: { role: "SUPER_ADMIN" | "SUPORTE" }): void {
  if (platformUser.role !== "SUPER_ADMIN") {
    throw new ForbiddenError("Só o Super Admin pode aprovar ou rejeitar pedidos de empresa.");
  }
}

export async function listCompanySignupRequests(status?: "PENDENTE" | "APROVADO" | "REJEITADO") {
  return prisma.companySignupRequest.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
  });
}

// Cria a Company de verdade + um Cargo "Administrador" padrão + o Invite
// que torna o solicitante ADMINISTRADOR dessa empresa (mesmo fluxo de
// e-mail do convite comum — a pessoa ainda define a própria senha pelo
// link, não recebe senha provisória). Roda em prismaAdmin: neste momento a
// Company não existe ainda, então não há companyId de tenant para o GUC
// que withTenant exige.
export async function approveCompanySignupRequest(
  requestId: string,
  platformUser: { id: string; role: "SUPER_ADMIN" | "SUPORTE" },
) {
  assertSuperAdmin(platformUser);

  const request = await prisma.companySignupRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new NotFoundError("Pedido não encontrado.");
  if (request.status !== "PENDENTE") {
    throw new ConflictError("Este pedido já foi aprovado ou rejeitado.");
  }

  const result = await prismaAdmin.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: { name: request.companyName, inviteCode: generateInviteCode() },
    });

    const cargo = await tx.cargo.create({
      data: {
        companyId: company.id,
        name: "Administrador",
        defaultFixedSalary: new Decimal(0),
        permissionLevel: "ADMINISTRADOR",
      },
    });

    // CAMINHO ATUAL — o solicitante já tem identidade (pediu logado).
    // Cria o User ADMINISTRADOR direto, sem convite: mandar convite aqui
    // era exatamente o bug que deixava a empresa vazia. A pessoa caía na
    // tela "defina sua senha", que não faz sentido para quem já tem conta
    // (e sobrescreveria a senha usada nas outras empresas dela), então
    // ninguém concluía e a empresa nascia sem nenhum usuário.
    if (request.requesterAuthUserId) {
      const adminUser = await tx.user.create({
        data: {
          companyId: company.id,
          email: request.contactEmail,
          passwordHash: "",
          authUserId: request.requesterAuthUserId,
          role: "ADMINISTRADOR",
        },
      });

      await tx.companySignupRequest.update({
        where: { id: requestId },
        data: {
          status: "APROVADO",
          reviewedByUserId: platformUser.id,
          reviewedAt: new Date(),
          createdCompanyId: company.id,
        },
      });

      return { kind: "direct" as const, companyId: company.id, userId: adminUser.id };
    }

    // CAMINHO LEGADO — pedido antigo, feito da tela de login por quem não
    // tinha conta. Segue por convite, que ali é o comportamento correto:
    // a pessoa precisa mesmo criar uma senha.
    const createdInvite = await tx.invite.create({
      data: {
        companyId: company.id,
        name: request.contactName,
        email: request.contactEmail,
        cargoId: cargo.id,
        token: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + INVITE_EXPIRATION_MS),
      },
    });

    await tx.companySignupRequest.update({
      where: { id: requestId },
      data: {
        status: "APROVADO",
        reviewedByUserId: platformUser.id,
        reviewedAt: new Date(),
        createdCompanyId: company.id,
      },
    });

    return { kind: "invite" as const, companyId: company.id, inviteToken: createdInvite.token };
  });

  if (result.kind === "direct") {
    // Fora da transação: escrita no Supabase não faz rollback junto com o
    // banco. Se falhar, a empresa existe e o User existe — o acesso é
    // recuperável reemitindo a membership, sem perder dados.
    await addMembershipToIdentity(request.requesterAuthUserId!, {
      userId: result.userId,
      companyId: result.companyId,
      role: "ADMINISTRADOR",
    });

    await sendMail({
      to: request.contactEmail,
      subject: `Sua empresa ${request.companyName} foi aprovada`,
      html: `
        <p>Olá, ${request.contactName}.</p>
        <p>A empresa <strong>${request.companyName}</strong> foi aprovada e já está vinculada à sua conta como Administrador.</p>
        <p>Faça login normalmente para começar a usar.</p>
      `,
    }).catch(() => undefined);

    return { companyId: result.companyId };
  }

  // Sem inviterName/inviterEmail: este convite nasce da aprovação do Super
  // Admin, não de um Admin humano da empresa — sendInviteEmail omite a
  // linha "convidado por" quando esses campos vêm vazios.
  await sendInviteEmail(request.contactEmail, result.inviteToken, {
    companyName: request.companyName,
    inviterName: "",
    inviterEmail: "",
  }).catch(() => undefined);

  return { companyId: result.companyId };
}

export async function rejectCompanySignupRequest(
  requestId: string,
  platformUser: { id: string; role: "SUPER_ADMIN" | "SUPORTE" },
  reason: string,
) {
  assertSuperAdmin(platformUser);

  const request = await prisma.companySignupRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new NotFoundError("Pedido não encontrado.");
  if (request.status !== "PENDENTE") {
    throw new ConflictError("Este pedido já foi aprovado ou rejeitado.");
  }

  await prismaAdmin.companySignupRequest.update({
    where: { id: requestId },
    data: {
      status: "REJEITADO",
      reviewedByUserId: platformUser.id,
      reviewedAt: new Date(),
      rejectionReason: reason,
    },
  });

  await sendMail({
    to: request.contactEmail,
    subject: "Seu pedido de cadastro não foi aprovado",
    html: `
      <p>Olá, ${request.contactName}.</p>
      <p>Seu pedido de cadastro da empresa <strong>${request.companyName}</strong> não foi aprovado.</p>
      ${reason ? `<p>Motivo: ${reason}</p>` : ""}
    `,
  }).catch(() => undefined);
}
