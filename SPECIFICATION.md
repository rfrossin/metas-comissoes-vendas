## O sistema:

O sistema é uma plataforma **Web SaaS (Software as a Service) Multi-Tenant**, projetada para estruturação de metas, acompanhamento de performance líquida e cálculo automatizado de comissões comerciais escalonadas (remuneração variável direta e indireta).

Cada empresa cliente opera em um ambiente lógico isolado (**Tenant**). O criador da conta corporativa assume o papel inicial de Administrador e possui a capacidade de convidar colaboradores via e-mail para comporem o organograma.

#### O Fluxo Central de Dados do Sistema

Para orientar o desenvolvimento do banco de dados e das APIs, os programadores devem compreender que o sistema opera em uma esteira lógica contínua:

A **Estrutura Organizacional** e os **Cargos** definem as entidades e seus salários fixos → O módulo de **Resultados** recebe as entradas diárias brutas e os deságios operacionais → O motor de **Bases para Metas** analisa o histórico para gerar inteligência de sazonalidade → O módulo de **Metas** consolida o planejamento de forma estática → O **Acompanhamento** plota a performance líquida e as projeções futuras em tempo real →  As **Bases de Recebíveis** aplicam travas condicionais e gatilhos rígidos sobre o realizado → O **Fechamento** congela o período comercial em um snapshot imutável → O módulo de **Recebíveis** disponibiliza a consulta e transparência dos ganhos liberados e projetados.

### Mapeamento dos 10 Macroambientes

#### 1. Estrutura Organizacional

Gerencia a árvore hierárquica comercial da empresa em modelo estrito *Top-Down*: **Empresa → Canais → Departamentos → Times → Membros**. Controla os vínculos opcionais de contas de acesso e a atribuição de múltiplos Responsáveis (líderes) em nós intermediários para fins de comissão indireta.

#### 2. Resultados

Repositório central de entradas quantitativas do sistema (via tela, planilha ou API). Armazena dados sempre a nível de dia e associados a membros específicos. Centraliza o lançamento de **Deságios Operacionais** (ajustes/estornos) para o cálculo do Realizado Líquido.

#### 3. Bases para Metas

Motor matemático que consome os dados históricos de resultados para extrair percentuais de **Sazonalidade** em múltiplos níveis de tempo (dias da semana, dias do mês, meses do ano). Guarda os templates de cálculo que auxiliam na distribuição automática de metas comerciais.

#### 4. Metas

Interface de criação, edição e distribuição de objetivos comerciais por ano fiscal. Suporta motores de crescimento progressivo (mensal/trimestral), valor alvo anual e inserção manual. Gerencia o mecanismo de **Deságio Escalonado** entre abas organizacionais e a rotina de recálculo de rota.

#### 5. Acompanhamento Meta x Resultados

Painel analítico (Dashboards) com visões isoladas para Vendedores (operacional) e Gestores (liderança de nó). Exibe gráficos de atingimento com marcação visual de gatilhos conquistados, matrizes multimeta 360º e o gráfico preditivo de **Recálculo Dinâmico de Rota**.

#### 6. Cargos

Matriz de cargos da empresa que unifica os salários fixos padrão e os papéis padrão de acesso ao sistema (RBAC). Permite a customização de salários fixos a nível individual no perfil do membro para servir de base ao motor de comissões.

#### 7. Bases de Recebíveis

O motor de regras financeiras da empresa. Permite criar campanhas de remuneração variável (% sobre o fixo, % sobre vendas com base de cálculo dinâmica, prêmios em dinheiro ou físicos). Controla o comportamento de gatilhos rígidos em degrau (modo faixa ou cumulativo), Os gatilhos de faixas de atingimento das metas e a esteira de **Gatilhos Condicionais** de elegibilidade. Na Base de recebíveis que conectamos as metas e seus resultados com a remuneração de todos os membros, seja com base em metas de hierarquias ou individuais.

#### 8. Recebíveis

Tela de consulta financeira em tempo real que exibe os estados de **Ganho Atual** (garantido no mês), **Ganho Projetado** (tendência de entrega) e **Ganho Liberado** (períodos congelados). Garante transparência total exibindo o motivo exato de bloqueios por quebra de metas condicionais.

#### 9. Fechamento

Painel de controle exclusivo do Gestor Administrador para gerenciar o status dos meses comerciais (Aberto vs. Fechado). É o gatilho que executa o processamento final da folha, gera o snapshot estático e imutável de custos e ativa as travas de segurança de escrita no banco de dados.

#### 10. Níveis de Permissão

Camada de segurança da plataforma. Controla o isolamento lógico de dados entre empresas (Multi-Tenancy via `company_id`) e gerencia os níveis de acesso internos baseados em escopo (Operacional, Liderança de Nó e Administrador) e externos (Super Admin da Plataforma e Suporte).

---

## Estrutura Organizacional

#### 1. Arquitetura da Árvore Hierárquica (Modelo de Dados)

O sistema deve implementar uma estrutura estrita de árvore *Top-Down* para mapear o organograma comercial da empresa, respeitando os seguintes níveis de isolamento e relacionamentos no banco de dados:

- **Nível 1 - Empresa (Raiz):** Representa o *Tenant* global. É a somatória absoluta de todos os canais.
- **Nível 2 - Canal:** Pertence à Empresa. Um Canal abriga 1 ou mais Departamentos.
- **Nível 3 - Departamento:** Pertence a um Canal específico. Um Departamento abriga 1 ou mais Times.
- **Nível 4 - Time:** Pertence a um Departamento específico. Um Time abriga 1 ou mais Membros.
- **Nível 5 - Membro (Folha):** A menor unidade operacional. Está alocado obrigatoriamente dentro de um único Time (e herda por cascata o seu Departamento e Canal).

#### 2. Atribuição Dinâmica de Responsáveis (Liderança Comercial)

Para fins de **Permissionamento** de telas e cálculo de **Comissões Indiretas**, o sistema deve permitir a vinculação de Líderes (Responsáveis) em qualquer nó intermediário da árvore:

- **Regra de Vinculação:** Cada Time, Departamento ou Canal pode possuir **1 ou mais Membros Responsáveis**.
- **Origem do Dado:** O sistema deve permitir selecionar qualquer Membro cadastrado na empresa para exercer o papel de responsável por um nó (ex: o Membro "Fulano", que é coordenador, é marcado como Responsável pelo *Time A*).
- **Impacto no Motor de Recebíveis:** Quando uma campanha de recebíveis for criada para o nível de apuração "Time", o sistema usará essa tabela de vínculo para identificar quais líderes são elegíveis para receber a bonificação indireta baseada na soma das vendas daquele time.

#### 3. Cadastro do Membro e Vínculo de Conta (Autenticação)

O cadastro de um Membro separa a entidade comercial (quem vende e bate meta) da conta de acesso web (quem faz login).

- **Campos Obrigatórios do Membro:** Nome Completo, ID do Time, Status `[Ativo, Inativo]`.
- **Vínculo Opcional de Conta (User Account):** A interface deve exibir um campo para associar opcionalmente aquele Membro a um usuário de login do sistema.
    - *Cenário A (Sem Vínculo):* O gestor pode cadastrar o vendedor apenas para imputar suas vendas manualmente e acompanhar suas metas, sem que o vendedor tenha um e-mail/senha para acessar o sistema.
    - *Cenário B (Com Vínculo):* Ao associar uma conta de e-mail ao Membro, o sistema ativa as regras do módulo de Permissionamento (Visão Vendedor), permitindo que ele logue e veja seus próprios dados.

