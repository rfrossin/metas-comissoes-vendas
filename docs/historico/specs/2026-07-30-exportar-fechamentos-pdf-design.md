# Exportar Fechamentos em PDF — Design

## Contexto

Parte G de 4 (última — D, E e F já entregues, PASSOs 22-24). Na tela de Fechamento, exportar os Fechamentos selecionados num único arquivo PDF com várias páginas: 1ª parte um resumo geral (1 linha por Fechamento), depois o detalhamento completo de cada um — para o Gestor mandar pro RH.

## Abordagem técnica (decidida com o usuário)

HTML renderizado no servidor → **Puppeteer** (Chromium headless) → PDF. CSS cuida da paginação (`page-break-before: always` antes de cada detalhamento) — sem precisar posicionar texto manualmente, ao contrário de uma lib de desenho como `pdfkit`. Nova dependência: `puppeteer` (`npm install puppeteer` — baixa um Chromium próprio, ~300MB no disco da máquina/servidor, download único na instalação).

## Escopo: só Fechamentos FECHADO

A exportação só faz sentido para Fechamentos já concluídos (dado salvo e estável — `resultsByType`, `campaignsSummaryText`, `closedAt`) — uma linha ABERTO/PREVISTO é um cálculo ao vivo, não um registro fechado apropriado para mandar pro RH pagar. Reaproveita exatamente a mesma seleção "Fechado" já construída na Parte E (`selectedFechadoItems`, o mesmo conjunto que alimenta "Reabrir Selecionados") — nenhuma lógica de seleção nova no client.

## Design

### Botão novo em `FechamentoPage.tsx`

"Exportar Selecionados em PDF (N)" — aparece junto de "Fechar Selecionados"/"Reabrir Selecionados", habilitado quando `selectedFechadoItems.length > 0`. Ao clicar, baixa o arquivo diretamente (sem navegação de tela) — mesmo padrão de "baixar arquivo" de uma API JSON: requisição com `responseType: "blob"`, e um link temporário (`URL.createObjectURL`) disparando o download no browser.

### Backend

Novo arquivo `fechamento-pdf.service.ts` (mantém `fechamento.service.ts`, já grande, sem crescer mais) — 2 responsabilidades separadas:

1. **`buildFechamentoPdfHtml(details: ClosingDetail[]): string`** — função pura, monta o HTML completo (sem I/O, sem Puppeteer): uma seção "Resumo Geral" (1 tabela, 1 linha por Fechamento — Membro, Mês, Cargo, Fixo, Benefícios, Total, mesmas colunas já usadas na lista de `FechamentoPage.tsx`, `benefitsValue` calculado como `totalValue - fixedValue - manualAdjustmentValue`, mesma fórmula já usada em `listClosings`) seguida de 1 bloco de detalhamento por Fechamento (cada um começando em página nova via CSS, `@page` + `page-break-before: always`) — replica as mesmas seções já mostradas em `MemberClosingDetailPage.tsx`: cabeçalho (Membro, Mês, Cargo, Hierarquia), totais (Fixo/%Fixo/%Resultado/Valor Específico/Total), Premiações Físicas, Resultados do Período por Tipo, Campanhas de Recebível (com detalhamento de Degraus batidos), Comentários/Ajuste Manual, "Fechado em".
2. **`exportClosingsPdf(companyId, requestingUser, items): Promise<Buffer>`** — orquestra: busca cada Fechamento via `getClosingDetail` (já existente, já valida permissão — `assertCanViewFechamento`+`assertNativeVisibleMembers` — por Membro); se algum item não estiver `isSaved` (ex.: foi reaberto entre a tela carregar e o clique em exportar), interrompe com `ConflictError` claro em vez de gerar um PDF com dado incompleto misturado; monta o HTML (`buildFechamentoPdfHtml`); abre 1 página Puppeteer, `setContent`, `pdf({format: "A4", printBackground: true})`; fecha o browser; devolve o Buffer.

### Rota/Controller

`POST /fechamento/export-pdf`, corpo `{ items: [{memberId, referenceMonth}] }` (reaproveita o `bulkSaveSchema` já existente — mesmo formato de `/fechamento/bulk-save`/`/fechamento/bulk-reopen`). Handler chama `exportClosingsPdf` e responde com `Content-Type: application/pdf` + `Content-Disposition: attachment; filename="fechamentos-<data>.pdf"` — não é JSON, é o Buffer direto.

### Frontend

`useExportClosingsPdf()` (novo hook) — `mutationFn` chama `api.post("/fechamento/export-pdf", { items }, { responseType: "blob" })`, e no sucesso dispara o download (`URL.createObjectURL`+`<a download>` temporário). Botão novo em `FechamentoPage.tsx`, ao lado dos outros 2 de ação em massa.

## Testes

`buildFechamentoPdfHtml` é função pura (recebe `ClosingDetail[]`, devolve string) — testável sem Puppeteer/banco: confirmar que o HTML contém o Resumo Geral com N linhas e N blocos de detalhamento, cada um com os campos certos. `exportClosingsPdf` (Puppeteer + banco) validada só por smoke real, mesmo padrão de funções orquestradoras já estabelecido no projeto. Validação: `tsc`+`vitest`; smoke real — selecionar 2+ Fechamentos reais Fechados, exportar, abrir o PDF baixado e conferir visualmente o Resumo Geral + os 2 detalhamentos em páginas separadas, com os valores batendo com a tela de detalhe de cada um.
