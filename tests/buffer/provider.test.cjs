const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const dependencies = createRequire(process.env.BUFFER_TEST_PACKAGE || path.resolve('package.json'));
const ts = dependencies('typescript');
const root = path.resolve('libraries/nestjs-libraries/src');
class BadBody extends Error { constructor(_id, _json, _body, message) { super(message); this.nonRetryable = true; } }
const cache = new Map();
function load(relative) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename,
    reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } });
  assert.deepEqual(output.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error), []);
  const module = { exports: {} };
  const mocks = {
    '../social.abstract': { SocialAbstract: class {}, BadBody },
    './buffer.delivery': { BufferDeliveryStore: class {} },
    '../../dtos/posts/providers-settings/buffer.dto': { BufferDto: class {} },
    '../../dtos/webhooks/ssrf.safe.dispatcher': { getSsrfSafeDispatcher: () => ({}) },
    '@gitroom/helpers/utils/count.length': { weightedLength: s => dependencies('twitter-text').parseTweet(s).weightedLength },
  };
  vm.runInNewContext(output.outputText, { module, exports: module.exports, process, Buffer, URL, AbortSignal,
    fetch: (...args) => global.fetch(...args), require: name => {
      if (name in mocks) return mocks[name];
      if (name.startsWith('node:')) return require(name);
      if (name.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(filename), name + '.ts')));
      throw new Error(`Unexpected import: ${name}`);
    } }, { filename });
  cache.set(filename, module.exports);
  return module.exports;
}
const { BufferProvider } = load('integrations/buffer/buffer.provider.ts');
const { BufferClient, assertBufferWorkspace } = load('integrations/buffer/buffer.client.ts');
process.env.BUFFER_POSTIZ_ORGANIZATION_ID = 'workspace';
process.env.BUFFER_ORGANIZATION_ID = 'buffer-org';
process.env.BUFFER_CHANNEL_IDS = 'x1,x2,t1';
process.env.BUFFER_MEDIA_ORIGINS = 'https://media.example.org';
process.env.FRONTEND_URL = 'https://media.example.org';
process.env.BUFFER_API_KEY = 'mock-secret-never-a-real-key';
global.fetch = async () => ({ ok: true, headers: new Headers({ 'content-type': 'video/mp4' }) });
const integration = { id: 'integration-1', internalId: 'x1', organizationId: 'workspace' };
function fixture(service = 'twitter') {
  const calls = [];
  const rows = new Map();
  const store = {
    async claim(id, requestHash) { const old = rows.get(id); if (old) return { ...old, acquired: false }; const row = { requestHash, bufferPostId: null }; rows.set(id, row); return { ...row, acquired: true }; },
    async accepted(id, bufferPostId) { rows.get(id).bufferPostId = bufferPostId; },
  };
  const client = { channel: async () => ({}), query: async (query, variables) => { calls.push({ query, variables }); return { createPost: { post: { id: 'buffer-post' } } }; } };
  const provider = new BufferProvider(client, store);
  provider.identifier = service === 'twitter' ? 'x-buffer' : 'tiktok-buffer'; provider.service = service;
  const post = { id: 'post-1', message: 'Council update', settings: {}, media: service === 'tiktok' ? [{ type: 'video', path: 'https://media.example.org/video.mp4' }] : [] };
  return { provider, client, calls, store, post };
}