#### 4. Regra de Ouro: Mutação de Estrutura e Preservação de Histórico

Para evitar a corrupção de relatórios retroativos de Metas, Resultados e Recebíveis, os programadores devem bloquear a edição direta do local de um membro se ele já possuir dados históricos armazenados no banco de dados.

- **Bloqueio de Movimentação:** Um Membro **não pode** ter seu campo "Time" alterado de *Time A* para *Time B* diretamente.
- **Fluxo Obrigatório de Transferência:**
    1. O gestor altera o status do Membro atual para `Inativo` no *Time A*. O sistema grava internamente a data da inativação. Esse ID de membro é congelado. Suas metas e resultados passados continuam compondo o histórico do *Time A*.
    2. O gestor cria um **novo registro de Membro** para o colaborador, selecionando o *Time B*. Este novo registro ganha um novo ID único no banco de dados e iniciará seu histórico de metas e resultados do zero dentro do novo time.

#### 5. Estados de Ativação (Ciclo de Vida)

- **Membro Ativo:** Participa ativamente das telas de acompanhamento do período corrente, pode receber novos inputs de resultados e ser incluído em novas campanhas de metas.
    - **Membro Inativo:** Não aparece nos filtros de seleção de novas metas ou novas campanhas de recebíveis. Seus dados antigos são preservados estritamente para consultas de meses e anos passados nos painéis de Gestão (histórico contábil e de performance).

---

## RESULTADOS

#### 1. Tabela Base: Tipos de Resultados (Dicionário de Indicadores)

O sistema deve possuir uma tabela global de cadastro de tipos de indicadores. Todos os registros inseridos devem ser **estritamente quantitativos**.

- **Campos do Tipo:** ID, Nome do Indicador, Unidade de Medida `[Moeda (R$), Numeral Puro]`.
- *Exemplos de Dicionário:*
    - "Valor Vendido" -> Unidade: Moeda (R$)
    - "Número de Vendas" -> Unidade: Numeral Puro
    - "Número de LEADS" -> Unidade: Numeral Puro

#### 2. Modelagem da Base de Dados de Resultados Regulares

Cada linha de resultado inserida no banco de dados deve respeitar rigidamente a seguinte estrutura:

- **`member_id` (Responsável):** Chave estrangeira que vincula o resultado ao Membro executor. (Obrigatório).
- **`date` (Data do Evento):** Formato `DIA/MÊS/ANO`. O sistema armazena sempre a nível de **DIA**.
    - *Regra de Flexibilidade:* Se o usuário lançar o consolidado do mês no dia 31/03/2026, o sistema processará como um dado do dia 31, mas o motor de somatórias o computará normalmente no agrupamento do Mês de Março e do 1º Trimestre de 2026.
- **`type_id` (Tipo de Resultado):** Chave estrangeira ligada à tabela de Tipos.
- **`value` (Resultado):** Numeral `float` (deve aceitar decimais para valores monetários).

#### 3. Canais de Ingestão de Dados e Inteligência de Importação (*De-Para*)

O sistema deve aceitar dados por três vias: Input Manual (linha por linha em tela), Upload de Planilha (CSV/Excel) e Webhook/API Externa.

**Lógica do Mecanismo "De-Para" de Tipos na Importação:**

Ao receber dados via Planilha ou API, o backend deve validar se a string enviada na coluna de "Tipo" corresponde exatamente a um Nome cadastrado na tabela de Tipos.

1. Se o sistema encontrar um nome divergente (Ex: Planilha contém "FAT PROD" e o sistema possui apenas "Valor Faturado"):
2. O sistema deve **pausar o processamento da importação** e abrir uma tela de conciliação para o usuário.
3. O usuário terá duas opções na tela:
    - *Mapear (De-Para):* Associar "FAT PROD" ao indicador existente "Valor Faturado". O sistema salva essa regra para que as próximas importações com o termo "FAT PROD" sejam convertidas automaticamente.
    - *Criar Novo:* Cadastrar "FAT PROD" como um novo indicador quantitativo no sistema.

**Modos de Gravação no Banco de Dados:**

Antes de processar a carga, o usuário ou o parâmetro da API deve selecionar o comportamento de gravação:

- **Modo ADICIONAR (Append):** O sistema apenas insere as novas linhas no banco de dados de forma cumulativa, ignorando se já existem dados para aquele membro naquela data.
- **Modo SUBSTITUIR BASE (Overwrite Escopado):** O sistema deleta todas as linhas de resultados regulares existentes **que correspondam estritamente ao escopo da importação** (Mesmo Período de Data filtrado, Mesmos Membros e Mesmo Tipo de Resultado) antes de gravar as novas linhas. Isso evita duplicidade de dados em caso de reenvio de relatórios.

#### 4. Módulo de Deságios e Ajustes Operacionais

Funcionalidade manual e auditável exclusiva para gestores autorizados lançarem retificações líquidas (ex: estornos ocorridos após o fechamento do mês original).

- **Estrutura de Dados do Deságio:** `member_id` | `type_id` | `value` (aceita negativos, ex: `5000.00`) | `date_reference` (DD/MM/YYYY) | `reason` (Texto).

#### 5. Motor de Cálculo do Realizado Líquido (Lógica Backend)

Sempre que qualquer tela ou módulo (Dashboards, Metas ou Recebíveis) requisitar o desempenho de um participante em um período $t$, o backend executa a query agregadora:

$$
\text{Realizado Líquido}_t = \sum(\text{Resultados Regulares}_t) + \sum(\text{Deságios}_t)
$$

**Diretrizes de Execução do Motor:**

- **Isolamento Rígido de Período:** O deságio lançado na data 10/02/2026 reduz apenas o realizado líquido de Fevereiro de 2026. O mês anterior (Janeiro), onde a venda original de fato aconteceu, permanece imutável e com o histórico travado.
- **Impacto em Cascata:** Como a base é o DIA, a inserção de um deságio ou resultado regular em uma data recalcula instantaneamente a somatória lógica do Dia $\rightarrow$ Semana $\rightarrow$ Mês $\rightarrow$ Trimestre $\rightarrow$ Ano.
- **Resultado Negativo:** Se o somatório de deságios superar as vendas reais do período consultado, o retorno da função matemática deve ser um valor negativo (ex: `2.500`), sem travar em zero. Os módulos consumidores (Recebíveis) lerão o valor negativo e aplicarão suas travas automáticas (payout zero).

#### 6. Regras de Negócio

#### 1. Estados do Período Comercial

O sistema deve monitorar o estado de cada período cronológico (tipicamente o Mês/Ano) através de duas flags de status:

- **`Aberto`:** Permite inserção, edição, exclusão e importações automáticas (via planilha ou API) de novos resultados ou deságios.
- **`Fechado`:** Bloqueia qualquer alteração na base de dados para garantir que os valores validados pelo financeiro não sejam adulterados.

#### 2. Lógica de Validação no Backend (API Guard)

Sempre que o sistema receber uma tentativa de escrita na tabela de Resultados (seja por Input Manual, Importação de Planilha por Substituição/Adição ou via Webhook/API Externa), o backend deve rodar a seguinte validação antes de executar qualquer comando no banco:

```
SE (Data_do_Resultado_Enviado pertence a um Período onde Status == 'Fechado') {
    Recusar_Operação();
    Retornar_Erro("Operação não permitida. O período correspondente a esta data está FECHADO e validado. Para alterar os dados, reverta o status do fechamento para Aberto no módulo de Recebíveis.");
} SENÃO {
    Executar_Gravação_Normal();
}
```

