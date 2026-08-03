/**
 * Contador HUB · Portal externo read-only — barrel do núcleo de domínio (GOAL 015).
 *
 * FASE 1: somente o núcleo (`lib/contador/portal/**`). Rotas `app/**` e páginas
 * entram na fase 2 e consomem ESTE barrel — nunca os módulos internos direto.
 */
export * from "./flag"
export * from "./erros"
export * from "./eventos"
export * from "./escopo"
export * from "./competencias"
export * from "./resumo"
export * from "./documentos"
export * from "./pacotes"
export * from "./comentarios"
export * from "./timeline"
export * from "./conferir"
export * from "./deps"
