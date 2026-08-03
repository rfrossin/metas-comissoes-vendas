import type { Request, Response, NextFunction } from "express";
import { prisma } from "../config/prisma";

// Rotas que continuam abertas mesmo com a empresa pausada. São todas de
// CONTA, não de operação: sem elas o usuário ficaria preso numa tela morta,
// sem conseguir nem trocar para outra empresa dele nem entender o que
// houve. Nenhuma expõe dado de metas/recebíveis/resultados.
const ALLOWED_WHILE_BLOCKED = [
  "/permissoes/meu-perfil",
  "/permissoes/minhas-empresas",
  "/permissoes/trocar-empresa",
  "/permissoes/minha-senha",
  "/permissoes/minhas-atribuicoes",
];

// Empresa com status != ATIVA fica em modo somente-leitura-zero: o login
// funciona (a identidade da pessoa não é punida, e ela pode ter outras
// empresas), mas nada de operar DENTRO desta empresa.
//
// Roda depois de authMiddleware/tenantMiddleware, então req.user.companyId
// já é confiável — e já passou pela checagem de escopo do token.
export async function companyStatusGuard(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    next();
    return;
  }

  if (ALLOWED_WHILE_BLOCKED.some((path) => req.path.startsWith(path))) {
    next();
    return;
  }

  const company = await prisma.company.findUnique({
    where: { id: req.user.companyId },
    select: { status: true },
  });

  // Empresa inexistente (excluída enquanto a sessão estava aberta) também
  // cai aqui: o token continua válido por até 8h, mas não há mais o que
  // acessar.
  if (!company) {
    res.status(403).json({
      code: "COMPANY_NOT_FOUND",
      message: "Esta empresa não está mais disponível.",
    });
    return;
  }

  if (company.status !== "ATIVA") {
    // 403 com `code`: o front distingue esta situação de um erro comum e
    // mostra a tela de "acesso pausado" em vez de "algo deu errado".
    res.status(403).json({
      code: "COMPANY_BLOCKED",
      message: "O acesso a esta empresa está pausado. Fale com o administrador da plataforma.",
    });
    return;
  }

  next();
}
