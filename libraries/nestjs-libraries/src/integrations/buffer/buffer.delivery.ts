import { PrismaClient } from '@prisma/client';

// Shared by both providers. No database connections are opened until first use.
const prisma = new PrismaClient();

export class BufferDeliveryStore {
  async claim(id: string, requestHash: string) {
    const inserted = await prisma.bufferDelivery.createMany({
      data: [{ id, requestHash }], skipDuplicates: true,
    });
    const delivery = await prisma.bufferDelivery.findUniqueOrThrow({ where: { id } });
    return { ...delivery, acquired: inserted.count === 1 };
  }

  async accepted(id: string, bufferPostId: string) {
    await prisma.bufferDelivery.update({ where: { id }, data: { bufferPostId } });
  }
}
