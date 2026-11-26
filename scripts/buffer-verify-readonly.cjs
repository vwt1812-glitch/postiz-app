// Read-only verification of the real provider authentication and status query.
// This file deliberately contains no createPost or other mutation call.
require('dotenv').config({ path: '.env.buffer', quiet: true });
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { BufferClient } = require('../libraries/nestjs-libraries/src/integrations/buffer/buffer.client');
const { XBufferProvider } = require('../libraries/nestjs-libraries/src/integrations/social/x.buffer.provider');
const { TiktokBufferProvider } = require('../libraries/nestjs-libraries/src/integrations/social/tiktok.buffer.provider');
(async () => {
  const client = new BufferClient();
  const channels = await client.channels();
  for (const channel of channels) {
    const provider = channel.service === 'twitter' ? new XBufferProvider() : new TiktokBufferProvider();
    const auth = await provider.authenticate({ code: Buffer.from(JSON.stringify({ channelId: channel.id })).toString('base64'), codeVerifier: '' });
    if (typeof auth === 'string' || auth.id !== channel.id) throw new Error('Provider authentication failed');
    const result = await client.query(`query ReadStatus($input: PostsInput!) {
      posts(first: 1, input: $input) { edges { node { id channelId status schedulingType externalLink } } }
    }`, { input: { organizationId: process.env.BUFFER_ORGANIZATION_ID, filter: { channelIds: [channel.id] } } });
    console.log(JSON.stringify({ channelId: channel.id, name: channel.name, provider: provider.identifier,
      authenticationVerified: true, statusQueryVerified: Array.isArray(result.posts.edges),
      existingPostCountInSample: result.posts.edges.length }));
  }
})().catch(() => { console.error('Read-only provider verification failed; no publication was attempted.'); process.exitCode = 1; });
