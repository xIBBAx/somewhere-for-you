import js from "@eslint/js"
import tseslint from "typescript-eslint"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"

export default tseslint.config(
  { ignores: ["dist", "node_modules", "playwright-report", "test-results", ".claude", ".commandcode", "qa-artifacts", ".vite-agent"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { window: "readonly", document: "readonly", localStorage: "readonly" },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    // R3F's render-loop API is intentionally imperative: camera transforms,
    // materials, instance matrices, and particle buffers are mutated in
    // useFrame without causing React renders. The React Compiler's generic
    // immutability rule cannot distinguish that API from render-state mutation.
    files: ["src/game/**/*.{ts,tsx}", "src/world/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/immutability": "off",
    },
  },
)
