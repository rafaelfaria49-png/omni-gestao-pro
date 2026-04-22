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

const env = {
  GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
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
  /** Next.js 16 usa Turbopack por padrão; o plugin PWA injeta webpack — config vazia evita erro de build. */
  turbopack: {},
  env,
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
    ]
  },
}

export default withPWA(nextConfig)
