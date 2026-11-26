const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
test('PostgreSQL permanent claim survives concurrency and a new connection', { skip: process.env.BUFFER_TEST_DATABASE !== 'true' }, async () => {
  const { PrismaClient } = require('@prisma/client');
  const ts = require('typescript');
  const connections = [];
  class TrackedPrisma extends PrismaClient { constructor() { super(); connections.push(this); } }
  const module = { exports: {} };
  const source = fs.readFileSync('libraries/nestjs-libraries/src/integrations/buffer/buffer.delivery.ts', 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  vm.runInNewContext(output.outputText, { module, exports: module.exports, require: () => ({ PrismaClient: TrackedPrisma }) });
  const a = new module.exports.BufferDeliveryStore();
  const b = new module.exports.BufferDeliveryStore();
  const verification = new PrismaClient(); const id = 'test-' + randomUUID();
  try {
    const claims = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).claim(id, 'request')));
    assert.equal(claims.filter(r => r.acquired).length, 1);
    await a.accepted(id, 'accepted-post');
    await Promise.all(connections.map(c => c.$disconnect()));
    assert.equal((await verification.bufferDelivery.findUniqueOrThrow({ where: { id } })).bufferPostId, 'accepted-post');
    assert.equal((await b.claim(id, 'request')).acquired, false);
  } finally {
    await verification.bufferDelivery.deleteMany({ where: { id } });
    await Promise.all([...connections, verification].map(c => c.$disconnect()));
  }
});
