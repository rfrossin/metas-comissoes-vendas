import crypto from "node:crypto";
import { Decimal } from "decimal.js";
import { prisma } from "../config/prisma";
import { prismaAdmin } from "../config/prisma-admin";
import { env } from "../config/env";
import { ConflictError, ForbiddenError, NotFoundError } from "../utils/http-errors";
import { sendMail } from "./mailer.service";
import { sendInviteEmail } from "./permissoes.service";

const INVITE_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias — mesma regra do convite comum.

interface SubmitSignupInput {
  companyName: string;
  contactName: string;
  contactEmail: string;
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

  const request = await prismaAdmin.companySignupRequest.create({ data: input });

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

  const invite = await prismaAdmin.$transaction(async (tx) => {
    const company = await tx.company.create({ data: { name: request.companyName } });

    const cargo = await tx.cargo.create({
      data: {
        companyId: company.id,
        name: "Administrador",
        defaultFixedSalary: new Decimal(0),
        permissionLevel: "ADMINISTRADOR",
      },
    });

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

    return createdInvite;
  });

  // Sem inviterName/inviterEmail: este convite nasce da aprovação do Super
  // Admin, não de um Admin humano da empresa — sendInviteEmail omite a
  // linha "convidado por" quando esses campos vêm vazios.
  await sendInviteEmail(request.contactEmail, invite.token, {
    companyName: request.companyName,
    inviterName: "",
    inviterEmail: "",
  }).catch(() => undefined);

  return { companyId: invite.companyId };
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
