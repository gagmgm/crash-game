import type { Transport, TransportConnection, TransportHandlers } from '../types/network';

/** Production transport: a thin wrapper around the browser WebSocket. */
export class BrowserWebSocketTransport implements Transport {
  constructor(private readonly url: string) {}

  open(handlers: TransportHandlers): TransportConnection {
    const socket = new WebSocket(this.url);
    const onOpen = () => handlers.onOpen();
    const onMessage = (event: MessageEvent) => {
      if (typeof event.data === 'string') handlers.onMessage(event.data);
    };
    const onClose = (event: CloseEvent) =>
      handlers.onClose({ code: event.code, reason: event.reason, wasClean: event.wasClean });
    const onError = (event: Event) => handlers.onError(event);

    socket.addEventListener('open', onOpen);
    socket.addEventListener('message', onMessage);
    socket.addEventListener('close', onClose);
    socket.addEventListener('error', onError);

    return {
      send: (data) => socket.send(data),
      close: () => {
        socket.removeEventListener('open', onOpen);
        socket.removeEventListener('message', onMessage);
        socket.removeEventListener('close', onClose);
        socket.removeEventListener('error', onError);
        if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
          socket.close(1000, 'client closed');
        }
      },
    };
  }
}
