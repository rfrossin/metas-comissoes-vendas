import { Router } from "express";
import { listMyNotificationsHandler, realtimeAuthTokenHandler } from "../controllers/notifications.controller";
import { asyncHandler } from "../utils/async-handler";

export const notificationsRoutes = Router();

notificationsRoutes.get("/minhas", asyncHandler(listMyNotificationsHandler));
notificationsRoutes.get("/realtime-token", asyncHandler(realtimeAuthTokenHandler));
