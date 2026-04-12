import { OPS_KEY_LEGACY } from "@/lib/loja-ativa"

const OPS_PREFIX = "assistec-pro-ops-v1-"

/** Deriva o id da unidade a partir da chave de armazenamento das operações (multiloja). */
export function opsLojaIdFromStorageKey(storageKey: string): string {
  if (storageKey === OPS_KEY_LEGACY || !storageKey.startsWith(OPS_PREFIX)) {
    return "loja-1"
  }
  const rest = storageKey.slice(OPS_PREFIX.length)
  return rest || "loja-1"
}
