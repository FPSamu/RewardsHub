/**
 * ESLint (antes no había configuración y `npm run lint` fallaba).
 * Base: reglas recomendadas de ESLint + @typescript-eslint (ya estaban en devDependencies).
 * El código existente usa `any` a propósito en varios lugares (req as any, documentos de
 * Mongoose sin tipar): se deja como aviso, no como error.
 */
module.exports = {
    root: true,
    parser: '@typescript-eslint/parser',
    parserOptions: { ecmaVersion: 2020, sourceType: 'module' },
    plugins: ['@typescript-eslint'],
    extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
    env: { node: true, es2020: true },
    ignorePatterns: ['dist/', 'node_modules/', 'coverage/'],
    rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
        // `let { a, b } = …` donde solo se reasigna `a` es válido (opción estándar)
        'prefer-const': ['error', { destructuring: 'all' }],
    },
    overrides: [
        {
            // src/anna es JavaScript CommonJS (router de Anna)
            files: ['*.js'],
            rules: { '@typescript-eslint/no-var-requires': 'off', '@typescript-eslint/no-require-imports': 'off' },
        },
    ],
};
