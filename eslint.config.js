import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

const noComments = {
  meta: {
    type: 'suggestion',
    messages: { comment: 'No code comments.' },
    schema: [],
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          context.report({ loc: comment.loc, messageId: 'comment' });
        }
      },
    };
  },
};

export default [
  { ignores: ['dist/', 'node_modules/', 'sources/'] },
  js.configs.recommended,
  {
    plugins: { queryc: { rules: { 'no-comments': noComments } } },
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      'queryc/no-comments': 'error',
      'arrow-body-style': ['error', 'as-needed'],
      'consistent-return': 'error',
      curly: ['error', 'multi-line'],
      'default-case-last': 'error',
      'dot-notation': 'error',
      eqeqeq: ['error', 'always'],
      'no-else-return': ['error', { allowElseIf: false }],
      'no-implicit-coercion': ['error', { allow: ['!!'] }],
      'no-lonely-if': 'error',
      'no-nested-ternary': 'error',
      'no-param-reassign': 'error',
      'no-plusplus': 'error',
      'no-shadow': 'error',
      'no-unneeded-ternary': 'error',
      'no-useless-concat': 'error',
      'no-useless-return': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'one-var': ['error', 'never'],
      'prefer-arrow-callback': 'error',
      'prefer-const': 'error',
      'prefer-template': 'error',
      radix: 'error',
    },
  },
  {
    files: ['src/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['scripts/**/*.js', '*.config.js'],
    languageOptions: { globals: globals.node },
  },
  prettier,
];
