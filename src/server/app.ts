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
