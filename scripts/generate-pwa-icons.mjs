/**
 * Gera PNGs a partir de public/assistec-pro-icon.svg para PWA / Apple Touch.
 * Executado no prebuild (Vercel/Linux) e pode ser rodado localmente: node scripts/generate-pwa-icons.mjs
 */
import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")
const svgPath = join(root, "public", "assistec-pro-icon.svg")
const outDir = join(root, "public", "icons")

const BG = { r: 12, g: 74, b: 110, alpha: 1 }

async function maskablePng(size, innerRatio) {
  const inner = Math.round(size * innerRatio)
  const buf = await sharp(svgPath).resize(inner, inner).png().toBuffer()
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: BG,
    },
  })
    .composite([{ input: buf, gravity: "center" }])
    .png()
}

async function main() {
  await mkdir(outDir, { recursive: true })

  await sharp(svgPath).resize(192, 192).png().toFile(join(outDir, "icon-192.png"))
  await sharp(svgPath).resize(512, 512).png().toFile(join(outDir, "icon-512.png"))

  await (await maskablePng(192, 0.72)).toFile(join(outDir, "icon-maskable-192.png"))
  await (await maskablePng(512, 0.72)).toFile(join(outDir, "icon-maskable-512.png"))

  await sharp(svgPath).resize(180, 180).png().toFile(join(root, "public", "apple-touch-icon.png"))

  console.log("PWA icons gerados em public/icons e apple-touch-icon.png")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
