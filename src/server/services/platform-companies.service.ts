import { prisma } from "../config/prisma";

// Visão do Super Admin sobre todas as empresas e seus usuários — só
// leitura, sem qualquer isolamento por companyId (o próprio ponto desta
// tela é atravessar tenants). Nunca expor fora de platformAuthMiddleware.
export async function listCompaniesWithUsers() {
  return prisma.company.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      status: true,
      createdAt: true,
      users: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          email: true,
          role: true,
          isActive: true,
          createdAt: true,
          member: { select: { fullName: true } },
        },
      },
    },
  });
}
