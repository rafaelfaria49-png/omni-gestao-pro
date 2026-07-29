<!-- GERADO por `node scripts/track.mjs registry` a partir de docs/ai-execution/protocol.json. Não edite à mão. -->

# Gates universais — AEP/1.0-R2

Gate de CAMINHO: se um caminho staged casar com o gate e o id do gate **não** estiver
em `gates_liberados` do GOAL ativo, o commit é recusado (exit 2).

Não existe gate por conteúdo do diff. Varredura de conteúdo, quando existir, é
**AVISO HEURÍSTICO** e nunca gate — não crie confiança falsa nela.

| Gate | Tipo | Autorização | Caminhos | Motivo |
| --- | --- | --- | --- | --- |
| `G-DADOS-SCHEMA` | caminho | humana explícita | `prisma/schema.prisma`<br>`prisma/migrations/**` | Alteração de schema ou migration atinge dados reais de produção e é irreversível na prática. |
| `G-DADOS-SEED` | caminho | humana explícita | `prisma/seed.ts`<br>`prisma/seeds/**`<br>`scripts/seed/**`<br>`data/**` | Seeds escrevem no banco. Gate de CAMINHO, não varredura de conteúdo do diff. |
| `G-AUTH` | caminho | humana explícita | `auth.ts`<br>`auth.config.ts`<br>`proxy.ts` | Camada de autenticação e proteção de rotas. Regra de ouro do repositório. |
| `G-CI` | caminho | humana explícita | `.github/workflows/**` | CI é a camada remota do protocolo; alterá-la muda quem valida o quê. |
| `G-CONFIG-DEPLOY` | caminho | humana explícita | `next.config.mjs`<br>`vercel.json`<br>`.env.example`<br>`package.json` | Configuração de build e deploy afeta produção fora do escopo de qualquer GOAL. |
| `G-AEP-CORE` | caminho | humana explícita | `scripts/track.mjs`<br>`scripts/track.test.mjs`<br>`.githooks/**`<br>`docs/ai-execution/protocol.json` | O próprio núcleo do protocolo. Um GOAL não reescreve as regras que o julgam. |

## Gramática de caminhos

Duas formas apenas: `a/b/c/arquivo.ext` (igualdade exata) e `a/b/c/**` (prefixo).
Qualquer outra forma falha na leitura do GOAL, com exit 1, antes de qualquer execução.
