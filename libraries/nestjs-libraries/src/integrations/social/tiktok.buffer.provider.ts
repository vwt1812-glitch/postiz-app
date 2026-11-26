import { BufferProvider } from '../buffer/buffer.provider';
export class TiktokBufferProvider extends BufferProvider {
  identifier = 'tiktok-buffer';
  name = 'TikTok via Buffer';
  service = 'tiktok' as const;
}
