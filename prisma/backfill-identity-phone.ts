import "dotenv/config";
import { supabaseAdmin } from "../src/server/config/supabase";
import { isValidPhone, normalizePhone } from "../src/shared/utils/phone.util";

// Backfill único: preenche user_metadata.phone das identidades que já
// existiam antes de o celular virar obrigatório no cadastro.
//
// As identidades atingidas recebem o MESMO número, por decisão explícita do
// usuário (rossin@rossinvendas.com, 2026-08-04): os acessos dele são todos
// seus, então não há dado real a preservar neles. Quando outras pessoas
// entrarem, cada uma cadastra o próprio celular no fluxo normal (ou corrige
// o dela em "Meus dados").
//
// Idempotente: só toca em identidade cujo phone está ausente ou vazio.
// Rodar de novo depois de alguém ter cadastrado o número correto NÃO
// sobrescreve o que já está lá.
const DEFAULT_PHONE = normalizePhone("(16) 992296316");

// Identidades que NÃO são do usuário e por isso não devem receber o número
// dele (confirmado por ele em 2026-08-04). Ficam sem celular de propósito:
// serão cobradas a informar o próprio no próximo aceite de convite, que é
// onde a tela pede o dado de quem ainda não tem (ver getInvitePublicInfo →
// needsPhone).
const EMAILS_EXCLUIDOS = new Set(["drigoslkx@gmail.com"]);

// Identidades da plataforma (Super Admin/Suporte) entram junto: são logins
// como quaisquer outros e a regra "todo usuário tem celular" vale para elas
// também.
async function main() {
  if (!isValidPhone(DEFAULT_PHONE)) {
    throw new Error(`Número padrão inválido: ${DEFAULT_PHONE}`);
  }

  let page = 1;
  let updated = 0;
  let alreadyHadPhone = 0;
  let excluded = 0;
  let failed = 0;

  // Paginação explícita: listUsers devolve no máximo perPage por chamada e
  // ignorar isso deixaria identidades para trás silenciosamente assim que a
  // base passar de uma página.
  for (;;) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Falha ao listar identidades: ${error.message}`);
    if (!data.users.length) break;

    for (const user of data.users) {
      if (user.email && EMAILS_EXCLUIDOS.has(user.email.toLowerCase())) {
        excluded += 1;
        console.log(`  PULADO ${user.email} (identidade de terceiro)`);
        continue;
      }

      const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
      const currentPhone = typeof metadata.phone === "string" ? metadata.phone : "";

      if (currentPhone.trim()) {
        alreadyHadPhone += 1;
        continue;
      }

      // Merge sobre o metadata existente: updateUserById substitui o objeto
      // inteiro, então mandar só { phone } apagaria o name já gravado.
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
        user_metadata: { ...metadata, phone: DEFAULT_PHONE },
      });

      if (updateError) {
        failed += 1;
        console.error(`  ERRO ${user.email ?? user.id}: ${updateError.message}`);
        continue;
      }

      updated += 1;
      console.log(`  OK ${user.email ?? user.id} -> ${DEFAULT_PHONE}`);
    }

    if (data.users.length < 200) break;
    page += 1;
  }

  console.log(
    `\nBackfill concluído: ${updated} atualizadas, ${alreadyHadPhone} já tinham celular, ` +
      `${excluded} excluídas por serem de terceiros, ${failed} falharam.`,
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
