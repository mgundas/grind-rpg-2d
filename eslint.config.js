import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "apps/*/public/**", "coverage/**"],
  },
  // TypeScript recommended, without type-aware linting (kept fast; revisit later).
  ...tseslint.configs.recommended,
  // React rules only where React code lives.
  {
    ...reactHooks.configs.flat.recommended,
    files: ["apps/{client,admin}/src/**/*.{ts,tsx}"],
  },
  // Keep last: disables eslint rules that conflict with Prettier.
  eslintConfigPrettier,
);
