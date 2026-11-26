// No network calls or database writes: validate native dependencies in each image.
const assert = require('node:assert/strict');
const { XBufferProvider } = require('../apps/backend/dist/libraries/nestjs-libraries/src/integrations/social/x.buffer.provider');
const { TiktokBufferProvider } = require('../apps/backend/dist/libraries/nestjs-libraries/src/integrations/social/tiktok.buffer.provider');
const x = new XBufferProvider();
const tiktok = new TiktokBufferProvider();
assert.equal(x.identifier, 'x-buffer');
assert.equal(tiktok.identifier, 'tiktok-buffer');
assert.equal(x.maxLength(), 280);
assert.equal(tiktok.maxLength(), 2200);
require('sharp')({ create: { width: 1, height: 1, channels: 3, background: '#ffffff' } }).png().toBuffer()
  .then(() => console.log(`Buffer image runtime verified on ${process.arch}.`))
  .catch(() => { console.error('Native image dependency failed.'); process.exitCode = 1; });
