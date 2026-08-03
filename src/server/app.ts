import express from "express";
import cors from "cors";
import helmet from "helmet";
import { routes } from "./routes";
import { authRoutes } from "./routes/auth.routes";
import { platformRoutes } from "./routes/platform.routes";
import { identityRoutes } from "./routes/identity.routes";
import { authMiddleware } from "./middlewares/auth.middleware";
import { tenantMiddleware } from "./middlewares/tenant.middleware";
import { companyStatusGuard } from "./middlewares/company-status.middleware";
import { errorMiddleware } from "./middlewares/error.middleware";
import { env } from "./config/env";

export const app = express();

// Backend roda atrás do Caddy (reverse proxy no VPS) — sem isso, req.ip e
// o express-rate-limit enxergam o IP interno do Docker (o mesmo para
// TODOS os visitantes), não o IP real de cada um. Causava o rate limit de
// login (authRateLimiter) bloquear o site inteiro para todo mundo assim
// que qualquer pessoa errasse a senha algumas vezes. "1" confia no
// primeiro hop da cadeia (o Caddy), único proxy nesta topologia.
app.set("trust proxy", 1);

app.use(helmet());
// Restrito à origin do front — a auth usa header Authorization (não
// cookie), então não há necessidade de credentials: true.
app.use(cors({ origin: env.frontendUrl }));
app.use(express.json());

// Pública, sem auth — usada pelo healthcheck do Docker/Caddy para saber se
// o container subiu.
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRoutes);
// Fora do tenantMiddleware — o Super Admin da plataforma não pertence a
// nenhuma Company.
app.use("/api/plataforma", platformRoutes);
// Também fora do tenantMiddleware, pelo mesmo motivo: o dono de um token
// de identidade pode não ter empresa nenhuma. Precisa vir ANTES do
// app.use("/api", authMiddleware, ...) abaixo — aquele middleware exige
// token de tenant e rejeitaria estas rotas com 401.
app.use("/api/identidade", identityRoutes);
// companyStatusGuard depois do tenantMiddleware: só então req.user.companyId
// é confiável. Bloqueia operar dentro de uma empresa pausada pelo Super
// Admin, sem impedir o login nem o acesso às outras empresas da pessoa.
app.use("/api", authMiddleware, tenantMiddleware, companyStatusGuard, routes);

app.use(errorMiddleware);
