'use client';
import { useEffect, useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
type Channel = { id: string; name: string; handle: string; available: boolean };
export const BufferChannelSelect = ({ identifier }: { identifier: string }) => {
  const fetch = useFetch();
  const { register } = useFormContext();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/integrations/buffer/channels/${identifier}`)
      .then(async response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(data => { if (!Array.isArray(data)) throw new Error(); if (active) setChannels(data); })
      .catch(() => { if (active) setError('Buffer channels could not be loaded. Ask the administrator to check the server configuration.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [identifier]);
  return <label className="flex flex-col gap-2">Buffer channel
    <select {...register('channelId')} disabled={loading || !!error} required>
      <option value="">{loading ? 'Loading channels…' : 'Choose a channel'}</option>
      {channels.map(c => <option key={c.id} value={c.id} disabled={!c.available}>
        {c.name} (@{c.handle}){!c.available ? ' — unavailable' : ''}
      </option>)}
    </select>
    {error && <span role="alert">{error}</span>}
    {!loading && !error && !channels.length && <span>No authorized channels found. Check the server channel allowlist.</span>}
  </label>;
};