#### 3. Fluxo de Desbloqueio pelo Gestor (Rollback)

Para modificar dados históricos de um período fechado, o gestor Administrador deve seguir obrigatoriamente o fluxo:

1. Acessar a tela de **Fechamento / Recebíveis**.
2. Localizar o período desejado e alterar manualmente o status de `Fechado` para `Aberto` (o sistema deve registrar um log de auditoria de quem realizou essa reabertura).
3. Retornar ao módulo de **Resultados** e realizar a correção, inserção ou substituição necessária.
4. Retornar à tela de **Fechamento** para recalcular e fechar o período novamente, gerando a nova folha de recebíveis corrigida.


---

## BASES PARA METAS

#### 1. O Motor de Sazonalidade (Geração de Ativos)

A sazonalidade é um ativo matemático reutilizável armazenado no sistema. Ela decompõe uma meta macro em frações micro com base no peso real de dados históricos capturados do módulo de **Resultados**.

**Parâmetros de Entrada para Cálculo:**

- **Tipo de Resultado:** Filtro baseado na tabela de Indicadores (ex: Faturamento, Vendas).
- **Período de Análise Histórica:** Data Inicial e Data Final.
- **Filtro de Escopo Orgânico:** `[Geral (Empresa), Canal, Departamento, Time, Membro]`. O sistema realiza o somatório de todos os resultados correspondentes a este escopo dentro do período selecionado.
- **Opção Sazonalidade Manual:** Um checkbox que, se ativado, desativa a busca histórica e abre uma grade vazia para o usuário digitar diretamente os percentuais. O sistema valida se a soma total dos campos atinge exatamente **100%**.

**Fórmula de Cálculo da Sazonalidade:**

O sistema deve calcular a fração de peso de cada unidade de tempo *t* dentro do ciclo macro analisado utilizando a seguinte equação:

$$
\text{Saz}_t = \frac{\text{Resultado Histórico do Período}_t}{\text{Resultado Histórico Total do Período}}
$$

#### 2. Matriz de Tipos de Análise e Regras de Distribuição

O programador deve implementar as regras de comportamento do rateio diário/mensal baseado no **Tipo de Análise** salvo na base:

- **Dias da Semana:** Calcula o peso relativo de Segunda a Domingo. *Regra:* Nos meses gerados por esta sazonalidade, todos os meses terão o mesmo peso financeiro total, mas a distribuição interna dos dias seguirá o peso de cada dia da semana.
- **Dias do Ano:** Calcula o peso individual de cada um dos 365 dias. *Regra:* Gera automaticamente o peso proporcional exato de cada mês e trimestre com base no peso dos dias neles contidos.
- **Dias do Mês:** Calcula o peso do Dia 1 ao Dia 31 com base na média histórica dos meses do período.
- **Meses do Ano (Apenas com Anos Fechados):** Calcula o peso de cada mês em relação ao ano. *Regra:* Os dias da semana dentro de cada mês receberão pesos iguais por divisão simples.
- **Meses do Ano e Dias da Semana (Combinada):** O sistema calcula o percentual de peso de cada mês no ano e, em seguida, aplica o peso histórico de cada dia da semana para fracionar a meta daquele mês específico.
    - *Cálculo:*
    
    $$
    \text{Meta do Dia} = \text{Meta do Mês} \times \text{Sazonalidade do Dia da Semana do Mês}
    $$
    
- **Meses do Ano e Dias do Mês:** Define o peso do mês no ano e distribui o valor interno do mês seguindo o peso histórico de cada dia (Dia 1 ao 31).
- **Trimestres do Ano:** Divide o peso pelos 4 trimestres. *Regra:* Todos os meses dentro de um mesmo trimestre receberão exatamente o mesmo valor de meta, e os dias serão divididos igualmente.

**Interface de Salvamento e Pré-visualização:**

Antes de clicar no botão de salvamento (que funciona de forma **individual por linha de registro**), a interface deve renderizar quatro gráficos de linha simultâneos para conferência do gestor: **Gráfico Semanal, Diário do Ano, Mensal e Trimestral**.

#### 3. Motores de Distribuição de Metas (Tipos de Metas)

Ao aplicar uma Base de Sazonalidade na construção de uma meta, o sistema processará os valores seguindo quatro regras de motores excludentes:

- **Crescimento Progressivo Mensal:**
    - *Inputs:* Valor Inicial (Mês 0) e Taxa de Crescimento Mensal (*i%*).
    - *Lógica:*
    
    $$
    \text{Meta}_{M\hat{e}s_n} = \text{Meta}_{M\hat{e}s_{n-1}} \times (1 + i)
    $$
    
    - *Regra de Sazonalidade:* Ignora sazonalidades de Meses ou Trimestres. Permite aplicar **apenas** Sazonalidade Diária Semanal ou Diária Mensal para fracionar o valor final de cada mês nos seus respectivos dias.
    - *Precisão:* O banco de dados deve salvar o float com precisão total, mas a interface mascara a exibição truncando em duas casas decimais.
- **Crescimento Progressivo Trimestral:**
    - *Inputs:* Valor Inicial (Trimestre 0) e Taxa de Crescimento Trimestral (*i%*)
    - *Lógica:*
    
    $$
    \text{Meta}_{Tri_n} = \text{Meta}_{Tri_{n-1}} \times (1 + i)
    $$
    
    - O valor obtido no trimestre é dividido igualmente (1/3) para cada um de seus três meses.
    - *Regra de Sazonalidade:* Ignora sazonalidade mensal. Aplica Sazonalidade Diária Semanal ou Diária Mensal para o rateio dos dias.
- **Valor Alvo Anual:**
    - *Inputs:* Valor Base Inicial do Ano e % de Crescimento Desejado.
    - *Lógica:* Calcula a Meta Anual Total. Em seguida, utiliza a árvore de Sazonalidade Aplicada para realizar o rateio de cima para baixo (Top-Down), preenchendo trimestres, meses e dias de acordo com os percentuais salvos na base.
- **Meta Manual:**
    - *Inputs:* Digitação direta dos valores mensais na tabela.
    - *Regra de Sazonalidade:* Desliga os motores mensais/trimestrais, mantendo opcional o uso de sazonalidade diária (semanal ou mensal) para quebrar o valor do mês digitado dentro dos seus dias.

#### 4. Lógica de Execução do Recálculo de Rota

A função de recálculo reescreve as projeções futuras a partir de um mês X escolhido, limpando o planejamento original dali em diante.

- **No Modelo Progressivo (Mensal/Trimestral):** O motor de cálculo vai até o módulo de **Resultados**, busca o *Realizado Líquido* real consolidado do mês X e passa a aplicar a taxa de crescimento acumulativa original sobre este dado real, corrigindo o erro acumulado dos meses anteriores.
- **No Modelo Alvo Anual:** O sistema apresenta o Alvo Final do Ano original (permitindo edição). O motor calcula o saldo devedor necessário para atingir o objetivo:

$$
\text{Saldo Restante} = \text{Alvo Final Anual} - \sum(\text{Realizado Líquido até o Mês } X)
$$

O sistema limpa as metas dos meses de *X+1* até o fim do período e redistribui este **Saldo Restante** proporcionalmente, respeitando os pesos da sazonalidade original configurada para os meses restantes.

---

## METAS

#### 1. Ciclo de Vida e Gerenciamento (Tela de Listagem)

O ambiente principal de Metas deve agrupar os registros por **Ano Fiscal**. Ao acessar um ano específico, o sistema apresenta a listagem de campanhas de metas com as seguintes propriedades:

