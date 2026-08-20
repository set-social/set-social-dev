module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: 'react-native',
            importNames: ['KeyboardAvoidingView'],
            message:
              "Import KeyboardAvoider from 'src/components/core' instead — react-native's KeyboardAvoidingView needs behavior='height' on Android (adjustResize alone doesn't reach content inside react-native-screens or a Modal), which KeyboardAvoider already handles.",
          },
        ],
      },
    ],
  },
  overrides: [
    {
      files: ['src/components/core/KeyboardAvoider.tsx'],
      rules: {
        'no-restricted-imports': 'off',
      },
    },
  ],
};
