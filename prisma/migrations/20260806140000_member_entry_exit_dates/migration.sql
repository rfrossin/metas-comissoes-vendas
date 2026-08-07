-- Datas de vínculo empregatício do Membro (regra confirmada em 2026-08-06):
-- o Membro só tem RECEBÍVEIS e FECHAMENTOS a partir da data de ENTRADA e
-- até a data de SAÍDA da empresa.
--
-- Ambas nullable de propósito, e é o que torna esta migration segura para as
-- linhas já existentes: Membro sem entryDate vale "desde sempre" e Membro
-- sem exitDate segue com vínculo aberto — exatamente o comportamento atual,
-- então nenhum Membro em produção muda de comportamento ao aplicar isto.
--
-- DATE (não TIMESTAMP): são datas de calendário do RH (admissão/
-- desligamento), sem hora e sem fuso — o mesmo critério já usado para as
-- datas de negócio do sistema. Distintas de members.inactivatedAt, que é o
-- carimbo técnico de quando o cadastro foi inativado no sistema e continua
-- existindo sem alteração.
ALTER TABLE "members" ADD COLUMN "entryDate" DATE;
ALTER TABLE "members" ADD COLUMN "exitDate" DATE;
