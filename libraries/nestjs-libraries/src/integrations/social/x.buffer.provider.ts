import { BufferProvider } from '../buffer/buffer.provider';
export class XBufferProvider extends BufferProvider {
  identifier = 'x-buffer';
  name = 'X via Buffer';
  service = 'twitter' as const;
}
