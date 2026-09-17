import { defineFunction } from '@aws-amplify/backend';

export const voiceguard = defineFunction({
  name: 'voiceguard',
  entry: './src/lambda.ts',
});