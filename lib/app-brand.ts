/**
 * Nome público do aplicativo (ERP). Configure em `.env`:
 * `NEXT_PUBLIC_APP_NAME="Seu Nome"`
 */
export const APP_DISPLAY_NAME =
  (typeof process.env.NEXT_PUBLIC_APP_NAME === "string" && process.env.NEXT_PUBLIC_APP_NAME.trim()) ||
  "OmniGestão Pro"
