import rateLimit from "express-rate-limit";

// Proteção contra força bruta nas rotas de autenticação — 10 tentativas
// por IP a cada 15 minutos. Aplicado só em rotas de login/troca de sessão,
// nunca globalmente: rotas de leitura normais não precisam desse limite.
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente." },
});
