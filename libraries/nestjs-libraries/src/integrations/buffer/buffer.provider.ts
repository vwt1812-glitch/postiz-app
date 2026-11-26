import { createHash, randomUUID } from 'node:crypto';
import { Integration } from '@prisma/client';
import { BadBody, SocialAbstract } from '../social.abstract';
import { AuthTokenDetails, PendingCheckResponse, PostDetails, PostResponse, SocialProvider } from '../social/social.integrations.interface';
import { BufferDto } from '../../dtos/posts/providers-settings/buffer.dto';
import { assertBufferWorkspace, BufferClient } from './buffer.client';
import { BufferDeliveryStore } from './buffer.delivery';
import { getSsrfSafeDispatcher } from '../../dtos/webhooks/ssrf.safe.dispatcher';
import { weightedLength } from '@gitroom/helpers/utils/count.length';

export abstract class BufferProvider extends SocialAbstract implements SocialProvider {
  abstract identifier: string;
  abstract name: string;
  abstract service: 'twitter' | 'tiktok';
  isBetweenSteps = false;
  scopes: string[] = [];
  editor = 'normal' as const;
  noRefreshBeforeCall = true;
  dto = BufferDto;
  constructor(protected readonly client = new BufferClient(), protected readonly deliveries = new BufferDeliveryStore()) { super(); }

  maxLength() { return this.service === 'twitter' ? 280 : 2200; }
  async customFields() {
    return [{ key: 'channelId', label: 'Buffer channel', validation: '/^[a-zA-Z0-9_-]+$/', type: 'text' as const }];
  }
  async generateAuthUrl() { const state = randomUUID(); return { url: state, state, codeVerifier: randomUUID() }; }
  async refreshToken(): Promise<AuthTokenDetails> { throw this.failure('Reconnect the Buffer channel after updating the server key.'); }
  async authenticate(params: { code: string; codeVerifier: string }) {
    try {
      const { channelId } = JSON.parse(Buffer.from(params.code, 'base64').toString('utf8'));
      const channel = await this.client.channel(channelId, this.service);
      return { id: channel.id, name: channel.displayName || channel.name, username: channel.name,
        picture: channel.avatar, accessToken: 'server-buffer', refreshToken: '', expiresIn: 0 };
    } catch { return 'Buffer channel could not be verified. Check server configuration.'; }
  }
  protected failure(message: string) { return new BadBody(this.identifier, '{}', '{}', message); }

  private mediaUrl(path: string) {
    const url = new URL(path, process.env.FRONTEND_URL);
    const origins = (process.env.BUFFER_MEDIA_ORIGINS || '').split(',').map(x => x.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !origins.includes(url.origin)) {
      throw this.failure('Buffer media needs a permanent public HTTPS URL on an approved media origin.');
    }
    return url.href;
  }

  override async checkValidity(posts: Array<{ path: string }[]>) {
    if (posts.length !== 1) return 'Buffer replies and threads are not supported by this provider.';
    const media = posts[0] || [];
    if (this.service === 'tiktok' && (media.length !== 1 || !/\.mp4$/i.test(new URL(media[0].path, process.env.FRONTEND_URL).pathname))) {
      return 'TikTok via Buffer currently requires exactly one MP4 video.';
    }
    if (this.service === 'twitter' && (media.length > 4 || (media.length > 1 && media.some(m => /\.(mp4|mov)$/i.test(new URL(m.path, process.env.FRONTEND_URL).pathname))))) {
      return 'X accepts up to four images or one video.';
    }
    try { media.forEach(m => this.mediaUrl(m.path)); } catch { return 'Buffer media URLs must use an approved public HTTPS origin without expiring query parameters.'; }
    return true;
  }

  // Legacy workflow entry point must not publish without asynchronous status handling.
  async post(): Promise<PostResponse[]> { throw this.failure('Buffer requires a current Postiz pending-status workflow.'); }

