import express from "express";
import cors from "cors";
import helmet from "helmet";
import { routes } from "./routes";
import { authRoutes } from "./routes/auth.routes";
import { platformRoutes } from "./routes/platform.routes";
import { authMiddleware } from "./middlewares/auth.middleware";
import { tenantMiddleware } from "./middlewares/tenant.middleware";
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
app.use("/api", authMiddleware, tenantMiddleware, routes);

app.use(errorMiddleware);
