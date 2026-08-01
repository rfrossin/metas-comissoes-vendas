import { Router } from "express";
import { estruturaOrganizacionalRoutes } from "./estrutura-organizacional.routes";
import { resultadosRoutes } from "./resultados.routes";
import { basesMetasRoutes } from "./bases-metas.routes";
import { metasRoutes } from "./metas.routes";
import { acompanhamentoRoutes } from "./acompanhamento.routes";
import { cargosRoutes } from "./cargos.routes";
import { basesRecebiveisRoutes } from "./bases-recebiveis.routes";
import { recebiveisRoutes } from "./recebiveis.routes";
import { fechamentoRoutes } from "./fechamento.routes";
import { permissoesRoutes } from "./permissoes.routes";
import { notificationsRoutes } from "./notifications.routes";

// Rotas autenticadas — montadas em app.ts atrás do authMiddleware.
// /api/auth fica de fora deste router (é a única rota pública).
export const routes = Router();

routes.use("/estrutura-organizacional", estruturaOrganizacionalRoutes);
routes.use("/resultados", resultadosRoutes);
routes.use("/bases-metas", basesMetasRoutes);
routes.use("/metas", metasRoutes);
routes.use("/acompanhamento", acompanhamentoRoutes);
routes.use("/cargos", cargosRoutes);
routes.use("/bases-recebiveis", basesRecebiveisRoutes);
routes.use("/recebiveis", recebiveisRoutes);
routes.use("/fechamento", fechamentoRoutes);
routes.use("/permissoes", permissoesRoutes);
routes.use("/notificacoes", notificationsRoutes);
