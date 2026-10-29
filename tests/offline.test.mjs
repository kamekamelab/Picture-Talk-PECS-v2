import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const code = await readFile(new URL('../dist/sw.js', import.meta.url), 'utf8');
async function environment({ failingAsset = null } = {}) {
  const listeners = new Map();
  const buckets = new Map([['other-app-cache', new Map()], ['ptp-v2-shell-old', new Map()]]);
  let online = true;
  let networkCalls = 0;
  const cacheModes = [];
  const remote = async input => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    networkCalls++;
    cacheModes.push(input.cache);
    if (!online || url.pathname.endsWith(failingAsset || 'never')) throw new Error('network unavailable');
    const file = resolve(import.meta.dirname, '../dist', url.pathname.replace('/Picture-Talk-PECS-v2/', '') || 'index.html');
    await access(file);
    return { url: url.href, body: await readFile(file), ok: true };
  };
  const caches = {
    keys: async () => [...buckets.keys()],
    delete: async key => buckets.delete(key),
    open: async key => {
      if (!buckets.has(key)) buckets.set(key, new Map());
      const entries = buckets.get(key);
      return {
        addAll: async urls => { const values = await Promise.all(urls.map(remote)); values.forEach((value, index) => entries.set(typeof urls[index] === 'string' ? urls[index] : urls[index].url, value)); },
        match: async input => { const url = new URL(typeof input === 'string' ? input : input.url); url.search = ''; return entries.get(url.href); }
      };
    }
  };
  vm.runInNewContext(code, {
    URL, Request, caches, fetch: remote,
    self: { location: 'https://school.example/Picture-Talk-PECS-v2/sw.js', clients: { claim: async () => {} }, addEventListener: (name, callback) => listeners.set(name, callback) }
  });
  return {
    listeners, buckets, cacheModes,
    offline: () => { online = false; },
    get networkCalls() { return networkCalls; },
    lifecycle: name => new Promise((resolve, reject) => listeners.get(name)({ waitUntil: promise => promise.then(resolve, reject) })),
    check: () => new Promise((resolve, reject) => {
      listeners.get('message')({ data: { type: 'CHECK_OFFLINE' }, ports: [{ postMessage: resolve }], waitUntil: promise => promise.catch(reject) });
    }),
    request: (path, mode = 'cors') => new Promise((resolve, reject) => {
      let handled = false;
      listeners.get('fetch')({ request: { method: 'GET', url: new URL(path, 'https://school.example/Picture-Talk-PECS-v2/').href, mode }, respondWith: promise => { handled = true; promise.then(resolve, reject); } });
      if (!handled) resolve(null);
    })
  };
}
test('リポジトリ配下のURLでも必要な全ファイルが揃い、通信停止後に画面とJSを返せる', async () => {
  const env = await environment();
  await env.lifecycle('install'); await env.lifecycle('activate');
  const calls = env.networkCalls;
  env.offline();
  for (const path of ['', 'index.html', 'app.js', 'domain.js', 'cards.js', 'book.js', 'tokens.js', 'sentence.js', 'speech.js', 'storage.js', 'style.css', 'icons/icon-192.png', 'icons/icon-512.png']) {
    const response = await env.request(path, path === '' ? 'navigate' : 'cors');
    assert.ok(response?.body.length, path);
  }
  assert.ok((await env.request('nested-view', 'navigate')).body.toString().includes('Picture Talk'));
  assert.equal(env.networkCalls, calls);
});
test('別アプリのキャッシュとURLに干渉しない', async () => {
  const env = await environment();
  await env.lifecycle('install'); await env.lifecycle('activate');
  assert.ok(env.buckets.has('other-app-cache'));
  assert.equal(env.buckets.has('ptp-v2-shell-old'), false);
  assert.equal(await env.request('https://external.example/data'), null);
  assert.equal(await env.request('https://school.example/Picture-Talk-PECS/'), null);
});
test('必須素材の取得に失敗した更新を有効化しない', async () => {
  const env = await environment({ failingAsset: 'app.js' });
  await assert.rejects(env.lifecycle('install'), /network unavailable/);
  assert.ok(env.buckets.has('ptp-v2-shell-old'));
});

test('準備済み表示は通信状態ではなく必須ファイルの実際の保存を確認する', async () => {
  const env = await environment();
  assert.equal((await env.check()).ready, false);
  await env.lifecycle('install'); await env.lifecycle('activate');
  env.offline();
  const calls = env.networkCalls;
  assert.equal((await env.check()).ready, true);
  assert.equal(env.networkCalls, calls);
  const current = [...env.buckets.entries()].find(([key]) => key.startsWith('ptp-v2-shell-'))[1];
  current.delete('https://school.example/Picture-Talk-PECS-v2/app.js');
  assert.equal((await env.check()).ready, false);
});

test('更新時にHTTPキャッシュの古いJSを再利用せず全ファイルを取り直す', async () => {
  const env = await environment();
  await env.lifecycle('install');
  assert.ok(env.cacheModes.length > 0);
  assert.ok(env.cacheModes.every(mode => mode === 'reload'));
});
