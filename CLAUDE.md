# Diretrizes do Projeto: Sistema SaaS de Metas Comerciais

## Stack Tecnológica Obrigatória
- **Front-end Web:** React (Vite) + TypeScript
- **Design & UI:** Tailwind CSS + Shadcn/UI
- **Gráficos & Dashboards:** Recharts
- **Back-end API:** Node.js / Express ou Hono (TypeScript)
- **Banco de Dados:** PostgreSQL com Prisma ORM
- **Autenticação:** JWT (JSON Web Tokens) com armazenamento seguro

## Comandos do Terminal Permitidos para o Agente
- Instalação: `npm install`
- Compilação/Checagem TypeScript: `npm run tsc`
- Executar Front-end local: `npm run dev`
- Executar Back-end local: `npm run server`
- Executar Testes: `npm run test`
- Gerar Migração do Banco: `npx prisma migrate dev`

## Regras de Arquitetura e Engenharia de Software
- **Isolamento de Dados (Multi-tenancy):** Toda e qualquer tabela do banco de dados (exceto a tabela da própria Empresa) deve possuir obrigatoriamente um campo `companyId`. O Claude deve interceptar todas as requisições e garantir que um usuário jamais acesse dados de outra empresa.
- **Precisão Financeira Extrema:** Use obrigatoriamente a biblioteca `decimal.js` ou manipule valores estritamente em centavos (inteiros).
- **Hierarquia de Usuários:** O sistema opera com níveis estritos de acesso por Tenant: Admin da Empresa (gestão de usuários do tenant), Gerentes/Coordenadores (visão de times) e Vendedores (visão puramente individual)[cite: 1].
- **Padrão de Commits:** Sempre use Conventional Commits (`feat:`, `fix:`, `refactor:`).
- **Precisão Financeira Extrema:** Nunca use números de ponto flutuante (`float`/`double`) puros para cálculos de metas, comissões ou faturamento. Use obrigatoriamente a biblioteca `decimal.js` ou manipule valores estritamente em centavos (inteiros).
- **Separação de Conceitos:** A lógica matemática de metas (MCDS, Top-Down, Reforecast) deve residir estritamente em arquivos de serviços isolados (`/src/server/services/`). Nenhuma regra de comissão ou cálculo deve ser escrita diretamente nos componentes de UI do React.

## Comportamento do Claude Code
- Sempre execute o comando de testes (`npm run test`) após alterar qualquer serviço matemático para garantir que nenhuma regra pré-existente foi quebrada.
- Se uma alteração quebrar um teste unitário, dê rollback na edição do arquivo imediatamente e reavalie a estratégia.
- Antes de iniciar qualquer tarefa nova neste projeto, leia `_local/plano/PLANO-MESTRE.md` e `docs/produto/SPECIFICATION.md` primeiro.
- Ao concluir uma etapa do `_local/plano/PLANO-MESTRE.md`, marque-a como (FEITO) e registre um resumo das mudanças de destaque.
- O próximo passo a executar é sempre o primeiro item do `_local/plano/PLANO-MESTRE.md` ainda não marcado como (FEITO).
- Se o caminho percorrido exigir mudar os próximos passos ainda pendentes, avise o usuário e proponha o replanejamento antes de reescrevê-los.

## Organização de Arquivos
Ver `MAPA.md` na raiz para a tabela completa de "o que é cada coisa e para onde vai". Regras ao criar qualquer arquivo novo:
- **Código que o sistema executa** → `src/` (`client/`, `server/` ou `shared/`). Nunca na raiz.
- **Documentação para humano ou agente** → `docs/` (`produto/`, `design/` ou `historico/`). Nunca na raiz.
- **Qualquer coisa que não deve subir ao GitHub** → `_local/` (a pasta inteira é gitignored). Nunca deixe arquivo local solto na raiz.
- **A raiz é reservada** a arquivos de configuração que a ferramenta exige encontrar ali (`package.json`, `index.html`, `tsconfig*`, `vite.config.ts`, `Dockerfile`, `vercel.json`, `.env`, `CLAUDE.md`, `README.md`, `MAPA.md`). Não adicione nada à raiz sem essa exigência técnica.
- Ao mover arquivos versionados, use `git mv` para preservar o histórico.

