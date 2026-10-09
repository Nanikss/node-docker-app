'use strict';

// Graceful shutdown for an http.Server:
//   1. mark the service not ready (/readyz -> 503) so traffic stops being routed here
//   2. stop accepting new connections and close idle keep-alive sockets
//   3. let in-flight requests finish, closing each socket once its response is sent
//   4. close the store, then exit; force-close everything if it takes longer than timeoutMs
// It must be created before the server starts listening so every socket is tracked.
function createShutdown({ server, store, state, logger, timeoutMs, exit }) {
  const inFlight = new Map(); // socket -> number of requests still being handled

  server.on('connection', (socket) => {
    inFlight.set(socket, 0);
    socket.on('close', () => inFlight.delete(socket));
  });

  // prependListener: runs before the app handler, so the count is right even
  // when a handler responds synchronously.
  server.prependListener('request', (req, res) => {
    const { socket } = req;
    inFlight.set(socket, (inFlight.get(socket) || 0) + 1);
    if (state.shuttingDown) res.setHeader('Connection', 'close');

    res.on('finish', () => {
      if (!inFlight.has(socket)) return;
      const remaining = inFlight.get(socket) - 1;
      inFlight.set(socket, remaining);
      if (state.shuttingDown && remaining === 0) socket.end();
    });
  });

  let pending = null;

  function shutdown(signal) {
    if (pending) return pending;
    state.shuttingDown = true;

    const active = [...inFlight.values()].reduce((sum, n) => sum + n, 0);
    logger.info({ signal, inFlightRequests: active, timeoutMs }, 'shutdown started');

    pending = new Promise((resolve) => {
      let finished = false;
      const finish = async (code) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        try {
          await store.close();
        } catch (err) {
          logger.error({ err }, 'error while closing store');
          code = 1;
        }
        logger.info({ exitCode: code }, 'shutdown complete');
        exit(code);
        resolve(code);
      };

      const timer = setTimeout(() => {
        logger.warn({ openConnections: inFlight.size }, 'shutdown timed out, closing remaining connections');
        for (const socket of inFlight.keys()) socket.destroy();
        finish(1);
      }, timeoutMs);
      timer.unref();

      // Stops accepting connections; the callback runs once every socket is closed.
      server.close(() => finish(0));

      for (const [socket, count] of inFlight) {
        if (count === 0) socket.end();
      }
    });

    return pending;
  }

  return shutdown;
}

module.exports = { createShutdown };
