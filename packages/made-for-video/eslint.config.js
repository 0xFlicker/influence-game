import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [{
  files: ["src/**/*.ts"],
  languageOptions: {
    parser: tsparser,
    parserOptions: { project: "./tsconfig.json" },
  },
  plugins: { "@typescript-eslint": tseslint },
  rules: {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-unused-vars": ["error", {
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
    }],
    "no-empty": ["error", { allowEmptyCatch: false }],
    "no-useless-catch": "error",
  },
}];
