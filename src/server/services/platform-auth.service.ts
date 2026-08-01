import jwt from "jsonwebtoken";
import { prisma } from "../config/prisma";
import { supabaseAuth } from "../config/supabase";
import { env } from "../config/env";
import { UnauthorizedError } from "../utils/http-errors";

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
    throw new UnauthorizedError("Esta identidade não tem acesso ao painel da plataforma.");
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
