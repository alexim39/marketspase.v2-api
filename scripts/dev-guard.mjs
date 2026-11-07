import 'dotenv/config';
import net from 'node:net';

/**
 * Dev guard: fail before nodemon starts if the API port already accepts
 * connections. Prevents two `npm run dev` trees from fighting over one port.
 *
 * A TCP connect is more reliable than trying to bind: Windows allows some
 * overlapping binds, so "bind succeeded" does not always mean the port is free.
 */
const port = Number(process.env.PORT ?? 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`[dev] invalid PORT: ${process.env.PORT ?? '(missing)'}`);
  process.exit(1);
}

const acceptsConnections = (host) => new Promise((resolve) => {
  const socket = net.connect({ port, host });
  const finish = (used) => {
    socket.destroy();
    resolve(used);
  };
  socket.setTimeout(750);
  socket.once('connect', () => finish(true));
  socket.once('timeout', () => finish(false));
  socket.once('error', () => finish(false));
});

const used = (await acceptsConnections('127.0.0.1'))
  || (await acceptsConnections('::1'));

if (used) {
  console.error(`[dev] port ${port} is already in use.`);
  console.error('[dev] stop the other API dev server before starting another:');
  console.error(`[dev]   Get-NetTCPConnection -LocalPort ${port} -State Listen | Select-Object OwningProcess`);
  console.error('[dev]   taskkill /PID <pid> /T /F');
  process.exit(1);
}

process.exit(0);
