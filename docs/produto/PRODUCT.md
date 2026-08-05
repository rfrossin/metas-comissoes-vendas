# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

GMC (Gestão de Metas e Comissões) é um SaaS multi-tenant: cada empresa cliente opera em um Tenant isolado. Três papéis dentro de cada Tenant:

- **Admin da Empresa:** configura a empresa, gerencia usuários, define o "Norte" do cálculo de metas e as regras de comissionamento.
- **Gerente/Coordenador:** visão de liderança de nó — painéis acumulados do seu time ou de todos os vendedores abaixo dele na hierarquia.
- **Vendedor:** visão estritamente individual — seus próprios resultados (Painel Sprint/Maratona), sem acesso a dados de outros vendedores ou consolidados de equipe.

O produto é vendido/licenciado para outras empresas comerciais gerenciarem sua própria operação de metas e comissões (não é uso interno de uma única operação).

## Product Purpose

Estruturar metas comerciais, acompanhar performance líquida em tempo real e calcular automaticamente comissões escalonadas (remuneração variável direta e indireta), eliminando a dependência de planilhas manuais para esse fluxo. Sucesso = a empresa cliente consegue planejar metas, acompanhar o realizado e liberar/consultar recebíveis com transparência total sobre o motivo exato de qualquer bloqueio ou gatilho não atingido.

## Positioning

O domínio de possibilidades na construção de Metas e Bases de Recebíveis — combinado com um Acompanhamento claro e simples de Resultados — é o que permite a um gestor enxergar com clareza o que cada operador comercial tem a receber. Nenhuma planilha ou concorrente genérico de comissões replica esse nível de configurabilidade nas regras de meta/recebível junto com a leitura em tempo real do resultado líquido.

## Operating Context

Esteira lógica contínua entre 10 macroambientes (ver SPECIFICATION.md para o detalhamento completo de cada um):

Estrutura Organizacional + Cargos → Resultados (entradas diárias brutas + deságios) → Bases para Metas (motor de sazonalidade) → Metas (planejamento estático, Motor de Agrupamento, Recálculo de Rota) → Acompanhamento Meta x Resultados (performance líquida e projeções em tempo real) → Bases de Recebíveis (gatilhos condicionais e regras de remuneração) → Fechamento (congela o período em snapshot imutável) → Recebíveis (consulta e transparência dos ganhos).

Hierarquia organizacional estrita Top-Down: Empresa → Canal → Departamento → Time → Membro. Um Membro histórico nunca é movido de Time diretamente — é inativado e um novo registro é criado, preservando o histórico retroativo de Metas/Resultados/Recebíveis.

## Capabilities and Constraints

- **Multi-tenancy obrigatório:** toda tabela (exceto Empresa) carrega `companyId`; toda query Prisma filtra por ele a partir do JWT, nunca do body da requisição.
- **Precisão financeira extrema:** nunca float/double puro para metas, comissões ou faturamento — `decimal.js` ou centavos inteiros.
- **RBAC estrito por Tenant:** Admin da Empresa / Gerente-Coordenador / Vendedor, sem sobreposição de escopo.
- **Imutabilidade pós-Fechamento:** uma vez que o Gestor Administrador fecha um mês comercial, o snapshot de custos é congelado e trava novas escritas retroativas.
- **Terminologia do domínio a preservar:** Realizado, Meta, Deságio (Operacional/Escalonado), Gatilho Condicional/Rígido, Recálculo de Rota, Ganho Atual/Projetado/Liberado, Bases de Recebíveis.
- **Tipos de Resultado são estritamente quantitativos**, com unidade `Moeda (R$)` ou `Numeral Puro` — todo valor exibido deve refletir essa unidade.

## Brand Commitments

- Nome comercial: **GMC** — "Gestão de Metas e Comissões".
- Identidade visual segue o site institucional [rossinvendas.com](https://www.rossinvendas.com/) — referência vinculante ainda não extraída em tokens/paleta (fica para `$impeccable document` ou `new-work` decidir como aplicar ao produto).

## Evidence on Hand

Nenhum dado real de cliente, testemunho, case ou benchmark foi fornecido até o momento — trabalho futuro não deve fabricar nenhum desses. A evidência de produto disponível é a especificação funcional completa em `SPECIFICATION.md` (mesma pasta) e o histórico de decisões em `_local/plano/PLANO-MESTRE.md`.

## Product Principles

1. Precisão financeira antes de conveniência — decimal.js/centavos sempre, sem exceção, mesmo sob pressão de prazo.
2. Isolamento de dados por Tenant é inegociável — qualquer vazamento entre empresas é falha crítica, não bug menor.
3. Transparência total sobre bloqueios: o usuário sempre vê o motivo exato pelo qual uma meta ou recebível não foi liberado.
4. A hierarquia de acesso reflete a hierarquia organizacional real — Vendedor nunca vê além do individual, Gestor nunca vê além do seu nó.
5. Dados fechados são imutáveis — Fechamento é um compromisso contábil, não um estado reversível casualmente.

## Accessibility & Inclusion

Nenhum requisito específico de acessibilidade foi estabelecido pelo usuário até o momento.
