import { readFileSync } from 'node:fs';
import { BadBody } from '../social.abstract';

export const isBufferProvider = (id: string) => ['x-buffer', 'tiktok-buffer'].includes(id);

export function assertBufferWorkspace(organizationId: string) {
  if (!process.env.BUFFER_POSTIZ_ORGANIZATION_ID || organizationId !== process.env.BUFFER_POSTIZ_ORGANIZATION_ID) {
    throw new BadBody('buffer', '{}', '{}', 'Buffer is not enabled for this workspace.');
  }
}

export type BufferChannel = {
  id: string; name: string; displayName?: string; service: string; avatar: string;
  organizationId: string; isDisconnected: boolean; isLocked: boolean; isQueuePaused: boolean;
};

export class BufferClient {
  constructor(private readonly request: typeof fetch = fetch) {}

  async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const key = process.env.BUFFER_API_KEY_FILE
      ? readFileSync(process.env.BUFFER_API_KEY_FILE, 'utf8').trim()
      : process.env.BUFFER_API_KEY?.trim();
    if (!key) throw new Error('Buffer key is not configured on the server.');
    // Fixed endpoint, no redirects, no automatic mutation retries, no remote bodies in errors.
    const response = await this.request('https://api.buffer.com', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) throw new Error(`Buffer HTTP ${response.status}`);
    const body = await response.json();
    if (body.errors?.length || !body.data) throw new Error('Buffer rejected the GraphQL request.');
    return body.data as T;
  }

  async channels(): Promise<BufferChannel[]> {
    const organizationId = process.env.BUFFER_ORGANIZATION_ID;
    if (!organizationId) throw new Error('Buffer organization is not configured.');
    const { channels } = await this.query<{ channels: BufferChannel[] }>(
      `query Channels($input: ChannelsInput!) { channels(input: $input) {
        id name displayName service avatar organizationId isDisconnected isLocked isQueuePaused
      } }`, { input: { organizationId } });
    const allowed = (process.env.BUFFER_CHANNEL_IDS || '').split(',').map(x => x.trim()).filter(Boolean);
    // Explicit allowlist prevents accidental publication on additional accounts.
    return channels.filter(c => c.organizationId === organizationId && allowed.includes(c.id));
  }

  async channel(id: string, service: string) {
    const channel = (await this.channels()).find(c => c.id === id && c.service === service);
    if (!channel || channel.isDisconnected || channel.isLocked || channel.isQueuePaused) {
      throw new Error('Buffer channel is unavailable, disconnected, locked or paused.');
    }
    return channel;
  }
}
