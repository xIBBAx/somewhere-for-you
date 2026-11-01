declare module "virtual:gift-media" {
  /** Files in customize/media/, by relative path (tools/vite/giftMediaPlugin.ts). */
  export const giftMedia: Record<string, { url: string; kind: "image" | "audio" | "model"; w?: number; h?: number }>
}