test('independent X channel IDs and immediate Buffer delivery under Postiz scheduling', async () => {
  const f = fixture();
  const result = await f.provider.postPending('x1', '', [f.post], integration);
  assert.equal(result[0].status, 'pending');
  assert.equal(f.calls[0].variables.input.mode, 'shareNow');
  assert.equal(f.calls[0].variables.input.channelId, 'x1');
  await f.provider.postPending('x2', '', [f.post], { ...integration, id: 'integration-2', internalId: 'x2' });
  assert.equal(f.calls[1].variables.input.channelId, 'x2');
});
test('receipt replay and concurrent calls never create a second post', async () => {
  const f = fixture();
  await Promise.allSettled(Array.from({ length: 12 }, () => f.provider.postPending('x1', '', [f.post], integration)));
  assert.equal(f.calls.length, 1);
  assert.equal((await f.provider.postPending('x1', '', [f.post], integration))[0].postId, 'buffer-post');
  await assert.rejects(() => f.provider.postPending('x1', '', [{ ...f.post, message: 'changed' }], integration), /different content/);
});
test('timeout, rate limit, API rejection and failed receipt persistence block re-publication', async () => {
  for (const failure of ['timeout', '429', 'rejection', 'receipt']) {
    const f = fixture();
    if (failure === 'receipt') f.store.accepted = async () => { throw new Error(); };
    else f.client.query = async () => { f.calls.push({}); if (failure === 'rejection') return { createPost: {} }; throw new Error(failure); };
    await assert.rejects(() => f.provider.postPending('x1', '', [f.post], integration), /unconfirmed/);
    await assert.rejects(() => f.provider.postPending('x1', '', [f.post], integration), /unconfirmed/);
    assert.equal(f.calls.length, 1);
  }
});
test('read-only status polling differentiates pending, sent, failure and reminder', async () => {
  const f = fixture(); const pending = { bufferPostId: 'buffer-post', channelId: 'x1' };
  for (const status of ['scheduled', 'sending', 'sent', 'error', 'draft', 'needs_approval']) {
    f.client.query = async () => ({ post: { id: 'buffer-post', channelId: 'x1', status, schedulingType: 'automatic', externalLink: 'https://x.com/user/status/1' } });
    if (['error', 'draft', 'needs_approval'].includes(status)) await assert.rejects(() => f.provider.checkPostStatus('', pending, integration));
    else assert.equal((await f.provider.checkPostStatus('', pending, integration)).status, status === 'sent' ? 'completed' : 'pending');
  }
  f.client.query = async () => ({ post: { channelId: 'x1', status: 'sent', schedulingType: 'notification' } });
  await assert.rejects(() => f.provider.checkPostStatus('', pending, integration), /reminder/);
  f.client.query = async () => ({ post: { channelId: 'x2', status: 'sent' } });
  await assert.rejects(() => f.provider.checkPostStatus('', pending, integration), /mismatch/);
});
test('workspace, media, polls, unsupported settings and limits reject before mutation', async () => {
  assert.throws(() => assertBufferWorkspace('attacker'));
  const f = fixture('tiktok');
  for (const media of [[], [{ path: 'https://media.example.org/a.jpg' }], [{ path: 'https://private.example.org/a.mp4' }], [{ path: 'http://media.example.org/a.mp4' }], [{ path: 'https://media.example.org/a.mp4?token=secret' }]]) {
    await assert.rejects(() => f.provider.postPending('t1', '', [{ ...f.post, media }], { ...integration, internalId: 't1' }));
  }
  await assert.rejects(() => f.provider.postPending('t1', '', [{ ...f.post, settings: { privacy_level: 'PUBLIC_TO_EVERYONE' } }], { ...integration, internalId: 't1' }));
  const x = fixture();
  await assert.rejects(() => x.provider.postPending('x1', '', [{ ...x.post, message: 'a'.repeat(281) }], integration));
  await assert.rejects(() => x.provider.postPending('x1', '', [{ ...x.post, poll: {} }], integration));
  await assert.rejects(() => x.provider.post(), /pending-status/);
  assert.equal(f.calls.length + x.calls.length, 0);
});
test('channel mismatch, invalid disclosure and inaccessible media cannot start a mutation', async () => {
  const f = fixture('tiktok');
  await assert.rejects(() => f.provider.postPending('t1', '', [f.post], integration), /mismatch/);
  await assert.rejects(() => f.provider.postPending('t1', '', [{ ...f.post, settings: { isAiGenerated: 'false' } }], { ...integration, internalId: 't1' }), /boolean/);
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => ({ ok: false, headers: new Headers({ 'content-type': 'text/html' }) });
    await assert.rejects(() => f.provider.postPending('t1', '', [f.post], { ...integration, internalId: 't1' }), /publicly reachable/);
  } finally { global.fetch = originalFetch; }
  assert.equal(f.calls.length, 0);
});
test('TikTok video payload and AI disclosure use documented asset and metadata types', async () => {
  const f = fixture('tiktok'); f.post.settings.isAiGenerated = true;
  await f.provider.postPending('t1', '', [f.post], { ...integration, internalId: 't1' });
  assert.equal(f.calls[0].variables.input.assets[0].video.url, 'https://media.example.org/video.mp4');
  assert.equal(f.calls[0].variables.input.metadata.tiktok.isAiGenerated, true);
});
test('client uses fixed GraphQL endpoint and redacts remote errors without retry', async () => {
  let count = 0;
  const client = new BufferClient(async (url, options) => {
    count++; assert.equal(url, 'https://api.buffer.com'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer mock-secret-never-a-real-key');
    return { ok: true, json: async () => ({ errors: [{ message: 'sensitive upstream response' }] }) };
  });
  await assert.rejects(() => client.query('query { account { id } }'), e => !e.message.includes('sensitive'));
  assert.equal(count, 1);
});
test('discovery enforces organization, allowlist, platform and channel availability', async () => {
  const channels = ['x1', 'x2', 't1', 'other'].map(id => ({ id, service: id === 't1' ? 'tiktok' : 'twitter', organizationId: 'buffer-org' }));
  const client = new BufferClient(async () => ({ ok: true, json: async () => ({ data: { channels } }) }));
  assert.equal((await client.channels()).length, 3);
  await assert.rejects(() => client.channel('t1', 'twitter'));
  channels[0].isDisconnected = true;
  await assert.rejects(() => client.channel('x1', 'twitter'));
  assert.equal((await client.channel('x2', 'twitter')).id, 'x2');
});
