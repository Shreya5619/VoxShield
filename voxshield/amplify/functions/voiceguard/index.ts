import { defineFunction } from '@aws-amplify/backend';

export default defineFunction({
  name: 'voiceguard',
  entry: './handler.ts',
});