- **Filtros de Estado:** `[Ativas, Inativas, Encerradas]`.
    - *Ativas:* Disponíveis para lançamentos de resultados e cálculo de comissões.
    - *Inativas:* Pausadas (não aparecem nos dashboards).
    - *Encerradas:* Histórico congelado (bloqueado para edição).
- **Ações de Linha:** `[Editar, Ativar/Desativar, Excluir, Recalcular, Duplicar]`.
    - *Regra de Exclusão:* Bloquear caso o período já possua fechamentos financeiros consolidados no módulo de Recebíveis.

#### 2. Configurações Iniciais da Meta (Modal / Tela de Criação)

Ao criar ou editar uma meta, o usuário define os parâmetros macro obrigatórios:

- **Tipo de Resultado (Indicador):** Consome a tabela global de tipos (ex: Valor Vendido, Nº de Vendas, Faturamento SKU X).
- **Gatilhos de Meta (Percentuais Rígidos):** Permite a inserção dinâmica de marcadores de atingimento (ex: Gatilho 1 = 80%, Gatilho 2 = 100%, Gatilho 3 = 115%, Gatilho 4 = 130%).
    - *Validação:* Devem ser informados em ordem crescente. Caso haja apenas um gatilho, preenche-se 100% no primeiro
    - *Vinculação:* Cada gatilho injeta uma flag de cor no banco de dados para os dashboards e serve como a chave de validação (`Trigger Key`) para o módulo de *Bases de Recebíveis*.
- **Nível Base da Meta:** Selector único `[Membro, Time, Departamento, Canal, Empresa]`. Define a menor unidade de cálculo desta campanha.
- **Entidades Alvo (Escopo):** Componente de seleção múltipla (com filtros por Canal, Departamento e Time) ou o botão "Selecionar Toda a Empresa". O sistema filtra os registros com base no *Nível Base* escolhido.

#### 3. Regra de Cascateamento Dinâmico de Abas

A interface de configuração de valores abaixo dos filtros iniciais adapta-se dinamicamente baseada no **Nível Base da Meta** selecionado, ocultando níveis inferiores para evitar erros de consistência de dados:

- Se Nível Base = **Membro**: Abas `[Membros]`, `[Times]`, `[Departamentos]`, `[Canais]`, `[Empresa]` ficam visíveis.
- Se Nível Base = **Time**: Abas de níveis superiores `[Times]`, `[Departamentos]`, `[Canais]`, `[Empresa]` ficam visíveis. Aba *Membros* é ocultada.
- Se Nível Base = **Departamento**: Abas `[Departamentos]`, `[Canais]`, `[Empresa]` ficam visíveis.
- Se Nível Base = **Canal**: Abas `[Canais]`, `[Empresa]` ficam visíveis.
- Se Nível Base = **Empresa**: Apenas a aba `[Empresa]` fica visível.

*Nota de Composição:* As abas superiores exibem automaticamente apenas as estruturas organizacionais (Times, Departamentos, Canais) que possuam entidades ou membros selecionados no escopo da meta.

#### 4. Mecanismo de Configuração por Linha (Aba Base)

Na aba correspondente ao Nível Base selecionado (ex: Aba Membros), o sistema renderiza uma tabela em que cada linha representa uma entidade do escopo. O usuário deve configurar os seguintes campos por linha:

- **Sazonalidade Aplicada:** Dropdown contendo as tabelas de sazonalidade salvas no módulo *Bases para Metas*.
- **Tipo de Motor de Cálculo:** Selector único:
    1. *Crescimento Progressivo Mensal:* Usuário define o Valor Inicial (Mês 0) e o % de crescimento mensal acumulativo. Desconsidera sazonalidade mensal/trimestral; aplica apenas sazonalidade diária/semanal.
    2. *Crescimento Progressivo Trimestral:* Usuário define o Valor Inicial (Tri 0) e o % de crescimento trimestral acumulativo. O valor do trimestre é dividido igualmente entre seus três meses.
    3. *Valor Alvo Anual:* Usuário define o Valor Base Inicial e o % de crescimento desejado sobre o total do ano. O sistema calcula a Meta Anual Absoluta e a distribui nos meses/dias seguindo estritamente a Sazonalidade Aplicada.
    4. *Meta Manual:* Permite a digitação direta de valores mês a mês.
- **Edição Manual e Quebra de Padrão:** O sistema renderiza a distribuição mensal e trimestral resultante da fórmula. Se o usuário clicar em um mês e alterar o valor digitando diretamente na célula, o *Tipo de Motor de Cálculo* daquela linha muda automaticamente para **Manual**, preservando os valores gerados nas outras células, mas desligando a automação de fórmulas.
- **Ação de Linha - Aplicar / Validar:** Botão individual por linha. O usuário deve clicar em "Aplicar" para processar a distribuição diária em segundo plano no banco de dados e salvar as alterações daquela entidade.

#### 5. Motor de Deságio Escalonado (Abas Superiores)

Nas abas de níveis hierárquicos superiores (Times, Departamentos, Canais, Empresa), as tabelas funcionam de forma agregadora (Bottom-Up), exibindo a soma matemática exata do nível inferior. Contudo, o gestor pode aplicar um **Deságio Escalonado (%) por Aba** para criar margens de segurança na liderança.

**Lógica Matemática do Deságio:**

O deságio inserido em uma aba incide diretamente sobre a somatória acumulada do nível imediatamente anterior.

- **Aba Times:** `Meta do Time = (Soma das Metas dos Membros do Time) * (1 - Deságio do Time)`
- **Aba Departamentos:** `Meta do Departamento = (Soma das Metas dos seus Times com deságio aplicado) * (1 - Deságio do Departamento)`
- **Aba Canais:** `Meta do Canal = (Soma das Metas dos seus Departamentos com deságio aplicado) * (1 - Deságio do Canal)`

*Armazenamento de Dados:* O sistema deve salvar no banco tanto o valor **Bruto** (soma real das bases) quanto o valor **Líquido** (pós-deságio). É o valor Líquido de cada nível que será enviado para os Dashboards de Gestão e para as campanhas de Recebíveis atreladas a líderes.

#### 6. Lógica do Motor de Recálculo de Rota

Ao clicar na ação "Recalcular Meta", o sistema abre um prompt solicitando o **Mês de Corte ($X$)**. O comportamento do motor varia pelo tipo original da meta:

- **Para Crescimento Progressivo (Mensal/Trimestral):** O sistema varre o banco, captura o *Realizado Líquido real* do mês $X$ daquela entidade e reaplica a taxa de crescimento percentual original sobre este dado real para projetar os meses $X+1, X+2...$ em diante.
- **Para Valor Alvo Anual:** O sistema solicita o novo valor final desejado para o ano (ou mantém o original). O cálculo limpa o planejamento do resto do ano e faz o rateio do saldo devedor (`Alvo Anual - Realizado Líquido Acumulado até o Mês X`) entre os meses restantes, mantendo a proporção da sazonalidade original.

#### 7. REGRA DE PERSISTÊNCIA DE DADOS (PARA OS PROGRAMADORES)

- **Ação "Aplicar/Salvar Meta":** O motor de cálculo de sazonalidade e crescimento progressivo opera estritamente na camada de *frontend* ou em memória no *backend* durante a edição.
- **Persistência Rígida:** No momento em que o gestor salva ou atualiza a meta, o sistema deve converter as porcentagens e projeções em valores nominais absolutos e gravá-los diretamente nas colunas correspondentes (por dia, mês e trimestre) na tabela de metas.
- **Sem Chave Estrangeira Viva:** O registro final da meta **não** deve depender de um relacionamento (`Foreign Key`) dinâmico com a tabela de bases de sazonalidade para renderizar seus valores. A base de sazonalidade serve apenas como um assistente de preenchimento.

