import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import voiceguard from './functions/voiceguard';
import websocketConnection from './functions/websocket-connection/index';

/**
 * @see https://docs.amplify.aws/react/build-a-backend/ to add storage, functions, and more
 */
defineBackend({
  auth,
  data,
  voiceguard,
  websocketConnection,
});