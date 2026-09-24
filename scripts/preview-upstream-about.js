#!/usr/bin/env node
// Isolated visual fixture: actual AboutTab + hook, fixture auth and API, loopback only.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { createServer } from 'vite';

import { defaultReportPath } from '../server/modules/upstream-updates/index.js';

// Vite otherwise shuts down when a tool runner closes stdin, even while HTTP is starting.
process.env.CI = 'true';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const report = JSON.parse(await readFile(defaultReportPath, 'utf8'));
const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import settings from '/src/i18n/locales/ru/settings.json';
import '/src/index.css';
import AboutTab from '/src/components/settings/view/tabs/AboutTab.tsx';
let report = ${JSON.stringify(report).replace(/</g, '\\u003c')};
let checks = 0;
const state = new URLSearchParams(location.search).get('state');
if (state === 'error') report = { ...report, status:'error', stale:true, error:'GitHub HTTP 503: демонстрация ошибки, сохранён последний отчёт' };
window.fetch = async (url, options = {}) => {
  if (url === '/health') return new Response(JSON.stringify({version:'1.37.0',installMode:'git'}));
  if (url === '/api/system/upstream/check') {
    checks++;
    await new Promise(resolve => setTimeout(resolve, 650));
    report = {...report, checkedAt:new Date().toISOString()};
    document.getElementById('fixture-status').textContent = 'Изолированная проверка: ' + checks + '. Установок: 0.';
    return new Response(JSON.stringify(report), {status: state === 'error' ? 502 : 200});
  }
  if (url === '/api/system/upstream') return new Response(JSON.stringify(state === 'empty' ? null : report));
  throw new Error('Fixture blocked request: ' + url);
};
await i18n.use(initReactI18next).init({lng:'ru', resources:{ru:{settings}}, interpolation:{escapeValue:false}});
createRoot(document.getElementById('root')).render(React.createElement(AboutTab));
`;
const server = await createServer({
  configFile: false, envFile: false, root: repo,
  plugins: [{
    name: 'isolated-upstream-about',
    enforce: 'pre',
    resolveId(id) {
      if (id.endsWith('/auth/context/AuthContext')) return '\0fixture-auth';
      if (id === '/fixture-about.tsx') return '\0fixture-about.tsx';
    },
    load(id) {
      if (id === '\0fixture-auth') return "export const useAuth = () => ({user:{role:'admin'},restartOnboarding:async()=>({success:true})});";
      if (id === '\0fixture-about.tsx') return entry;
    },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== '/') return next();
        const html = '<html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="overflow:auto"><p id="fixture-status" style="padding:12px;font-size:12px">Изолированный просмотр About · данные из локального отчёта · установки отключены</p><div id="root" style="max-width:850px;padding:24px;margin:auto"></div><script type="module" src="/fixture-about.tsx"></script></body></html>';
        try { res.setHeader('Content-Type','text/html; charset=utf-8'); res.end(await vite.transformIndexHtml('/', html)); }
        catch (error) { next(error); }
      });
    },
  }, react()],
  server: { host: '127.0.0.1', port: Number(process.env.UPSTREAM_PREVIEW_PORT || 5188), strictPort: true },
});
await server.listen();
server.printUrls();
