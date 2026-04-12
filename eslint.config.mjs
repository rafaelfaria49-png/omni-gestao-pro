import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

/** Config flat oficial do Next.js (core-web-vitals + TypeScript). */
const nextCoreWebVitals = require("eslint-config-next/core-web-vitals")

const eslintConfig = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "prisma/migrations/**",
    ],
  },
  ...nextCoreWebVitals,
  {
    /** Regras experimentais do React Compiler: projeto legado + IDs com Date.now / placeholders com Math.random. */
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/purity": "off",
      "react-hooks/exhaustive-deps": "warn",
      "@next/next/no-img-element": "warn",
      "import/no-anonymous-default-export": "off",
    },
  },
]

export default eslintConfig
