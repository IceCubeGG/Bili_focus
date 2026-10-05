import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electron from 'electron';
import './build-electron.mjs';

const server = await createServer();
await server.listen();
server.printUrls();
const child = spawn(electron, ['.'], { stdio: 'inherit', env: { ...process.env, BILI_DEV_SERVER_URL: 'http://127.0.0.1:5173' } });
const cleanup = async () => { child.kill(); await server.close(); };
child.on('exit', async (code) => { await server.close(); process.exit(code ?? 0); });
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
