import { io } from 'socket.io-client';
import { BASE_URL } from '../helpers/api.helper';

// Not connected until something needs it — the login screen has no reason
// to hold a socket open.
export const socket = io(BASE_URL || undefined, {
  autoConnect: false,
  withCredentials: true,
});
