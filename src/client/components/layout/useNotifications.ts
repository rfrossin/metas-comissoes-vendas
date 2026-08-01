import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import { supabase } from "@/services/supabase";
import { useAuthStore } from "@/store/auth.store";

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

// O login do dia a dia passa pelo backend (POST /auth/login) e não
// estabelece sessão Supabase no navegador — só o fluxo de convite faz
// isso (AceitarConvitePage.tsx), e desloga ao final. Sem uma sessão
// Supabase real, o Realtime não autentica o canal (auth.uid() fica nulo
// nas políticas RLS). Aqui trocamos um hashed_token (gerado pelo backend
// via generateLink/magiclink, sem enviar e-mail) por uma sessão local via
// verifyOtp — só então client.realtime.setAuth() tem o que usar.
export function useNotifications() {
  const token = useAuthStore((state) => state.token);
  const queryClient = useQueryClient();

  const { data: notifications } = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => {
      const { data } = await api.get<AppNotification[]>("/notificacoes/minhas");
      return data;
    },
    enabled: !!token,
  });

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function subscribe() {
      const { data: existingSession } = await supabase.auth.getSession();

      if (!existingSession.session) {
        const { data: tokenData } = await api.get<{ email: string; tokenHash: string }>(
          "/notificacoes/realtime-token",
        );
        const { error } = await supabase.auth.verifyOtp({
          email: tokenData.email,
          token: tokenData.tokenHash,
          type: "magiclink",
        });
        if (error || cancelled) return;
      }

      if (cancelled) return;

      channel = supabase
        .channel("notifications-changes")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications" },
          () => {
            // O evento já chega filtrado pela RLS (só a própria linha) —
            // não precisamos ler o payload, só invalidar e deixar a
            // query normal buscar a lista atualizada.
            queryClient.invalidateQueries({ queryKey: ["notifications"] });
          },
        )
        .subscribe();
    }

    subscribe();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [token, queryClient]);

  return { notifications: notifications ?? [] };
}