---

## BASES DE RECEBÍVEL

#### 1. Configuração Inicial e Escopo da Campanha

Ao criar ou editar uma Base de Recebível, o gestor parametriza o alcance através do seguinte fluxo:

A primeira seleção deve ser o **TIPO DE RECEBÌVEL**, pois ele definira a própria TELA de configuração deste recebível que o usuário ira utilizar.
Os tipo 1 de recebíveis são: **Baseado em META**, **Baseado em Resultado**
Os tipo 2 de recebíveis são: **% por Faixa**, **Valor por Faixa**, **% do Fixo por Faixa**, **% do Fixo por Faixa**, **Recompensa por Faixa**



Na tela do Recebível, ele deverá selecionar a **ENTIDADE** que tera o resultado ou meta analisada.

O próximo é o **Período de Vigência**, com data inicial e data final, sendo que ele pode selecionar a opção de **FINAL ABERTO**. Se essa opção for selecionada, o recebível será válido até o momento que o usuário criar uma nova regra ou até que o recebível seja inativado.

Depois da Entidade, mostra o indicador de análise (Se for Resultado, mostra os **TIPOS DE RESULTADO** cadastrados no sistema, se for meta mostra as **Linhas de Metas** desta entidade)

- **Beneficiários (Quem recebe):** Seleção múltipla de Membros (executores ou Responsáveis/Líderes do nó organizacional analisado).
- **Periodicidade de Fechamento:** Selector único `[Diário, Semanal, Mensal, Trimestral, Anual]`. Determina a janela cronológica em que o Realizado Líquido e a Meta serão consolidados para o cálculo.

#### 2. Esteira de Validação: Gatilhos Condicionais (Travas de Elegibilidade)

Antes de avaliar o desempenho da Meta Principal, o motor de cálculo deve obrigatoriamente validar as condições de contorno. Esta seção é opcional no cadastro, mas altamente prioritária no código.

O gestor pode adicionar 1 ou mais **Condições de Ativação**. Cada condição exige:

- **Nível de Verificação da Condição:** Selector único `[Do Próprio Membro, Do Time do Membro, Do Departamento, Do Canal, Da Empresa]`.
- **Meta Condicional:** Dropdown que lista as outras metas ativas do ano.
- **Atingimento Mínimo (%):** Campo numérico indicando o percentual mínimo que a entidade selecionada deve bater na Meta Condicional para liberar este recebível.

**Lógica de Código (O Filtro de Entrada):**

```
PARA CADA Beneficiário DA Campanha {
    PARA CADA Condição EM GatilhosCondicionais {
        AtingimentoReal = (Condição.MetaCondicional.RealizadoLíquido / Condição.MetaCondicional.ValorMeta) * 100;

        SE (AtingimentoReal < Condição.AtingimentoMínimo) {
            Beneficiário.StatusElegibilidade = FALSO;
            Beneficiário.PayoutFinal = 0;
            INTERROMPER_E_AVANÇAR_PARA_PRÓXIMO_BENEFICIÁRIO;
        }
    }
    Beneficiário.StatusElegibilidade = VERDADEIRO;
}
```

*Se qualquer condição falhar, o recebível daquele membro específico é travado em zero para o período, ignorando completamente o quão excelente tenha sido o resultado dele na Meta Principal.*

#### 3. Regra de Comportamento dos Gatilhos Principais (Degrau Rígido)

Passada a esteira de condições, o sistema avalia a Meta Principal. O motor trata os gatilhos percentuais como uma função de escada progressiva:

- O participante fica retido nas regras do gatilho conquistado até que o seu percentual de atingimento alcance ou supere **100% do valor do próximo gatilho**.
- **Volume Real:** Se o participante atingir 95% da meta (onde o Gatilho 1 é 80% e o Gatilho 2 é 100%), o sistema aplica a taxa do Gatilho 1 sobre **todo o volume do resultado real acumulado** (os 95% entregues), e não sobre o piso de 80%.

#### 4. Tipos de Recebíveis e Base de Cálculo Dinâmica

O sistema separa o indicador de **Atingimento da Meta Principal** do indicador que serve de **Base para a Recompensa**. Cada gatilho aceita:

- **% sobre o Fixo:** Aplica o percentual sobre o salário base do membro (usando a regra de fallback do módulo de *Cargos*).
- **% sobre o Resultado (Comissão de Vendas):** O gestor seleciona qual **Tipo de Resultado** será a base de cálculo financeira (ex: Meta Principal em *Nº de Clientes Novos*, mas a comissão é de 1,5% sobre o *Valor Vendido em R$*).
- **Valor Específico (R$):** Um prêmio fixo em dinheiro nominal.
- **Premiação Física / Voucher (Texto):** Campo descritivo para prêmios físicos (ex: "Vale Presente").

#### 5. Motor de Cálculo: Faixa vs. Cumulativo

O processamento da árvore de gatilhos conquistados pelo participante elegível segue duas lógicas excludentes:

- **Modo FAIXA (Subescrita):** O sistema identifica o maior gatilho atingido, calcula o seu prêmio isoladamente e encerra a execução.
- **Modo CUMULATIVO (Empilhamento):** O sistema executa um laço (`loop`) por todos os gatilhos superados, **soma as taxas percentuais de cada degrau** (se for % sobre Resultado) ou **soma os valores nominais** (se for valor fixo) ou **soma os prêmios** (se for recompensa), e aplica o resultado final sobre a base correspondente.

#### 6. Ciclo de Vida, Vigência e Segurança

- **Vigência:** Herda o período da meta vinculada ou restringe a um intervalo customizado (Data Inicial e Final), validando em tela para impedir que as datas extrapolem os limites da meta macro. Se for por RESULTADO, ele pode definir como vigência aberta a partir de uma data inicial. Se for por META, ele deve herdar o período da meta principal.
- **Status:** `Ativo`, `Desativado` e `Encerrado`.
- **Ações:** `Excluir` (bloqueado se houver períodos fechados) e `Duplicar com Substituição` (clona toda a estrutura, incluindo a árvore de gatilhos principais e condicionais, permitindo edição completa de todos os campos antes de salvar).

#### 7. Mecanismo de Simulação (Memória / Tempo Real)

- **Painel do Gestor / Vendedor:** O simulador agora ganha novas colunas dinâmicas de input para os **Gatilhos Condicionais**. Para que o sistema exiba a projeção financeira de ganho na linha, o usuário deve preencher tanto os valores simulados da Meta Principal quanto os das Metas Condicionais. Se o valor digitado na Meta Condicional ficar abaixo do percentual mínimo exigido, a célula de ganho final deve exibir instantaneamente `R$ 0,00 (Bloqueado por Condição Comercial)`.

#### 8. Relação entre RESULTADOS, METAS e RECEBÍVEIS (regra de arquitetura)

Esclarecimento do usuário (2026-07-23), registrado aqui porque orienta toda decisão futura de schema/backend destes 3 módulos:

