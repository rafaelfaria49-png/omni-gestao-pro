/**
 * Executa `prisma db push` com cwd na raiz do repo (carrega `.env` corretamente)
 * e `shell: true` no Windows para o `npx` resolver bem fora do PowerShell.
 */
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
process.chdir(root)

const result = spawnSync("npx", ["prisma", "db", "push"], {
  stdio: "inherit",
  shell: true,
  cwd: root,
  env: process.env,
})

if (result.error) {
  console.error(result.error)
  process.exit(1)
}
process.exit(result.status ?? 1)
