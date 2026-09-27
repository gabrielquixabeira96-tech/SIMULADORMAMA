import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts", "playwright-report/**", "test-results/**"],
  },
  {
    rules: {
      // Logs passam pelo logger higienizado (src/log/logger.ts), nunca console direto.
      "no-console": "error",
    },
  },
  {
    files: ["src/log/**", "scripts/**", "tests/**", "e2e/**", "*.config.*"],
    rules: { "no-console": "off" },
  },
  {
    files: ["tests/**", "e2e/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
];

export default config;
