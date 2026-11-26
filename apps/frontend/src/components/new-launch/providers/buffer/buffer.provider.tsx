'use client';
import { withProvider, PostComment } from '../high.order.provider';
import { BufferDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/buffer.dto';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
const Settings = () => {
  const form = useSettings();
  return <div className="flex flex-col gap-3">
    <p>Postiz schedules this post. Buffer publishes it automatically at the scheduled time. Delivery is confirmed after Buffer reports it as sent.</p>
    <label><input type="checkbox" {...form.register('isAiGenerated')} /> Disclose AI-generated content</label>
  </div>;
};
const common = { postComment: PostComment.POST, comments: false as const,
  minimumCharacters: [], SettingsComponent: Settings, dto: BufferDto };
export const XBufferComposer = withProvider({ ...common, maximumCharacters: 280 });
export const TiktokBufferComposer = withProvider({ ...common, maximumCharacters: 2200 });
