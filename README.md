# Metas e Comissões de Vendas

Sistema SaaS multi-empresa para definição de metas comerciais, acompanhamento de resultados e cálculo de comissões e recebíveis.

Cada empresa (tenant) tem seus dados totalmente isolados, com três níveis de acesso: **Admin da Empresa**, **Gerente/Coordenador** (visão de time) e **Vendedor** (visão individual).

> **Novo no projeto? Comece pelo [MAPA.md](MAPA.md)** — ele explica o que é cada pasta, o que sobe para o GitHub e para onde cada parte do sistema é publicada.

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React + Vite + TypeScript, Tailwind + shadcn/ui, Recharts |
| Backend | Node.js + Express (TypeScript) |
| Banco | PostgreSQL (Supabase) via Prisma ORM |
| Autenticação | JWT |
| Cálculo financeiro | `decimal.js` — nunca ponto flutuante puro |

Requer **Node 20+** (ver `.nvmrc`).

## Rodando localmente

```bash
npm install                 # instala e roda `prisma generate`
cp .env.example .env        # preencha com suas credenciais
```

O front e o back rodam separados — **são dois terminais**, não existe script que suba os dois juntos:

```bash
npm run dev                 # frontend  → http://localhost:5173
npm run server              # backend   → http://localhost:3333
```

O Vite já encaminha `/api` para a porta 3333, então basta abrir o endereço do frontend.

## Banco de dados

```bash
npm run prisma:migrate      # cria migration a partir de mudanças no schema
npm run migrate:deploy      # aplica migrations pendentes (usado em produção)
npm run prisma:studio       # navegador visual do banco
npm run prisma:seed         # popula dados iniciais
```

## Testes e validação

```bash
npm test                    # testes unitários
npm run test:integration    # testes de integração (precisa de banco)
npm run tsc                 # checagem de tipos
npm run lint                # ESLint
npm run verify              # build limpo do backend + smoke test em /health
```

`npm run verify` é o mesmo gate que o CI executa antes de qualquer deploy. Rode antes de subir mudanças.

> Ao alterar qualquer serviço de cálculo em `src/server/services/`, rodar `npm test` é obrigatório — são as regras de meta e comissão que sustentam o produto.

## Deploy

Push na `main` dispara `.github/workflows/deploy.yml`, que valida antes de publicar:

| Parte | Destino |
|---|---|
| `src/client` | Vercel |
| `src/server` | VPS via Docker (`api.rossinvendas.com`) |
| `prisma/migrations` | Supabase |

## Documentação

| Documento | Assunto |
|---|---|
| [MAPA.md](MAPA.md) | Organização de pastas e arquivos |
| [docs/produto/SPECIFICATION.md](docs/produto/SPECIFICATION.md) | Especificação funcional completa |
| [docs/produto/PRODUCT.md](docs/produto/PRODUCT.md) | Visão de produto |
| [docs/design/DESIGN.md](docs/design/DESIGN.md) | Sistema de design |
| [docs/historico/](docs/historico/) | Planos e specs de funcionalidades já entregues |
| [CLAUDE.md](CLAUDE.md) | Instruções para o agente de IA |