  async postPending(id: string, _token: string, posts: PostDetails<BufferDto>[], integration: Integration): Promise<PostResponse[]> {
    assertBufferWorkspace(integration.organizationId);
    if (posts.length !== 1) throw this.failure('Buffer accepts one post per delivery.');
    const post = posts[0];
    const valid = await this.checkValidity(posts.map(p => p.media || []));
    if (valid !== true) throw this.failure(valid);
    if ((this.service === 'twitter' ? weightedLength(post.message) : post.message.length) > this.maxLength()) throw this.failure('The post exceeds the channel character limit.');
    if (post.poll) throw this.failure('Buffer polls are not supported.');
    // Reject unsupported settings rather than silently changing publishing semantics.
    if (Object.keys(post.settings || {}).some(k => !['__type', 'isAiGenerated'].includes(k))) throw this.failure('Unsupported Buffer post settings.');
    await this.client.channel(id, this.service);
    const assets = (post.media || []).map(m => {
      const url = this.mediaUrl(m.path);
      return /\.(mp4|mov)$/i.test(new URL(url).pathname) ? { video: { url } } : { image: { url } };
    });
    // Probe without credentials, redirects or downloads. DNS and IP checks use upstream's SSRF guard.
    for (const asset of assets) {
      const response = await fetch((asset.video || asset.image)!.url, {
        method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(15_000), dispatcher: getSsrfSafeDispatcher(),
      } as any);
      const expected = asset.video ? 'video/' : 'image/';
      if (!response.ok || !response.headers.get('content-type')?.startsWith(expected)) throw this.failure('Buffer media is not publicly reachable as the expected media type.');
    }
    const input = { channelId: id, text: post.message, assets, schedulingType: 'automatic', mode: 'shareNow',
      metadata: { [this.service]: { isAiGenerated: post.settings?.isAiGenerated ?? false } } };
    const deliveryId = createHash('sha256').update(`${integration.organizationId}:${integration.id}:${post.id}`).digest('hex');
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const delivery = await this.deliveries.claim(deliveryId, hash);
    if (delivery.requestHash !== hash) throw this.failure('A previous Buffer attempt exists with different content. Review it in Buffer before creating another post.');
    let bufferPostId = delivery.bufferPostId;
    if (!delivery.acquired && !bufferPostId) throw this.failure('Buffer delivery outcome is unconfirmed. Check Buffer manually; automatic re-publication is blocked.');
    if (delivery.acquired) {
      try {
        const result = await this.client.query<{ createPost: { post?: { id: string }; __typename: string } }>(
          `mutation Create($input: CreatePostInput!) { createPost(input: $input) {
            __typename ... on PostActionSuccess { post { id } } ... on MutationError { message }
          } }`, { input });
        if (!result.createPost.post?.id) throw new Error('Rejected or unconfirmed');
        bufferPostId = result.createPost.post.id;
        await this.deliveries.accepted(deliveryId, bufferPostId);
      } catch {
        // Includes 429, 5xx, timeouts and a failed receipt write. Never send createPost again.
        throw this.failure('Buffer delivery was rejected or its outcome is unconfirmed. Check Buffer before retrying manually.');
      }
    }
    return [{ id: post.id, postId: bufferPostId!, releaseURL: '', status: 'pending', pendingData: { bufferPostId, channelId: id } }];
  }

  override async checkPostStatus(_token: string, pending: { bufferPostId: string; channelId: string }, integration: Integration): Promise<PendingCheckResponse> {
    assertBufferWorkspace(integration.organizationId);
    const { post } = await this.client.query<{ post: { id: string; channelId: string; status: string; schedulingType: string; externalLink?: string } }>(
      `query Status($input: PostInput!) { post(input: $input) { id channelId status schedulingType externalLink } }`, { input: { id: pending.bufferPostId } });
    if (post.channelId !== integration.internalId || post.channelId !== pending.channelId) throw this.failure('Buffer post channel mismatch.');
    if (post.schedulingType !== 'automatic') throw this.failure('Buffer returned a manual reminder; publication is not confirmed.');
    if (post.status === 'sent') return { status: 'completed', postId: post.id, releaseURL: post.externalLink || '' };
    if (['error', 'draft', 'needs_approval'].includes(post.status)) throw this.failure('Buffer did not publish the post. Review its status in Buffer.');
    return { status: 'pending', pendingData: pending };
  }
}
