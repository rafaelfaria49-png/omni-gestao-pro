import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const root = dirname(fileURLToPath(import.meta.url))

/**
 * Vitest config mínimo para os testes-baseline pré-piloto SPRINT_01_MULTI_LOJA.
 *
 * Resolve apenas o alias `@/*` para a raiz do repo, espelhando `tsconfig.json`.
 * Sem plugins externos — evita nova dependência.
 *
 * Testes que importam módulos `@/lib/prisma`, `@/generated/prisma` etc. (pesados em
 * runtime e ligados a banco) devem evitar essa importação ou mockar pontualmente.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(root, "."),
      // Next resolve `server-only` internamente. Nos testes Node, o stub preserva
      // o marcador sem executar o pacote sentinela do runtime de componentes.
      "server-only": resolve(root, "test/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.spec.ts"],
    exclude: [
      "node_modules/**",
      ".next/**",
      "generated/**",
      "components/pdv-github-original/**",
      "e2e/**",
    ],
  },
})