- **Resultados** são sempre atribuídos diretamente a Membros Operacionais. Como os Membros estão dentro de hierarquias, os resultados individuais são agregados (somados) subindo a hierarquia (Membro → Time → Departamento → Canal → Empresa). Podem existir várias linhas do mesmo Tipo de Resultado, para o mesmo Membro, na mesma data — devem ser somadas para compor o resultado daquela data.
- **Metas**: podem existir várias Campanhas de Meta atuando simultaneamente sobre o mesmo Tipo de Resultado. Dentro de UMA Campanha, só pode haver uma linha por Entidade (não pode repetir Entidade na mesma Campanha), mas a mesma Entidade pode ter metas diferentes em Campanhas diferentes. Metas são atribuídas a Entidades específicas e não têm vínculo direto com Recebíveis, a menos que seja explicitamente indicado numa Base de Recebível.
- **Recebíveis**: sempre atribuídos a Membros (líderes ou operacionais). Um Membro pode ter seu recebível calculado a partir dos seus próprios Resultados/Atingimento de Meta, ou a partir dos de outra Entidade (ex: um líder recebendo pelo resultado do seu Time). Numa Campanha (Base) de Recebível, o gestor indica quem são os Beneficiados e, para cada um, qual Entidade será analisada — é aí que nasce o vínculo com uma Meta ou Tipo de Resultado específico. Uma Base tem, na mesma linha de configuração, os Gatilhos Condicionais (travas de elegibilidade, avaliadas antes do cálculo principal) e os Degraus de Recompensa (Faixa/Cumulativo). 1 linha por Membro por Campanha de Recebível, mas o mesmo Membro pode participar de várias Campanhas de Recebível diferentes.
- **Regra-chave**: uma mesma Meta (Campanha) ou um mesmo Tipo de Resultado pode compor várias Campanhas de Recebível simultaneamente. **Esse vínculo é sempre de referência e análise — nunca de pertencimento.** Cada módulo mantém seus próprios dados em bases separadas; eles se comunicam só por leitura (ex: uma Base de Recebível lê o Atingimento de uma Campanha de Meta ou o Realizado de um Tipo de Resultado para a Entidade analisada), nunca criando, apagando ou reescrevendo registros que pertencem a outro módulo. Qualquer implementação que faça uma Base de Recebível mutar uma tabela pertencente ao módulo de Metas ou Resultados (mesmo que "reaproveitando" uma estrutura já existente) viola essa regra e deve ser evitada — a solução correta é sempre uma tabela própria, referenciando a Meta/Resultado só para leitura.

---

## CARGOS

#### 1. Cadastro Geral de Cargos (Templates da Empresa)

Os Cargos funcionam como matrizes globais dentro da empresa para padronizar remunerações e gerenciar os níveis de acesso (RBAC - *Role-Based Access Control*).

- **Campos do Cadastro:** Nome do Cargo, Salário Fixo Padrão (R$) e Nível de Permissão.
- **Matriz de Níveis de Permissão (Escopo de Visualização):**
    - **Operacional:** Restrito aos seus próprios dados. Consome apenas os seus resultados, suas metas e seu extrato/simulador de recebíveis.
    - **Liderança de Nó:** Vinculado à lógica do módulo de *Estrutura Organizacional*. Permite visualizar dashboards, metas, resultados e o breakdown de recebíveis de todo o Time, Departamento ou Canal onde este usuário estiver marcado como **Responsável**.
    - **Administrador:** Acesso irrestrito. Pode criar e alterar configurações comerciais de todos os módulos, reabrir fechamentos e gerenciar acessos.

#### 2. Configurações Financeiras Individuais do Membro

Esta subestrutura estende o cadastro de **Membros** dentro do módulo de *Estrutura Organizacional*, permitindo customizações na base salarial sem a necessidade de criar um cargo exclusivo para exceções.

- **Vínculo Base:** Campo de seleção obrigatória de um dos Cargos cadastrados.
- **Regra de Seleção do Fixo:**
    - *Check 1 - Usar Salário Padrão do Cargo:* O sistema desabilita o campo de digitação e herda dinamicamente o valor do template do Cargo.
    - *Check 2 - Customizar Salário Fixo:* O sistema habilita um campo numérico (`float`) para a inserção de uma remuneração fixa específica para este indivíduo.
- **Limitador de Custo Opcional (Teto Financeiro):** Campo numérico para registrar o custo máximo operacional aceitável para o membro (utilizado em relatórios futuros de ROI comercial).

#### 3. Motor de Fallback de Salário (Lógica do Backend)

Quando o módulo de **Bases de Recebíveis** executar um processamento de payout configurado como **"% sobre o Fixo"**, os programadores devem implementar o seguinte comportamento de busca de dados no banco:

```
// Define a base salarial considerando a prioridade de customização
SE (Membro.SalarioFixoCustomizado != NULL E Membro.SalarioFixoCustomizado > 0) {
    BaseFixoCalculo = Membro.SalarioFixoCustomizado;
} SENÃO {
    BaseFixoCalculo = Membro.Cargo.SalarioFixoPadrao;
}

// Executa o cálculo do Payout com base no gatilho atingido
ValorDoRecebivel = BaseFixoCalculo * (PercentualDoGatilho / 100);
```

#### 4. Sinergia com a Função de Fechamento (Congelamento Histórico)

Para garantir que alterações de salário feitas no presente (ex: um aumento salarial concedido em Março) não quebrem a contabilidade e os pagamentos de comissão do passado (ex: o mês de Janeiro que já foi pago), os programadores devem associar os dados salariais à rotina de **Fechamento de Período**.

- **Ação de Snapshot no Fechamento:** No momento exato em que o gestor acionar o comando de **"Fechar Período Comercial"** na tela de Recebíveis, o sistema deve capturar a remuneração fixa real daquele mês (seja ela herdada do cargo ou customizada) e gravá-la em uma tabela histórica de fechamento (`snapshot_periodo_financeiro`).
- **Consumo das Telas de Histórico:** Sempre que o sistema renderizar relatórios ou extratos de meses com status **`Fechado`**, a query do banco de dados buscará os valores salvos no snapshot daquele período, ignorando completamente o valor atualizado que está na tela de cadastro de Cargos/Membros.
- **Reabertura de Período:** Caso o gestor utilize a função de rollback (`mudar status para Aberto`), o snapshot daquele mês é invalidado e o sistema volta a ler os dados dinâmicos das configurações atuais para permitir novos cálculos de rota.

---

## Acompanhamento META x RESULTADOS

#### 1. Arquitetura de Filtros Avançados (Painel Superior)

A tela de acompanhamento será controlada por quatro eixos de filtragem que atualizam dinamicamente todos os componentes da página:

- **Filtro 1 - Entidade Organizacional:** Seleção em cascata para isolar o escopo de análise: `[Membro (específico), Time, Departamento, Canal]`.
- **Filtro 2 - Meta Específica:** Dropdown que lista as campanhas de metas ativas no ano. Ao selecionar uma meta, o sistema identifica automaticamente qual o **Tipo de Resultado (Indicador)** atrelado a ela e ajusta as unidades da tela (ex: se a meta selecionada for de clientes, a tela muda para numeral; se for faturamento, muda para R$).
- **Filtro 3 - Visão de Período (Granularidade):** Alternância rápida entre `[Diário, Semanal, Mensal, Trimestral]`.
- **Filtro 4 - Data de Corte do Recálculo:** Campo do tipo data `[DIA/MÊS/ANO]` usado exclusivamente para alimentar a projeção de rota do gráfico de recálculo.

#### 2. Visão Focada: Análise Detalhada de uma Meta

Quando o usuário seleciona uma **Meta Específica** e uma **Entidade**, a tela renderiza o comportamento detalhado desse par através de tabelas e gráficos:

