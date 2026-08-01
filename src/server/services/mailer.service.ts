import nodemailer from "nodemailer";
import { env } from "../config/env";

// Transporte único, reaproveitado entre chamadas — evita reabrir conexão
// SMTP a cada e-mail enviado.
const transporter = nodemailer.createTransport({
  host: env.smtpHost,
  port: env.smtpPort,
  secure: env.smtpPort === 465,
  auth: { user: env.smtpUser, pass: env.smtpPassword },
});

interface SendMailInput {
  to: string;
  subject: string;
  html: string;
}

export async function sendMail(input: SendMailInput): Promise<void> {
  await transporter.sendMail({
    from: env.smtpFrom,
    to: input.to,
    subject: input.subject,
    html: input.html,
  });
}
