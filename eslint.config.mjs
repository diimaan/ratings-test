import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import globals from "globals";


export default defineConfig([
    {
        ignores: [
            "frontend/dist/**",
            "node_modules/**",
            "coverage/**",
        ],
    },
    {
        files: ["**/*.{js,mjs,cjs}"],
        plugins: { js },
        extends: ["js/recommended"],
    },
    {
        files: ["src/**/*.js", "test/**/*.js"],
        languageOptions: {
            sourceType: "commonjs",
            globals: globals.node,
        },
    },
    {
        files: ["api/**/*.js"],
        languageOptions: {
            sourceType: "module",
            globals: globals.node,
        },
    },
    {
        files: [
            "eslint.config.mjs",
            "frontend/**/*.js",
            "frontend/**/*.jsx",
            "frontend/**/*.mjs",
        ],
        languageOptions: {
            sourceType: "module",
            globals: {
                ...globals.browser,
                ...globals.node,
            },
            parserOptions: {
                ecmaFeatures: {
                    jsx: true,
                },
            },
        },
    },
]);
