import prettier from 'eslint-plugin-prettier/recommended'

export default [
  prettier,
  {
    rules: {
      'no-unused-vars': 'error',
      'prefer-const': 'error',
    },
  },
]
