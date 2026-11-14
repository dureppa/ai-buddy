import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { build, createServer } from 'vite';

const root = fileURLToPath(new URL('./frontend', import.meta.url));
const repo = fileURLToPath(new URL('../..', import.meta.url));
const hrApiPorts = { consents: 8185, documents: 8187, events: 8188 };
const ports = JSON.parse(await readFile(new URL('./frontend/service-ports.json', import.meta.url), 'utf8'));
const [command, selected] = process.argv.slice(2);
if (!['dev', 'build'].includes(command) || (selected && !Object.hasOwn(ports, selected))) {
  throw new Error('Usage: node sites.mjs dev|build [service]');
}

for (const [id, port] of Object.entries(ports)) {
  if (selected && id !== selected) continue;
  const config = {
    configFile: false,
    root,
    plugins: [react()],
    define: { __CORPORATE_SERVICE__: JSON.stringify(id) },
    server: {
      host: 'localhost',
      port,
      strictPort: true,
      fs: { allow: [root, repo] },
      proxy: {
        '/api': 'http://127.0.0.1:8080',
        '/jira-api': { target: 'http://127.0.0.1:8189', rewrite: (path) => path.replace(/^\/jira-api/, '/api') },
        ...(hrApiPorts[id]
          ? {
              '/hr-api': {
                target: 'http://127.0.0.1:' + hrApiPorts[id],
                rewrite: (path) => path.replace(/^\/hr-api/, '/api'),
              },
            }
          : {}),
      },
    },
    build: { outDir: '../dist/' + id, emptyOutDir: true },
  };
  if (command === 'dev') {
    const server = await createServer(config);
    await server.listen();
    server.printUrls();
  } else {
    await build(config);
  }
}
