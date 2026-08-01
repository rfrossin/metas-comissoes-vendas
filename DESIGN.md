---
name: GMC — Gestão de Metas e Comissões
description: Painel operacional denso para metas comerciais e comissões escalonadas, alinhado à marca rossinvendas.com.
colors:
  brand-magenta: "#e60043"
  brand-magenta-source: "#fc0049"
  brand-black: "#0e0e0e"
  brand-white: "#fffef4"
  brand-green: "#16833e"
  brand-green-source: "#22c55e"
  hairline: "#e2e8f0"
  muted-ink: "#64748b"
  error: "#e11313"
  error-source: "#ef4444"
  warning: "#9d6506"
  warning-source: "#f59e0b"
typography:
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
spacing:
  sm: "4px"
  md: "8px"
  lg: "12px"
  xl: "16px"
components:
  button-primary:
    backgroundColor: "{colors.brand-magenta}"
    textColor: "{colors.brand-white}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.brand-black}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  card:
    backgroundColor: "{colors.brand-white}"
    rounded: "{rounded.lg}"
    padding: "16px"
  card-kpi:
    backgroundColor: "{colors.brand-white}"
    rounded: "{rounded.lg}"
    padding: "12px"
---

# Design System: GMC — Gestão de Metas e Comissões

## Overview

**Creative North Star: "A Sala de Controle"**

GMC é o painel onde um Admin, Gestor ou Vendedor confere números que decidem quanto alguém vai ganhar no fim do mês — não é uma vitrine, é instrumentação. A implementação atual (Tailwind + shadcn/ui, tema `slate` de fábrica, sem nenhuma cor de marca aplicada) já acerta a densidade certa: texto pequeno (`text-xs`/`text-sm` dominam, texto grande é raro), espaçamento apertado (`py-1`/`px-2`/`px-3` nas células, `p-4` nos contêineres), zero sombra (3 usos isolados de `shadow-sm` em toda a base), profundidade resolvida por borda de 1px (`border-border`) e por diferença de fundo (`bg-card` sobre `bg-background`), nunca por elevação. Essa gramática visual (Sala de Controle) permanece; o que falta é a identidade.

