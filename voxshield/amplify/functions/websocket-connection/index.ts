import { defineFunction } from '@aws-amplify/backend';

export default defineFunction({
  name: 'websocketConnection',
  entry: './src/connection.ts',
  environment: {
    CONNECTION_TABLE: 'VoxShieldConnections',
    REGION: 'us-east-1',
  },
});