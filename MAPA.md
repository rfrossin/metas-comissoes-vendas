# MAPA — o que é cada coisa e para onde vai

Este documento responde a três perguntas que se repetem: **isso é do sistema ou é meu?**, **isso sobe pro GitHub?** e **isso vira o quê em produção?**

---

## Regra de decisão — arquivo novo, onde colocar

Três perguntas, na ordem. A primeira que der "sim" decide:

1. **É código que o sistema executa?** → `src/` (`client/`, `server/` ou `shared/`)
2. **É explicação para uma pessoa ou para um agente ler?** → `docs/` (`produto/`, `design/` ou `historico/`)
3. **É só meu, desta máquina?** → `_local/`

Se nenhuma deu "sim", provavelmente é configuração de ferramenta — e aí vale a regra da raiz, no fim deste documento.

---

## Onde cada parte do sistema é publicada

O projeto tem **três destinos de deploy distintos**, e essa é a razão principal da divisão de pastas:

```
src/client/  ──build:client──>  dist/client/  ──>  VERCEL        (site que o usuário acessa)
src/server/  ──build:server──>  dist/server/  ──>  VPS via DOCKER (API em api.rossinvendas.com)
src/shared/  ──> entra nos dois builds
prisma/migrations/            ──migrate deploy──>  SUPABASE      (banco de dados)
```

Quem dispara isso: push na `main` roda `.github/workflows/deploy.yml`, que primeiro valida (`npm test` + `npm run verify`) e só depois toca o VPS. A Vercel observa o repositório por conta própria.

---

## Tabela mestra

### Sobe pro GitHub — código do sistema

| Caminho | O que é | Vira o quê |
|---|---|---|
| `src/client/` | Frontend React + Vite (páginas, componentes, rotas, estado) | Vercel |
| `src/server/` | Backend Express (rotas, controllers, serviços de cálculo) | VPS via Docker |
| `src/shared/` | Código usado pelos dois lados | Entra nos dois builds |
| `prisma/` | `schema.prisma` + migrations + seeds | Supabase |
| `public/` | Ícones do PWA | Servido estático pela Vercel |
| `scripts/` | Shell scripts do CI (`verify`, `smoke`, `ci-env`, `vps-deploy`) | Executado pelo GitHub Actions |
| `supabase/` | `config.toml` do CLI local do Supabase | Só desenvolvimento local |
| `.github/workflows/` | Automação de build e deploy | GitHub Actions |

### Sobe pro GitHub — configuração (não mover da raiz)

| Caminho | Papel |
|---|---|
| `package.json`, `package-lock.json` | Dependências e scripts |
| `index.html` | Entrada do Vite — a Vercel espera na raiz |
| `tsconfig.json`, `tsconfig.app.json`, `tsconfig.server.json` | TypeScript (front e back compilam separado) |
| `vite.config.ts`, `vitest.config.ts`, `vitest.integration.config.ts` | Build e testes |
| `tailwind.config.ts`, `postcss.config.js`, `components.json` | Estilo e shadcn/ui |
| `.eslintrc.cjs`, `.prettierrc`, `.nvmrc`, `.gitattributes` | Padrões de código |
| `Dockerfile`, `docker-compose.yml`, `docker-entrypoint.sh` | Imagem do backend |
| `Caddyfile` | Cópia de referência do proxy do VPS (o ativo vive lá) |
| `vercel.json` | Configuração do deploy do frontend |
| `.gitignore`, `.dockerignore` | O que cada ferramenta ignora |
| `.env.example` | **Template** de variáveis — o único `.env*` versionado |

### Sobe pro GitHub — documentação

| Caminho | Conteúdo |
|---|---|
| `README.md` | Porta de entrada: o que é, como rodar |
| `MAPA.md` | Este arquivo |
| `CLAUDE.md` | Instruções para o agente de IA |
| `docs/produto/` | `PRODUCT.md` (visão) e `SPECIFICATION.md` (especificação funcional completa) |
| `docs/design/` | `DESIGN.md` (sistema de design) |
| `docs/historico/` | Planos e specs de funcionalidades **já executadas** — registro, não instrução ativa |

### Nunca sobe

| Caminho | O que é | Por que não sobe |
|---|---|---|
| `_local/` | Plano-mestre, lockfile de skills, rascunhos | É seu, desta máquina |
| `.env`, `.env.local`, `.env.test` | Senhas e chaves reais | Segredo — use `.env.example` como referência |
| `.claude/`, `.agents/`, `.impeccable/`, `.claudeignore` | Ferramental de IA | Não faz parte do produto |
| `.vercel/` | Vínculo local com o projeto Vercel | Gerado por `vercel link` |
| `node_modules/` | Dependências instaladas | Reconstruído por `npm ci` |
| `dist/` | Resultado do build | Reconstruído por `npm run build` |

---

## Por que estas coisas locais ficam na raiz e não em `_local/`

Parece inconsistente colocar `_local/` como "a pasta do que é local" e deixar `.env` e `.claude/` fora dela. Não é escolha — é exigência técnica. Cada uma dessas ferramentas procura seu arquivo **na raiz do projeto** e não aceita outro caminho:

- **`.claude/` e `CLAUDE.md`** — o Claude Code só lê configuração e instruções da raiz.
- **`.env`** — o `docker-compose.yml` declara `env_file: .env`, relativo à raiz.
- **`.agents/`, `.impeccable/`** — criadas e lidas pelas próprias ferramentas, no lugar fixo.
- **`.vercel/`** — gerada pelo CLI da Vercel.
- **`index.html`** — o Vite trata a raiz como base do projeto; a Vercel também.

Mover qualquer um desses quebra a ferramenta correspondente. O `_local/` é para o que **não** tem essa amarração.

Pela mesma lógica, `src/` e `prisma/` também não podem ir para uma subpasta: o `Dockerfile` copia `prisma/`, `src/server/` e `src/shared/` por caminho fixo, e `vercel.json` espera o build em `dist/client`. **A raiz do repositório é a raiz do sistema** — é a convenção que Vercel, Docker e Vite assumem.

---

## Se precisar mover algo mesmo assim

Alguns caminhos estão escritos dentro de arquivos de configuração. Mover sem ajustar quebra o deploy. Os pontos de atenção:

| Se mover… | Atualize também |
|---|---|
| `scripts/` | `.github/workflows/deploy.yml` (linha do `ci-env.sh`) e os scripts `verify`/`smoke` do `package.json` |
| `prisma/`, `src/server/`, `src/shared/`, `docker-entrypoint.sh` | `Dockerfile` (os `COPY`) |
| `index.html`, saída do build | `vercel.json` e `vite.config.ts` |
| Arquivo versionado, qualquer um | Use `git mv`, para preservar o histórico |

Um detalhe fácil de esquecer: `.gitattributes` força `*.sh` com quebra de linha LF. Renomear um script tirando o `.sh` faz o Windows gravar CRLF e o container falha com um erro de "arquivo não encontrado" que não parece ter relação nenhuma com isso.
