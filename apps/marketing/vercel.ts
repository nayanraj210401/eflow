import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  installCommand: "npm install -g vite-plus && vp install --filter '@eflob/marketing...'",
  buildCommand: "vp run --filter @eflob/marketing build",
  outputDirectory: "dist",
};
