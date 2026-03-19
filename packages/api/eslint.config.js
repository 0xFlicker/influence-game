import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      // Quality gate: no `as any` or explicit `any` types
      "@typescript-eslint/no-explicit-any": "error",

      // Quality gate: no unused variables (ignore prefixed with _)
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
      }],

      // Catches are for handling specific known errors ONLY
      "no-empty": ["error", { allowEmptyCatch: false }],

      // Prefer throwing and failing fast — no silent error swallowing
      "no-useless-catch": "error",
    },
  },
  {
    // Slightly relaxed rules for test files
    files: ["src/__tests__/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
      }],
    },
  },
];
