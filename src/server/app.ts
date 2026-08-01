import express from "express";
import cors from "cors";
import helmet from "helmet";
import { routes } from "./routes";
import { authRoutes } from "./routes/auth.routes";
import { platformRoutes } from "./routes/platform.routes";
import { authMiddleware } from "./middlewares/auth.middleware";
import { tenantMiddleware } from "./middlewares/tenant.middleware";
import { errorMiddleware } from "./middlewares/error.middleware";

export const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
// Fora do tenantMiddleware — o Super Admin da plataforma não pertence a
// nenhuma Company.
app.use("/api/plataforma", platformRoutes);
app.use("/api", authMiddleware, tenantMiddleware, routes);

app.use(errorMiddleware);
