import type { Request, Response } from "express";
import { getRealtimeAuthToken, listMyNotifications } from "../services/notifications.service";
import { NotFoundError } from "../utils/http-errors";

export async function listMyNotificationsHandler(req: Request, res: Response) {
  const notifications = await listMyNotifications(req.user!.companyId, req.user!);
  res.json(notifications);
}

export async function realtimeAuthTokenHandler(req: Request, res: Response) {
  try {
    const token = await getRealtimeAuthToken(req.user!);
    res.json(token);
  } catch (error) {
    if (error instanceof NotFoundError) {
      res.status(404).json({ message: error.message });
      return;
    }
    throw error;
  }
}