- **Painel Gráfico de Desempenho:**
    - **Eixo Temporal:** Plota o histórico de acordo com a granularidade selecionada (Dias, Semanas, Meses ou Trimestres).
    - **Linha/Barra de Meta:** Exibe o valor planejado para o período (respeitando a sazonalidade aplicada). Se a entidade filtrada for um Time, Departamento ou Canal, esta linha exibirá a **Meta Líquida com o Deságio** correspondente já aplicado.
    - **Linha/Barra de Realizado:** Exibe o **Realizado Líquido** real consumido do módulo de Resultados (computados os deságios e ajustes operacionais).
    - **Elementos Visuais (Gatilhos):** O gráfico destaca por meio de cores as faixas de atingimento (os degraus rígidos de 80%, 100%, 115% e 130% configurados na meta).
- **Tabela Espelho de Resultados:**
    - Exibe em formato de matriz as colunas de cada período cronológico e, obrigatoriamente, uma coluna final de **Acumulado do Período**.
    - As linhas da tabela mostram o valor da Meta, o Realizado Líquido e o % de Atingimento.
    - Se o filtro for um nó superior (ex: um Time), a tabela abre linhas de desdobramento para mostrar o desempenho individual de cada Membro pertencente àquele time na referida meta.

#### 3. Gráfico de Recálculo Dinâmico de Rota

Este gráfico é obrigatório para todas as metas e serve para desenhar o cenário futuro realista da operação. Ele funciona de forma preditiva com base no filtro **Data de Corte do Recálculo**:

- **Comportamento do Gráfico:**
    - Até a data de corte selecionada pelo usuário, o gráfico plota o **Realizado Líquido real**.
    - A partir da data de corte até o final do período da meta, o sistema apaga o planejamento original e plota a **Nova Rota Recalculada**.
- **Lógica do Motor de Projeção:**
    - O sistema calcula o saldo devedor: `Saldo = Meta Total Acumulada - Realizado Líquido Real (até a data de corte)`.
    - Este saldo restante é redistribuído nos períodos futuros, mantendo a proporção de peso da **Sazonalidade Original** configurada para aquela meta.
    - Isso permite ao gestor e ao vendedor visualizarem imediatamente o impacto de um mês abaixo da meta: a curva dos meses seguintes se inclina automaticamente para cima, mostrando o novo esforço exigido para salvar o resultado anual.

#### 4. Visão Multimeta (Matriz 360º da Entidade)

Caso o usuário queira uma visão consolidada de todas as frentes de trabalho sem precisar alternar de meta em meta, o sistema oferece a tabela **Visão 360º**. Ela é acionada ao selecionar uma Entidade (Membro, Time, Departamento ou Canal) e exibe o raio-x completo:

- **Estrutura da Tabela de Visão Geral:**
    - **Linhas:** Lista **Todas as Metas ativas** nas quais aquela entidade está envolvida ou possui responsabilidade direta/indireta.
    - **Colunas de Progresso Cronológico:** Exibe os períodos (Mês 1, Mês 2...) exibindo a relação `Realizado / Meta (% Atingimento)` resumida para cada indicador.
    - **Coluna de Acumulado Total:** Mostra o status consolidado de cada meta até o momento atual.
    - **Visão de Cascata (Hierarquia Dinâmica):** Para cada meta listada, a tabela permite expandir o nó para comparar lado a lado o desempenho vertical. Mostra em linhas paralelas como o **Membro** performou, como o **Time** dele performou, como o **Departamento**, o **Canal** e a **Empresa** performaram frente àquela mesma meta. Isso evidencia se o vendedor foi o único a não bater a meta ou se todo o canal dele sofreu no mesmo período.

---

## Recebíveis

#### 1. Definição dos Estados Financeiros (Regra de Negócio)

Para exibir os valores de forma correta, o sistema processa três estados de cálculo baseados no status do período comercial controlado pelo módulo de Fechamento:

- **Ganho Atual (O que GANHOU no momento):** Aplica as regras de *Bases de Recebíveis* sobre o *Realizado Líquido* acumulado até o dia de hoje dentro de um período com status **`Aberto`**. Mostra o valor que já está garantido pelos degraus de gatilhos já ultrapassados.
- **Ganho Projetado (O que PODE GANHAR):** Projeta o resultado final do período mantendo o ritmo atual do membro. Caso o resultado projetado atinja um gatilho superior, o sistema calcula e exibe esse payout potencial.
- **Ganho Liberado (O que VAI GANHAR / Fechado):** Valores históricos de períodos com status **`Fechado`**. Estes dados são estáticos, foram gravados no banco pelo processo de fechamento e não sofrem alterações por vendas do presente.

#### 2. Visão Vendedor (Perfil Operacional / Membro)

O vendedor visualiza apenas os seus próprios números, organizados por metas ativas.

**Componentes da Interface:**

- **Cards de Resumo Financeiro (Mês Atual + Histórico):**
    - *Card 1 (Liberado):* Soma de todos os recebíveis de meses anteriores que já foram fechados e estão aprovados para pagamento.
    - *Card 2 (Garantido do Mês):* O valor do "Ganho Atual" somado de todas as suas metas no mês vigente.
    - *Card 3 (Projetado/Potencial):* O teto que ele pode atingir no mês se mantiver o ritmo ou bater os próximos gatilhos.
- **Tabela Detalhada "Ganho por Meta":**
    
    Apresenta uma linha para cada meta que o vendedor possui no período selecionado:
    
    - *Coluna 1 - Meta / Indicador:* Nome da meta e o indicador (ex: Meta de Faturamento R$).
    - *Coluna 2 - Atingimento:* % atual de entrega da meta.
    - *Coluna 3 - Gatilho Atual:* Qual faixa de gatilho ele está estacionado (ex: Gatilho 1 - 80%).
    - *Coluna 4 - Ganho Atual (R$):* O valor em dinheiro ou o prêmio em texto que ele já conquistou nessa meta específica.
    - *Coluna 5 - Próximo Degrau:* Quanto falta do indicador para ele ativar o próximo gatilho (ex: "Faltam 2 clientes" ou "Faltam R$ 5.000 em vendas").
    - *Coluna 6 - Ganho Potencial (R$):* Quanto passará a ser o seu recebível se ele subir para o próximo gatilho.

#### 3. Visão Gestor (Perfil Admin / Liderança de Nó)

O gestor utiliza esta tela para auditar a folha de pagamento variável da sua equipe, controlar custos e identificar gargalos de performance.

**Painel de Controle e Filtros do Gestor:**

- **Seletor de Escopo:** Permite filtrar a visão consolidada por Empresa, Canal, Departamento ou Time.
- **Filtro de Período:** Permite selecionar o mês/ano de análise ou olhar o acumulado do ano.

**Componentes da Interface:**

- **Cards de Custo Comercial Integrado:**
    - Exibe o valor total de Fixos (Salários dos Cargos) + Total de Variável Garantido (Ganho Atual) + Total de Variável Projetado para todo o grupo selecionado.
- **Tabela de Distribuição (Breakdown):**
    
    Exibe a lista de todos os Membros (ou Times) subordinados ao filtro selecionado.
    
    - *Colunas:* Nome do Membro | Cargo | Salário Fixo | Total de Comissão Garantida (Soma das Metas) | Total de Comissão Projetada | Premiações Físicas a Entregar (Vouchers/Textos acumulados) | Custo Total do Membro (Fixo + Comissão Garantida).
    - *Ação de Drill-down:* Ao clicar na linha de um Membro específico, a tela abre uma janela ou expande a linha exibindo exatamente a "Visão Vendedor" daquele liderado, permitindo que o gestor veja o ganho dele detalhado meta por meta.

