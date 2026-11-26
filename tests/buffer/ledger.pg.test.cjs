const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
test('PostgreSQL permanent claim survives concurrency and a new connection', { skip: process.env.BUFFER_TEST_DATABASE !== 'true' }, async () => {
  const { PrismaClient } = require('@prisma/client');
  const a = new PrismaClient(); const b = new PrismaClient(); const id = 'test-' + randomUUID();
  try {
    const claims = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).bufferDelivery.createMany({ data: [{ id, requestHash: 'request' }], skipDuplicates: true })));
    assert.equal(claims.reduce((sum, r) => sum + r.count, 0), 1);
    await a.bufferDelivery.update({ where: { id }, data: { bufferPostId: 'accepted-post' } });
    await a.$disconnect();
    assert.equal((await b.bufferDelivery.findUniqueOrThrow({ where: { id } })).bufferPostId, 'accepted-post');
  } finally { await b.bufferDelivery.deleteMany({ where: { id } }); await Promise.all([a.$disconnect(), b.$disconnect()]); }
});
