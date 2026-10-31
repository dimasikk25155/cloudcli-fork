#!/usr/bin/env node
// Browser tools for the owner's existing shared Edge profile. No extra browser or API token.
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const launcher = path.join(os.homedir(), '.local/bin/neo3-edge');
const sessions = new Map();
let launched = false;
let initialTabs = new Set();

function edge(args, input) {
  return new Promise((resolve, reject) => {
    const env = {};
    for (const key of ['HOME', 'USERPROFILE', 'PATH', 'TMPDIR', 'LANG']) if (process.env[key]) env[key] = process.env[key];
    const child = spawn(process.execPath, [launcher, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', error = '', settled = false;
    const finish = (reason, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); reason ? reject(reason) : resolve(value);
    };
    const timer = setTimeout(() => { child.kill(); finish(new Error('Shared Edge request timed out')); }, 35000);
    child.stdout.on('data', (part) => {
      out += part;
      if (out.length > 12 * 1024 * 1024) { child.kill(); finish(new Error('Shared Edge response is too large')); }
    });
    child.stderr.on('data', (part) => { error = (error + part).slice(-2000); });
    child.once('error', (e) => finish(e));
    child.once('exit', (code) => {
      if (code !== 0) return finish(new Error(error.trim() || `Shared Edge exited ${code}`));
      try { finish(null, out.trim() ? JSON.parse(out) : {}); }
      catch { finish(new Error('Invalid response from the shared Edge launcher')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input === undefined ? '' : JSON.stringify(input));
  });
}
const cdp = (target, method, params) => edge(['cdp', target, method], params);

async function evaluate(target, expression) {
  const result = await cdp(target, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'Page action failed');
  return result.result?.value;
}
const required = (v, name) => { if (typeof v !== 'string' || !v.trim()) throw new Error(`${name} is required`); return v; };
export function webUrl(value) {
  const url = new URL(required(value, 'url'));
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http and https URLs are supported');
  return url.href;
}
const getSession = (id) => { const s = sessions.get(id); if (!s) throw new Error('Browser session not found'); return s; };
const current = (s) => s.tabs[s.index];
const view = (s) => ({ id: s.id, runtime: 'shared-edge', status: 'ready', tabCount: s.tabs.length });

async function createSession(input) {
  if (input.profileName && !['default', 'Default'].includes(input.profileName)) throw new Error('Only the shared Default Edge profile is allowed');
  const status = await edge(['status']);
  await edge(['start']);
  if (!status.running) {
    launched = true;
    initialTabs = new Set((await edge(['tabs'])).filter((t) => t.type === 'page' && t.url === 'about:blank').map((t) => t.id));
  }
  const { targetId } = await cdp('browser', 'Target.createTarget', { url: 'about:blank' });
  const s = { id: randomUUID(), tabs: [targetId], index: 0 };
  sessions.set(s.id, s);
  return view(s);
}

async function snapshot(s) {
  const page = await evaluate(current(s), `(() => {
    for (const m of document.querySelectorAll('video,audio')) { m.pause(); m.muted = true; }
    return {title:document.title,url:location.href,text:(document.body?.innerText || '').slice(0,30000),
      controls:Array.from(document.querySelectorAll('a,button,input,textarea,select')).slice(0,100).map(e=>({tag:e.tagName.toLowerCase(),id:e.id || null,type:e.type || null,text:(e.innerText || e.getAttribute('aria-label') || e.getAttribute('placeholder') || '').slice(0,160)}))};
  })()`);
  return { session: view(s), ...page };
}

async function navigate(s, url) {
  const result = await cdp(current(s), 'Page.navigate', { url: webUrl(url) });
  if (result.errorText) throw new Error(result.errorText);
  await evaluate(current(s), `new Promise((resolve,reject)=>{if(document.readyState!=='loading')return resolve(true);const timer=setTimeout(()=>reject(new Error('Page load timed out')),30000);document.addEventListener('DOMContentLoaded',()=>{clearTimeout(timer);resolve(true)},{once:true})})`);
  return snapshot(s);
}

const locateScript = (input) => input.selector
  ? `document.querySelector(${JSON.stringify(input.selector)})`
  : input.text ? `Array.from(document.querySelectorAll('button,a,[role="button"],label')).find(e=>e.innerText?.includes(${JSON.stringify(input.text)}))` : 'document.activeElement';

async function fill(s, selector, text) {
  if (typeof text !== 'string') throw new Error('text must be a string');
  return evaluate(current(s), `(() => {const e=${locateScript({ selector })};if(!e)throw new Error('Input not found');e.focus();
    if(e.isContentEditable)e.textContent=${JSON.stringify(text)};else{
      const prototype=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      const setter=Object.getOwnPropertyDescriptor(prototype,'value')?.set;if(!setter)throw new Error('Target is not a text input');setter.call(e,${JSON.stringify(text)});
    }e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
}

async function pressKey(s, input) {
  const raw = required(input, 'key');
  const parts = raw.split('+'), key = parts.pop();
  const mods = parts.reduce((n, p) => n | ({ Alt: 1, Control: 2, Ctrl: 2, Meta: 4, Command: 4, Shift: 8 }[p] || 0), 0);
  const code = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 }[key] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
  if (!code) throw new Error('Unsupported key');
  await cdp(current(s), 'Input.dispatchKeyEvent', { type: 'keyDown', key, modifiers: mods, windowsVirtualKeyCode: code, ...(key.length === 1 && !mods ? { text: key } : {}) });
  await cdp(current(s), 'Input.dispatchKeyEvent', { type: 'keyUp', key, modifiers: mods, windowsVirtualKeyCode: code });
}

async function closeSession(s) {
  sessions.delete(s.id);
  for (const targetId of s.tabs) await cdp('browser', 'Target.closeTarget', { targetId }).catch(() => {});
  return { stopped: true };
}

export async function callTool(name, input = {}) {
  if (name === 'browser_create_session') return createSession(input);
  if (name === 'browser_list_sessions') return [...sessions.values()].map(view);
  const s = getSession(required(input.sessionId, 'sessionId'));
  if (name === 'browser_close_session') return closeSession(s);
  if (name === 'browser_snapshot') return snapshot(s);
  if (name === 'browser_navigate') return navigate(s, input.url);
  if (name === 'browser_take_screenshot') {
    const r = await cdp(current(s), 'Page.captureScreenshot', { format: 'png' });
    return { content: [{ type: 'image', mimeType: 'image/png', data: r.data }] };
  }
  if (name === 'browser_click') {
    if (Number.isFinite(input.x) && Number.isFinite(input.y)) {
      for (const type of ['mousePressed', 'mouseReleased']) await cdp(current(s), 'Input.dispatchMouseEvent', { type, x: input.x, y: input.y, button: 'left', clickCount: 1 });
    } else {
      if (!input.selector && !input.text) throw new Error('selector, text or coordinates are required');
      await evaluate(current(s), `(()=>{const e=${locateScript(input)};if(!e)throw new Error('Element not found');e.click();return true})()`);
    }
  } else if (name === 'browser_type') {
    await fill(s, input.selector, input.text);
    if (input.submit) await pressKey(s, 'Enter');
  } else if (name === 'browser_fill_form') {
    if (!Array.isArray(input.fields) || input.fields.length > 100) throw new Error('fields must contain at most 100 entries');
    for (const field of input.fields) await fill(s, required(field.selector, 'selector'), field.value);
  } else if (name === 'browser_press_key') {
    await pressKey(s, input.key);
  } else if (name === 'browser_select_option') {
    if (!Array.isArray(input.values)) throw new Error('values must be an array');
    await evaluate(current(s), `(()=>{const e=document.querySelector(${JSON.stringify(required(input.selector, 'selector'))});if(!e || e.tagName!=='SELECT')throw new Error('Select not found');const values=${JSON.stringify(input.values)};for(const o of e.options)o.selected=values.includes(o.value);e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  } else if (name === 'browser_wait_for') {
    if (!input.text && !input.url) throw new Error('text or url is required');
    const timeout = Math.min(30000, Math.max(250, Number(input.timeoutMs) || 5000));
    await evaluate(current(s), `new Promise((resolve,reject)=>{const deadline=Date.now()+${timeout};const check=()=>{if(${input.text ? `(document.body?.innerText || '').includes(${JSON.stringify(input.text)})` : `location.href.includes(${JSON.stringify(input.url)})`})return resolve(true);if(Date.now()>=deadline)return reject(new Error('Wait timed out'));setTimeout(check,100)};check()})`);
  } else if (name === 'browser_tabs') {
    const action = input.action || 'list';
    if (action === 'new') {
      const { targetId } = await cdp('browser', 'Target.createTarget', { url: input.url ? webUrl(input.url) : 'about:blank' });
      s.tabs.push(targetId); s.index = s.tabs.length - 1;
    } else if (action !== 'list') {
      const index = input.index ?? s.index;
      if (!Number.isInteger(index) || index < 0 || index >= s.tabs.length) throw new Error('Tab not found');
      if (action === 'select') s.index = index;
      else if (action === 'close') {
        if (s.tabs.length === 1) throw new Error('Close the session to close its last tab');
        await cdp('browser', 'Target.closeTarget', { targetId: s.tabs[index] });
        s.tabs.splice(index, 1); s.index = Math.min(s.index, s.tabs.length - 1);
      } else throw new Error('Unsupported tab action');
    }
    const tabs = await edge(['tabs']);
    return { session: view(s), tabs: s.tabs.map((id, index) => ({ index, url: tabs.find((t) => t.id === id)?.url, active: index === s.index })) };
  } else throw new Error(`Unknown browser tool: ${name}`);
  return snapshot(s);
}

const string = { type: 'string' }, number = { type: 'number' }, boolean = { type: 'boolean' };
const definitions = [
  ['browser_create_session', 'Open a task-owned tab in the single shared Edge Default profile.', { profileName: string }, []],
  ['browser_list_sessions', 'List only the sessions owned by this MCP process.', {}, []],
  ['browser_snapshot', 'Read page text and visible controls; media is paused and muted.', {}, []],
  ['browser_take_screenshot', 'Capture the active task-owned Edge tab.', {}, []],
  ['browser_navigate', 'Navigate an owned Edge tab to an http or https URL.', { url: string }, ['url']],
  ['browser_click', 'Click using selector, text or coordinates.', { selector: string, text: string, x: number, y: number }, []],
  ['browser_type', 'Fill a selected text field or the focused field.', { selector: string, text: string, submit: boolean }, ['text']],
  ['browser_fill_form', 'Fill form fields without submitting.', { fields: { type: 'array', items: { type: 'object', properties: { selector: string, value: string }, required: ['selector', 'value'] } } }, ['fields']],
  ['browser_press_key', 'Press a key such as Enter, Tab, Escape or Control+A.', { key: string }, ['key']],
  ['browser_select_option', 'Choose select option values.', { selector: string, values: { type: 'array', items: string } }, ['selector', 'values']],
  ['browser_wait_for', 'Wait up to 30 seconds for text or a URL fragment.', { text: string, url: string, timeoutMs: number }, []],
  ['browser_tabs', 'List, create, select or close only tabs owned by this session.', { action: { enum: ['list', 'new', 'select', 'close'], type: 'string' }, index: number, url: string }, []],
  ['browser_close_session', 'Close this session and only its own tabs.', {}, []],
];
export const tools = definitions.map(([name, description, properties, required]) => ({ name, description,
  inputSchema: { type: 'object', properties: { ...(name === 'browser_create_session' || name === 'browser_list_sessions' ? {} : { sessionId: string }), ...properties },
    required: [...(name === 'browser_create_session' || name === 'browser_list_sessions' ? [] : ['sessionId']), ...required], additionalProperties: false } }));

async function shutdown() {
  for (const s of [...sessions.values()]) await closeSession(s);
  if (launched) {
    const tabs = await edge(['tabs']).catch(() => []);
    const pages = tabs.filter((t) => t.type === 'page');
    if (pages.every((t) => initialTabs.has(t.id) && t.url === 'about:blank')) await edge(['stop']).catch(() => {});
  }
}

async function main() {
  const lines = readline.createInterface({ input: process.stdin });
  let shuttingDown = false;
  const finish = async () => { if (shuttingDown) return; shuttingDown = true; await shutdown(); process.exit(0); };
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, finish);
  for await (const line of lines) {
    let request;
    try { request = JSON.parse(line); } catch { continue; }
    if (request.id === undefined) continue;
    let response;
    try {
      if (request.method === 'initialize') response = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'neo3-edge', version: '1.0.0' } };
      else if (request.method === 'tools/list') response = { tools };
      else if (request.method === 'ping') response = {};
      else if (request.method === 'tools/call') {
        try { const value = await callTool(request.params.name, request.params.arguments); response = value?.content ? value : { content: [{ type: 'text', text: JSON.stringify(value) }] }; }
        catch (error) { response = { isError: true, content: [{ type: 'text', text: error.message }] }; }
      } else throw new Error('Unsupported MCP method');
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: response }) + '\n');
    } catch (error) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: error.message } }) + '\n'); }
  }
  await shutdown();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