O site institucional [rossinvendas.com](https://www.rossinvendas.com/) já define essa identidade em produção: `--color-brand-magenta:#fc0049`, `--color-brand-black:#0e0e0e`, `--color-brand-white:#fffef4` (um branco quente, não puro) e `--color-brand-green:#22c55e`, tipografia Inter (300–900) via Google Fonts, raios `--radius-lg:.5rem` / `--radius-xl:.75rem`. `src/client/styles/globals.css` já implementa essa paleta (aplicado em sessão de `polish` anterior) — as cores de ação (`primary`/`success`/`destructive`) usam uma variante escurecida da cor-fonte para fechar 4.5:1 de contraste contra o fundo creme (ver The 4.5:1-Or-It-Doesn't-Ship Rule).

**Key Characteristics:**
- Denso, não decorativo — a informação é o produto, o cromo é mínimo.
- Plano por padrão — profundidade vem de borda e contraste de fundo, nunca de sombra.
- Magenta é escasso e proposital — reservado para ação primária e estado ativo, nunca para texto de corpo ou fundo grande.
- Preto quase puro (`brand-black`) carrega peso visual — títulos e texto de alto contraste, não o magenta.
- Cada estado de dado fala em uma de quatro vozes só — Sucesso/Alerta/Perigo/Neutro — nunca uma cor inventada ad hoc (ver Status Colors).
- Todo número que decide quanto alguém ganha é lido de cima a baixo numa coluna antes de ser lido da esquerda pra direita numa linha — por isso alinhamento numérico e dígitos tabulares não são polimento, são a função (ver The Aligned Digits Rule).

**The Instrumentation-Not-Marketing Rule.** Cada escolha de cor, peso ou tamanho neste sistema precisa encurtar o caminho entre "olhar a tela" e "tomar uma decisão de repasse/comissão". Se uma escolha existe só para "parecer com a marca" sem ajudar a ler um número ou detectar um estado mais rápido, ela não pertence à Sala de Controle — por mais fiel que seja ao rossinvendas.com.

## Colors

Paleta de marca restrita e de alto contraste — magenta como único acento de ação, preto e branco quente como base, verde reservado a um único significado (sucesso).

**Nota sobre "Secundária":** confirmado direto no CSS de produção do rossinvendas.com (`index-DsB877mt.css`, revalidado nesta sessão) — a marca-fonte declara exatamente 4 custom properties de cor (`--color-brand-magenta`, `--color-brand-black`, `--color-brand-white`, `--color-brand-green`). Não existe uma segunda cor de acento na marca; o site é deliberadamente mono-acento. Este sistema segue a mesma disciplina — por isso não há uma seção "Secondary" aqui. Introduzir uma cor secundária fabricada só para preencher a categoria quebraria a própria doutrina de escassez que torna o magenta reconhecível como "ação" (The Scarce Magenta Rule). Se um dia a marca-fonte ganhar uma segunda cor oficial, ela entra aqui como Secondary — até lá, o papel que normalmente cairia numa "Secondary" genérica é coberto por Neutral (hairline/cinza) e pelos tokens de Status abaixo.

### Primary
- **Brand Magenta** (`#e60043`, escurecida a partir da cor-fonte `#fc0049` — ver Named Rules): ação primária — botão "Salvar"/CTA, borda e fundo do estado ativo em seletores/toggles (granularidade, nível de entidade), links. Uso restrito: nunca em blocos grandes de fundo ou em texto de corpo.

### Tertiary
- **Brand Green** (`#16833e`, escurecida a partir da cor-fonte `#22c55e` — ver Named Rules): único papel — sinaliza sucesso/meta atingida/ritmo positivo (`text-success`/`bg-success` no Tailwind). Migrado nesta sessão: os usos que antes reaproveitavam `text-primary` para esse sinal (`KpiCardsRow`, `GranularityDetailTable`, `GoalLinesSection`, bulk-import panels) e os que usavam `emerald` fora do sistema de tokens (`GanhoPorMetaTable`, `MemberClosingDetailPage`, `SimulatorModal`) agora usam este token único.

### Neutral
- **Brand White** (`#fffef4`): fundo padrão da aplicação — branco quente, não puro. Substitui o `--background: 0 0% 100%` genérico atual.
- **Brand Black** (`#0e0e0e`): texto de alto contraste, títulos — substitui o `--foreground` quase-preto genérico atual (mesma temperatura visual, agora nomeado).
- **Hairline** (`#e2e8f0`): borda padrão de containers, células de tabela, inputs (`border-border`/`border-input`) — usado em praticamente toda superfície da aplicação (rodapé de 400+ ocorrências de `rounded-md`/`rounded-lg` combinadas com borda).
- **Muted Ink** (`#64748b`): texto secundário — labels de filtro, legendas, células de contexto (`text-muted-foreground`), o papel mais usado no app inteiro depois do texto de corpo.

### Functional (non-brand)
- **Error Red** (`#e11313`, escurecida a partir da cor-fonte `#ef4444`): erro, ação destrutiva, estado "Inativa desde…". Deliberadamente fora da paleta de marca — precisa continuar lendo como "risco" mesmo que o magenta de marca já puxe para o vermelho; manter os dois distinguíveis é o motivo de não reaproveitar o magenta aqui.
- **Warning Amber** (`#9d6506`, escurecida a partir de `#f59e0b` até 4.83:1 contra `--background` — mesma metodologia da Error Red, ver The 4.5:1-Or-It-Doesn't-Ship Rule): **novo nesta revisão.** Cobre o degrau que faltava entre "verde/sucesso" e "vermelho/perigo" — gatilho perto do limiar, prazo se aproximando, aprovação pendente. Também fora da paleta de marca (rossinvendas.com não tem âmbar); escolhida por ser o tom universalmente lido como "atenção" e por não colidir de matiz com o amarelo categórico (`#eda100`) usado só em gráficos de entidade, um contexto visual diferente. **Ainda não implementado em `globals.css`/Tailwind** — é a peça que faltava para o sistema de Status Colors abaixo fechar as 4 vozes; a primeira tela a adotá-la precisa criar `--warning`/`--warning-foreground` seguindo o mesmo padrão HSL de `--success`/`--destructive`.

### Status Colors (Semantic System)

O sistema de estado do produto fala em exatamente quatro vozes — nunca uma quinta cor inventada, e nunca o magenta de marca (que significa *ação*, não *estado*):

| Voz | Token | Valor | Contraste vs. fundo | Significa | Onde já aparece |
|---|---|---|---|---|---|
| **Sucesso** | `--success` / Brand Green | `#16833e` | 4.77:1 | Meta batida, gatilho liberado, ritmo positivo | `KpiCardsRow`, `GoalLinesSection`, badge "Liberado" em `GanhoPorMetaTable` |
| **Alerta** | `--warning` / Warning Amber | `#9d6506` | 4.83:1 | Perto do limiar, pendente de aprovação, atenção sem ser erro | **Novo** — ainda sem uso implementado |
| **Perigo** | `--destructive` / Error Red | `#e11313` | 4.82:1 | Bloqueado, erro, "Inativa desde…" | Chip de inativação em `GoalLineDetailPage`, `blockedReason` em `GanhoPorMetaTable` |
| **Neutro** | `--muted-foreground` / Muted Ink (ou borda tracejada) | `#64748b` | — | Ainda não decidido / fora das somatórias oficiais ("Previsto") | Tile "Previsto" em `RecebiveisKpiCardsRow`, badge "Previsto" em `GanhoPorMetaTable` |

**Observação de auditoria:** `GanhoPorMetaTable.tsx` usa hoje `bg-primary/10 text-primary` (magenta) para o badge "Fechado" — um estado passado/factual, não uma ação. Isso tensiona com The Scarce Magenta Rule e com a própria The Four-Voice Status Rule abaixo. Registrado aqui como observação, não corrigido nesta revisão (é mudança de código, fora do escopo de revisar o DESIGN.md); decidir se "Fechado" deveria migrar para Neutro na próxima vez que esse arquivo for tocado.

### Categorical (Data Visualization)
Paleta fixa de 8 cores para identidade de entidade nos gráficos de Acompanhamento (`src/client/pages/acompanhamento/entityColors.ts`), validada para o pior par adjacente em visão normal e com daltonismo, nesta ordem: `#2a78d6` azul, `#008300` verde, `#e87ba4` magenta, `#eda100` amarelo, `#1baf7a` aqua, `#eb6834` laranja, `#4a3aa7` violeta, `#e34948` vermelho. Cor é atribuída pela ordem de seleção da entidade, nunca reciclada — a identidade visual de uma entidade não muda quando outras entram/saem do filtro.

### Named Rules
**The Scarce Magenta Rule.** Brand Magenta aparece em no máximo um elemento de ação por tela e em estados ativos de toggle — nunca como cor de fundo de seção, nunca como cor de texto de corpo. Sua raridade é o que a torna "ação".

**The One Success Color Rule.** Verde é o único sinal de "meta batida"/"à frente do ritmo" no produto inteiro. Se um novo indicador positivo precisar de cor, é este verde — não uma variação de magenta.

**The 4.5:1-Or-It-Doesn't-Ship Rule.** As três (agora quatro, com Alerta) cores de ação/estado existem em duas variantes: a cor-fonte (ex. `#fc0049`, `#f59e0b`) e a cor implementada nos tokens CSS (ex. `#e60043`, `#9d6506`), escurecida até fechar 4.5:1 de contraste contra o fundo `--background` (creme). Uma revisão desta sessão mediu 3.7–4.0:1 nos valores de fábrica (falha WCAG AA) — todo novo token de cor de ação/estado precisa passar por esse mesmo cálculo antes de entrar em `globals.css`, não só copiar o hex da marca.

**The Four-Voice Status Rule.** Todo elemento que comunica estado — badge, borda de linha de tabela, cor de valor num KPI tile — fala em exatamente uma das quatro vozes da tabela de Status Colors: Sucesso, Alerta, Perigo ou Neutro. Nunca uma quinta cor inventada ad hoc, e nunca o magenta de marca como sinalizador de estado — magenta significa "aja aqui agora", não "isto está num certo estado". Se um novo estado não se encaixa nas quatro vozes, o problema é o modelo de estado, não a paleta.

## Typography

**Body/UI Font:** Inter (com fallback `ui-sans-serif, system-ui, sans-serif`) — confirmado no bundle CSS do rossinvendas.com (`@import` do Google Fonts, pesos 300–900). **Ainda não carregado no app** (`index.html` não referencia a fonte; o Tailwind atual cai no stack sans padrão do sistema).

**Character:** Inter é neutra e altamente legível em tamanhos pequenos — compatível com a densidade tabular do produto sem competir com o dado.

### Hierarchy
- **Headline** (600, 1.25rem/20px, 1.4): título de página (`<h1>` de cada macroambiente, ex. "Acompanhamento Meta x Resultados").
- **Title** (600, 0.875rem/14px, 1.4): título de seção/card (`<h3>` dentro de cada painel — "Metas", "Entidades", nomes de gráfico).
- **Body** (400, 0.875rem/14px, 1.5): texto de conteúdo, valores de tabela, itens de lista — o tamanho mais usado no produto (347 ocorrências de `text-sm`).
- **Label** (400, 0.75rem/12px, 1.4): rótulo de filtro, legenda, texto auxiliar (`text-muted-foreground`) — o segundo tamanho mais usado (341 ocorrências de `text-xs`), quase empatado com Body.

### Named Rules
**The No-Display-Size Rule.** Este produto não tem hero nem página de marketing interna — a maior letra do sistema é Headline (20px). Não introduzir tamanhos maiores só porque a marca tem musculatura tipográfica para isso; o Operate não pede. Corolário: o número grande de um KPI tile (`text-xl`/20px/600) usa exatamente o tamanho e peso de Headline, nunca maior — o valor mais importante da tela nunca é visualmente maior que o título da página.

**The Aligned Digits Rule.** Toda coluna numérica de tabela e todo valor de KPI usa algarismos tabulares (`font-variant-numeric: tabular-nums`) para que os dígitos se alinhem verticalmente ao escanear uma coluna de cima a baixo — o gesto real de conferência financeira, que compara magnitudes na vertical, não lê linha por linha. **Ainda não aplicado em nenhum lugar do código hoje** (0 ocorrências de `tabular-nums`); regra prospectiva — a próxima tabela ou KPI tile tocado deve adotar `tabular-nums` (Tailwind: `tabular-nums`) para começar a estabelecer o padrão.

## Layout

Densidade alta, sem grade de marketing. Cada macroambiente é uma coluna única de seções (`space-y-6`), cada seção é um cartão `rounded-lg border border-border p-4`; grids internos (ex. KPIs, filtros lado a lado) usam `grid`/`flex` responsivo (`sm:`/`lg:` breakpoints do Tailwind padrão) sem container de largura máxima — o painel ocupa a largura disponível ao lado da barra lateral fixa de navegação (`w-64`).

Ritmo vertical: `gap-3`/`gap-4` entre blocos, `space-y-2` dentro de um cartão. Células de tabela usam `px-2 py-1` a `px-3 py-1.5` — o espaçamento mais apertado do sistema, deliberado para tabelas densas de acompanhamento financeiro.

## Elevation & Depth

Sistema plano por padrão. Profundidade nunca vem de sombra — vem de borda de 1px (`border-border`, cor Hairline) delimitando cada cartão/seção, e de diferença sutil de fundo (`bg-card` vs `bg-background`, ou `bg-secondary/50` em hover). `shadow-sm`/`shadow-lg` aparecem só 4 vezes em toda a base — não é vocabulário ativo do sistema, é resíduo pontual.

### Named Rules
**The Flat-By-Default Rule.** Se um elemento precisa se destacar, o recurso é borda + fundo, nunca sombra. Sombra introduzida ad hoc quebra a leitura "sala de controle" do produto.

## Shapes

Dois raios fazem todo o trabalho: `rounded-md` (6px — `calc(var(--radius) - 2px)`) em botões, inputs, células de toggle, e em quase toda superfície interativa (268 ocorrências, de longe o mais comum); `rounded-lg` (8px — `var(--radius)`) em cartões e contêineres de seção (59 ocorrências). `rounded-full` aparece só 5 vezes (indicadores pontuais). O site institucional usa raios um pouco mais generosos (`--radius-lg:.5rem`/`--radius-xl:.75rem`, ou seja 8px/12px) — se o objetivo for aproximar visualmente o app do site, mover `rounded-lg`→8px (já bate) e considerar 12px para cartões de destaque é a única mudança pendente; não fazer isso silenciosamente numa tarefa não pedida.

## Components

### Buttons
- **Shape:** `rounded-md` (6px) em todos os botões, sem exceção observada.
- **Primary:** `bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50` — `bg-primary`→Brand Magenta, `text-primary-foreground`→Brand White. Hover (`bg-primary * 0.9`) e foco (`:focus-visible`, anel na cor de `--ring`) são regras globais em `globals.css`, não repetidas por componente.
- **Ghost/Outline:** `rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary/50`, com a cor do texto carregando a intenção semântica (`text-primary` para ação positiva, `text-destructive` para ação destrutiva) — o mesmo formato de botão serve as duas intenções, só a cor do texto muda.
- **Toggle/Segmented** (granularidade, nível de entidade): `rounded-md border px-2 py-1 text-xs`; estado ativo troca para `border-primary bg-primary text-primary-foreground`, inativo é `border-border text-foreground hover:bg-secondary/50`.

### KPI Cards
Tile mais repetido do produto depois da tabela — `RecebiveisKpiCardsRow`, `KpiCardsRow` (Acompanhamento) usam a mesma receita.
- **Padrão:** `rounded-lg border border-border bg-card p-3` (raio 8px, padding 12px — mais apertado que o `p-4` de seção); rótulo `text-xs text-muted-foreground` no topo, valor grande `text-xl font-semibold text-foreground` (mesmo tamanho/peso de Headline — ver The No-Display-Size Rule), legenda opcional `text-xs text-muted-foreground` embaixo.
- **Variante Provisório** (valor ainda não oficial — ex. "Previsto", período em andamento): borda tracejada `border-dashed border-muted-foreground/40`, fundo `bg-secondary/20` em vez de `bg-card`, valor em `text-muted-foreground` em vez de `text-foreground`. **The Dashed-Border Rule.** Um KPI que ainda não é definitivo (projeção, período aberto, não contabilizado) troca borda sólida por tracejada e cor de valor sólida por muted — o estilo da borda sozinho já diz se o número é oficial, sem precisar ler a legenda.

### Status Badges
Duas formas competem hoje no código — esta seção fixa qual é a canônica daqui pra frente.
- **Canônica (pill):** `rounded-full px-2 py-0.5 text-xs font-medium` + cor por Status Colors — `bg-success/10 text-success` (Sucesso/"Liberado"), `bg-warning/10 text-warning` (Alerta — **novo**, ver Status Colors), `bg-destructive/10 text-destructive` (Perigo), `border border-dashed border-muted-foreground/40 text-muted-foreground` (Neutro/"Previsto", mesma lógica tracejada do KPI provisório). Já implementado assim em `GanhoPorMetaTable.tsx` para 3 das 4 vozes (falta Alerta).
- **Legado (chip, `rounded` 4px):** `GoalLineDetailPage.tsx` tem dois badges nesse formato mais antigo — um neutro (`rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground`, "Meta Recalculada") e um de perigo (`rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive`, "Inativa desde…"). **Não migrado nesta revisão** (mudança de código, fora do escopo de revisar o DESIGN.md) — migrar para a forma pill na próxima vez que esse arquivo for tocado, para que "badge de status" tenha uma única silhueta no produto inteiro.

### Cards / Containers
- **Corner Style:** `rounded-lg` (8px).
- **Background:** `bg-card` (hoje idêntico a `bg-background`) para tiles de KPI; a maioria dos cartões de seção usa só `border-border` sobre o fundo da página, sem preenchimento próprio.
- **Shadow Strategy:** nenhuma — ver Elevation & Depth.
- **Border:** `border border-border`, sempre.
- **Internal Padding:** `p-4` (16px) é o padrão de seção; KPIs usam `p-3` (12px).

### Inputs / Fields
- **Style:** `rounded-md border border-input bg-background px-2 py-1 text-sm`.
- **Focus:** anel `:focus-visible` global (2px, cor `--ring` = Brand Magenta), definido uma vez em `globals.css` e herdado por todo input/select/botão — não repetido por componente.
- **Error / Disabled:** `disabled:opacity-50` é o único tratamento de estado observado; não há estilo de erro em campo (validação aparece como texto solto, não como borda/realce do próprio input).

### Navigation
- Barra lateral fixa (`w-64 border-r border-border p-4`) em telas `md`+; abaixo disso vira gaveta off-canvas (botão "☰ Menu" no topo, fecha ao navegar ou tocar fora). Item ativo `bg-secondary text-secondary-foreground`, inativo `text-muted-foreground hover:bg-secondary/50`, todos `rounded-md px-3 py-2 text-sm`. A gaveta só é montada no DOM quando aberta — um `fixed` só transladado para fora ainda contribuía pro `scrollWidth` do documento em alguns motores.

### Tables
Componente de fato mais repetido do sistema (Acompanhamento, Recebíveis, Metas, Fechamento todos usam a mesma receita). Cabeçalho `bg-secondary text-secondary-foreground`, linhas `border-t border-border`, células `px-2 py-1` a `px-3 py-1.5`, `text-xs`/`text-sm`, `whitespace-nowrap` quase universal (dados financeiros/tabulares não podem quebrar linha). Colunas numéricas alinhadas à direita (`text-right`).

### Receivables Table
Variante da Table genérica acima, específica do módulo Recebíveis (`GanhoPorMetaTable`, `DistribuicaoTable`, `Metas360Table`) — uma linha por (Base de Recebível, janela), com a densidade financeira mais alta do produto.
- **Wrapper:** `overflow-x-auto rounded-md border border-border` (raio 6px, mais contido que o `rounded-lg` de cartão).
- **Colunas:** identidade da Base + indicador na primeira coluna (nome em `font-medium text-foreground`, indicador em `text-xs text-muted-foreground` logo abaixo — 2 linhas numa célula); Status como Status Badge (pill, ver acima); valores monetários formatados via `toLocaleString("pt-BR", { style: "currency", currency: "BRL" })`; motivo de bloqueio (`blockedReason`) como linha extra `text-xs text-destructive` dentro da própria célula, não numa coluna separada.
- **Regra do sistema (nem sempre seguida hoje):** colunas numéricas/monetárias alinhadas à direita (`text-right`) e com `tabular-nums` (ver The Aligned Digits Rule) — **`GanhoPorMetaTable.tsx` hoje não aplica nenhum dos dois** nas colunas de Atingimento/Ganho/Ganho Potencial. Registrado como desvio conhecido, não corrigido nesta revisão (mudança de código); é o exemplo mais visível de onde aplicar as duas regras acima primeiro, já que é a tabela mais financeira do produto.

## Do's and Don'ts

### Do:
- **Do** reservar Brand Magenta para ação primária e estado ativo — nunca para fundo de seção ou texto de corpo, e nunca como sinalizador de estado/status (The Scarce Magenta Rule + The Four-Voice Status Rule).
- **Do** usar Brand Green como único sinal de sucesso/meta atingida, migrando os usos atuais de `text-primary` com esse significado assim que a paleta for aplicada (The One Success Color Rule).
- **Do** manter profundidade via borda + contraste de fundo, nunca sombra (The Flat-By-Default Rule).
- **Do** preservar a densidade atual (`text-xs`/`text-sm`, `py-1`/`px-2`/`px-3`) — é a decisão certa para um painel de conferência financeira usado o dia inteiro; não "arejar" isso numa tarefa de marca.
- **Do** usar as quatro vozes de Status Colors (Sucesso/Alerta/Perigo/Neutro) para todo badge, borda de estado ou cor de valor condicional — nunca uma quinta cor ad hoc (The Four-Voice Status Rule).
- **Do** aplicar `tabular-nums` e alinhamento à direita em toda coluna numérica/monetária nova, mesmo que tabelas existentes ainda não sigam isso (The Aligned Digits Rule).
- **Do** usar a forma pill (`rounded-full`) para badges de status novos, não o chip antigo de 4px — ver Status Badges.

### Don't:
- **Don't** introduzir uma cor de ação/estado (`primary`/`success`/`destructive`/`warning` ou uma nova) sem calcular o contraste contra `--background` primeiro — copiar o hex da marca direto quase sempre fica abaixo de 4.5:1 (The 4.5:1-Or-It-Doesn't-Ship Rule).
- **Don't** reintroduzir `text-primary`/cores hardcoded (`emerald-*`, etc.) para significar "sucesso" — use `text-success`/`bg-success` sempre; é o único papel dessa cor no sistema.
- **Don't** deixar um gráfico (Recharts/SVG) sem uma tabela-irmã ou `aria-label` — só um dos gráficos de Acompanhamento tinha isso até a critique desta sessão apontar os outros três.
- **Don't** introduzir sombra, gradiente ou decoração nova sem motivo funcional — quebra a leitura "Sala de Controle" que a densidade atual já constrói corretamente.
- **Don't** inventar uma cor "Secondary" de marca só para preencher a categoria — o rossinvendas.com é mono-acento por design; ver a nota em Colors.
- **Don't** deixar um KPI provisório (projeção, período aberto) usar a mesma borda sólida/cor de valor de um KPI oficial — a diferença visual é a única pista de que o número ainda pode mudar (The Dashed-Border Rule).