#### 4. Regras de Transição de Dados para Programação

- **Segurança de Visualização:** O sistema deve garantir via código (`backend API policies`) que um vendedor nunca consiga puxar os dados de recebíveis de outro membro da equipe trocando parâmetros na URL ou na requisição.
- **Congelamento de Fechamento:** Deve existir uma rotina automática ou um botão para o Gestor Admin chamado "Fechar Período Comercial". Ao acionar isso (ex: fechar o mês de Janeiro), o sistema calcula o valor final da comissão com base no *Realizado Líquido* final daquele mês, migra os saldos de "Ganho Atual" para "Ganho Liberado" e bloqueia qualquer recálculo automático para aquele mês, mesmo que novos resultados retroativos sejam inseridos.

---

## FECHAMENTO

Este ambiente é de **acesso exclusivo do Gestor com perfil Administrador**. É a central de controle fiscal e contábil do sistema.

#### 1. Interface de Controle de Períodos

A tela exibe uma listagem de todos os meses/períodos do ano comercial com seus respectivos status:

- **Status `Aberto` (Sinal Verde/Piscante):** Indica que o mês está em andamento ou ainda não foi validado. Os dados de recebíveis na tela de consulta são dinâmicos e atualizados em tempo real conforme novos resultados entram no sistema.
- **Status `Fechado` (Sinal Vermelho/Cadeado):** Indica que a folha variável do mês foi auditada, aprovada e congelada.

#### 2. Ação: Executar Fechamento de Período

Ao clicar no botão "Fechar Mês" de um período específico, o backend executa em segundo plano a seguinte rotina automatizada:

1. **Consolidação de Resultados:** Trava o valor do *Realizado Líquido* de todos os membros (Resultados Regulares + Deságios por estorno inseridos até aquele momento).
2. **Processamento do Motor Financeiro:** Roda as regras de elegibilidade (Gatilhos Condicionais) e calcula o payout final (Faixa ou Cumulativo) de cada campanha de recebível ativa.
3. **Snapshot Estático de Custos:** Captura o salário fixo vigente no momento (seja o padrão do Cargo ou o customizado do Membro) e as strings de premiações físicas conquistadas.
4. **Gravação da Folha Estática:** Grava todas essas informações em uma tabela de histórico definitiva (`snapshot_periodo_financeiro`).
5. **Ativação de Travas de Segurança:**
    - Altera o status do período para `Fechado`.
    - Envia os dados consolidados para alimentar o estado **"Ganho Liberado"** na tela de Recebíveis.
    - Bloqueia imediatamente qualquer operação de escrita, edição, deságio ou importação de planilhas no módulo de *Resultados* para datas contidas dentro deste mês fechado.

#### 3. Ação: Reabrir Período Comercial (Rollback)

Caso ocorra algum erro humano na folha que precise ser corrigido após o fechamento, o gestor Administrador pode clicar em "Reabrir Período".

- **Comportamento do Sistema:** O status do mês retorna para `Aberto`, a tabela de snapshot daquele mês é limpa e as travas de segurança do módulo de *Resultados* são desativadas, permitindo correções. Os valores na tela de Recebíveis voltam a ficar dinâmicos.

#### 4. Logs de Auditoria do Fechamento

Tabela oculta que registra as ações críticas de fechamento para segurança jurídica da empresa. Cada linha grava: `ID do Usuário`, `Ação Realizada (Fechamento / Reabertura)`, `Mês de Referência`, `Data/Hora Exata` e os valores totais da folha antes e depois da ação.

---

## Níveis de Permissão

#### 1. Arquitetura do Banco de Dados (Isolamento de Dados / Multi-Tenancy)

Para garantir que nenhuma empresa acesse os dados de outra, os programadores devem seguir o modelo de **Isolamento Lógico por Chave Corporativa** (Logical Segregation via `company_id`).

- **Identificador Único (`company_id` / `tenant_id`):** Todas as tabelas do banco de dados (Membros, Times, Resultados, Metas, Recebíveis, etc.) devem obrigatoriamente possuir uma coluna contendo o ID da empresa proprietária daquele registro.
- **Políticas de Acesso ao Banco de Dados (Row-Level Security - RLS):** Se utilizarem bancos de dados como PostgreSQL, os desenvolvedores devem habilitar o RLS. Isso garante que, a nível de banco de dados, qualquer consulta (`SELECT`, `UPDATE`, `DELETE`) seja automaticamente filtrada pela empresa logada, servindo como uma barreira física contra vazamento de dados.
- **Validação via Token (Backend):** O `company_id` deve ser injetado no token de autenticação (JWT) no momento do login. O backend nunca deve aceitar o ID da empresa enviado via corpo da requisição ou parâmetros abertos na URL; o sistema deve ler o ID diretamente do token criptografado e validado.

#### 2. Níveis de Permissão do Sistema (Global / Visão SaaS)

Este nível gerencia a plataforma como um todo e está acima das empresas clientes. É o acesso do seu time interno que gerencia o negócio.

- **Super Administrador (Dono da Plataforma):** Acesso irrestrito a todo o sistema. Pode criar novas empresas, bloquear empresas por inadimplência, visualizar logs de erro e alterar configurações globais do código.
- **Suporte Técnico / Sucesso do Cliente:** Permissão para visualizar o ambiente de uma empresa cliente em modo de leitura (Read-Only) para ajudar a resolver chamados, sem direito a alterar dados financeiros ou senhas de usuários.

#### 3. Níveis de Permissão Interna (Escopo da Empresa Cliente)

Define o que cada usuário cadastrado dentro de uma empresa específica pode fazer.

- **Administrador da Empresa (Dono da Conta / RH / Diretoria Comercial):**
    - Controle total sobre as configurações da empresa.
    - Pode criar, editar e excluir qualquer registro em todos os módulos (Estrutura Organizacional, Metas, Resultados, Cargos, Recebíveis).
    - Pode convidar novos membros para a equipe e gerenciar o faturamento e assinatura da própria empresa.
- **Gestor do Nó (Liderança Comercial):**
    - Seu nível de acesso é determinado dinamicamente pelo local onde ele foi configurado como **Responsável** na Estrutura Organizacional (Canal, Departamento ou Time).
    - *Regra de Escopo:* Se ele for gestor do *Departamento X*, ele tem acesso de visualização de Dashboards e aprovação de resultados para todos os *Times* e *Membros* abaixo do Departamento X. Ele é bloqueado para ver dados de outros Departamentos ou Canais nos quais não é responsável.
    - Não pode alterar regras globais de Recebíveis ou apagar metas criadas pelo Administrador da Empresa, apenas registrar/ajustar resultados (Deságios) do seu escopo.
- **Membro Operacional (Vendedor / SDR):**
    - Acesso estrito aos seus próprios dados de usuário.
    - Visualiza apenas seu painel pessoal de Acompanhamento Meta x Resultados e seu extrato individual de Recebíveis.
    - Bloqueado para acessar qualquer tela de configuração comercial, cadastros ou dados de outros colegas.

#### 4. Fluxo de Convites e Onboarding Com Segurança

- **Convite via Link/E-mail:** Um Administrador da Empresa gera um convite informando o e-mail do colaborador e pré-definindo o seu **Cargo** e seu local na **Estrutura Organizacional** (ex: Time de Inside Sales).
- **Vínculo Obrigatório:** O sistema só libera o acesso do novo usuário após ele confirmar o cadastro através do link enviado ao e-mail. No banco de dados, a conta de usuário (`User Account`) é imediatamente associada ao registro do `Membro` correspondente criado previamente pelo gestor.