import withPWAInit from "@ducanh2912/next-pwa"

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  skipWaiting: true,
  cacheOnFrontEndNav: true,
  workboxOptions: {
    disableDevLogs: true,
  },
})

const isVercel = process.env.VERCEL === "1"

/**
 * Carimbo de versão do build (PWA stale guard).
 *
 * Avaliado UMA vez por build e inlined via `env` no bundle do cliente E no código
 * do servidor (rota `/api/version`). Como cada deploy gera um `BUILD_ID` próprio, um
 * cliente rodando bundle ANTIGO (cache/PWA) carrega o id antigo, enquanto a rota do
 * deploy ATUAL devolve o id novo → divergência = versão desatualizada detectável
 * sem depender do ciclo de Service Worker do navegador. Em dev (sem commit SHA) usa
 * timestamp: cliente e servidor compartilham o mesmo valor na sessão (sem falso stale).
 */
const BUILD_ID =
  (process.env.VERCEL_GIT_COMMIT_SHA && process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 12)) ||
  process.env.NEXT_PUBLIC_BUILD_ID ||
  String(Date.now())
const BUILD_TIME = new Date().toISOString()

/**
 * SEGURANÇA: o `env` do next.config é inlined via DefinePlugin no bundle do CLIENTE.
 * SÓ pode conter valores públicos (não-segredos). Segredos de servidor — incluindo
 * GOOGLE_GENERATIVE_AI_API_KEY — NUNCA entram aqui: o código de servidor (Node runtime)
 * lê `process.env.*` em runtime sem precisar de inline (ver lib/resolve-llm-env.ts).
 * Colocar uma chave aqui a "arma" para vazar ao bundle no instante em que qualquer
 * módulo alcançável pelo cliente referenciar `process.env.<chave>`.
 */
const env = {
  NEXT_PUBLIC_BUILD_ID: BUILD_ID,
  NEXT_PUBLIC_BUILD_TIME: BUILD_TIME,
}

/** Cabeçalhos de segurança (produção Vercel). COOP permissivo para não quebrar popups de pagamento/login. */
const securityHeaders = [
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // microphone=() bloqueia voz em todo o site (SpeechRecognition / getUserMedia → not-allowed).
    // microphone=(self) permite o microfone na mesma origem (inclui http://localhost).
    value: "camera=(), microphone=(self), geolocation=(), interest-cohort=()",
  },
]

if (isVercel) {
  securityHeaders.push({
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  })
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  /** Next.js 16 — HMR/webpack dev a partir de 127.0.0.1 (ex.: Playwright com IPv4). */
  allowedDevOrigins: ["127.0.0.1"],
  /** Next.js 16 usa Turbopack por padrão; o plugin PWA injeta webpack — config vazia evita erro de build. */
  turbopack: {},
  env,
  /**
   * CATALOGO-APARELHOS-SEEDS-TRACING-002 — o loader server-only (`lib/catalogo-aparelhos/
   * catalogo-loader.ts`) lê os CSVs de `docs/catalogo/seeds` via `fs`/`process.cwd()`. Esse
   * caminho é dinâmico e NÃO é detectável pelo file-tracing do Next, então em produção
   * serverless (Vercel) os seeds ficariam de fora do bundle e a busca degradaria para vazio.
   * Incluímos os CSVs manualmente em CADA rota que os lê (busca de aparelhos e busca
   * de películas). A rota `produto/[id]` lê do Prisma, não dos CSVs — sem include.
   */
  outputFileTracingIncludes: {
    "/api/catalogo/aparelhos/search": ["./docs/catalogo/seeds/*.csv"],
    "/api/catalogo/peliculas/search": ["./docs/catalogo/seeds/*.csv"],
    "/api/fiscal/**": ["./lib/fiscal/provider/sefaz/trust/icp-brasil-v10.pem"],
    "/api/internal/fiscal/**": ["./lib/fiscal/provider/sefaz/trust/icp-brasil-v10.pem"],
    "/api/vendas/**": ["./lib/fiscal/provider/sefaz/trust/icp-brasil-v10.pem"],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ]
  },
  async rewrites() {
    return [
      { source: "/manifest.json", destination: "/manifest.webmanifest" },
      // NOTE: The rewrite for /api/webhooks/whatsapp → /api/whatsapp/webhook was removed.
      // Next.js 16 plain-array rewrites are classified as "afterFiles" (confirmed in
      // load-custom-routes.js: `afterFiles = _rewrites`), meaning the filesystem is checked
      // first. Since app/api/webhooks/whatsapp/route.ts exists, that file always wins and
      // the rewrite was dead code. Removing it eliminates ambiguity.
    ]
  },
  async redirects() {
    return [
      {
        source: "/dashboard/vendas/config",
        destination: "/dashboard/configuracoes?sec=pdv",
        permanent: false,
      },
      {
        source: "/dashboard/fluxo-caixa",
        destination: "/dashboard/financeiro-v2",
        permanent: false,
      },
      {
        source: "/dashboard/contas-pagar",
        destination: "/dashboard/financeiro/contas-a-pagar",
        permanent: false,
      },
      {
        source: "/dashboard/contas-receber",
        destination: "/dashboard/financeiro/contas-a-receber",
        permanent: false,
      },
      {
        source: "/clientes",
        destination: "/dashboard/clientes",
        permanent: false,
      },
    ]
  },
}

export default withPWA(nextConfig)
