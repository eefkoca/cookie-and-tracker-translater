import http from 'node:http';
import { createApp } from './app.js';
import { templateProvider, makeLlmProvider } from './providers.js';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1'; // bound to loopback: not reachable from the network
const provider = process.env.LLM_API_KEY
  ? makeLlmProvider({ apiKey: process.env.LLM_API_KEY, baseUrl: process.env.LLM_BASE_URL, model: process.env.LLM_MODEL })
  : templateProvider;

http.createServer(createApp({ provider })).listen(PORT, HOST, () => {
  console.log(`[backend] listening on http://${HOST}:${PORT} (provider=${provider.name}, node ${process.version})`);
});
