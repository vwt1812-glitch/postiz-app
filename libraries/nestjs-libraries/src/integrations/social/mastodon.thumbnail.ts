import { Readable } from 'node:stream';

// A bounded download using the provider's SSRF-safe dispatcher, without credentials.
export async function loadMastodonThumbnail(url: string | undefined, dispatcher: unknown, fetcher: typeof fetch = fetch) {
  if (!url) return undefined;
  const response = await fetcher(url, {
    headers: { 'accept-encoding': 'identity' }, redirect: 'error',
    signal: AbortSignal.timeout(30000),
    // @ts-ignore Node/undici dispatcher
    dispatcher,
  });
  if (!response.ok || !response.body) throw new Error('Could not download Mastodon thumbnail');
  const contentType = response.headers.get('content-type')?.split(';')[0].trim();
  const max = 2 * 1024 * 1024;
  if (!['image/jpeg', 'image/png'].includes(contentType || '') || Number(response.headers.get('content-length')) > max) {
    await response.body.cancel();
    throw new Error('Mastodon thumbnail must be JPEG or PNG, at most 2 MiB');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of Readable.fromWeb(response.body as any)) {
    size += chunk.length;
    if (size > max) throw new Error('Mastodon thumbnail exceeds 2 MiB');
    chunks.push(Buffer.from(chunk));
  }
  const data = Buffer.concat(chunks);
  const jpeg = data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255;
  const png = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (!(contentType === 'image/jpeg' ? jpeg : png)) throw new Error('Invalid thumbnail image');
  return { data, contentType, filename: contentType === 'image/jpeg' ? 'thumbnail.jpg' : 'thumbnail.png' };
}
