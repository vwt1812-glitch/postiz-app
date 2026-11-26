// Read-only verification. Never creates drafts, scheduled posts or public posts.
import { readFileSync } from 'node:fs';
const key = process.env.BUFFER_API_KEY_FILE ? readFileSync(process.env.BUFFER_API_KEY_FILE, 'utf8').trim() : process.env.BUFFER_API_KEY?.trim();
async function query(query, variables = {}) {
  const response = await fetch('https://api.buffer.com', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  if (!response.ok) throw new Error(`Buffer HTTP ${response.status}`);
  const body = await response.json(); if (body.errors || !body.data) throw new Error('Buffer rejected the verification query.');
  return body.data;
}
try {
  if (!key) throw new Error('Set BUFFER_API_KEY_FILE to your local secret file.');
  const { account } = await query('query { account { organizations { id name } } }');
  for (const org of account.organizations) {
    if (process.env.BUFFER_ORGANIZATION_ID && process.env.BUFFER_ORGANIZATION_ID !== org.id) continue;
    const { channels } = await query(`query($input: ChannelsInput!) { channels(input: $input) {
      id name service isDisconnected isLocked isQueuePaused
    } }`, { input: { organizationId: org.id } });
    const supported = channels.filter(c => ['twitter', 'tiktok'].includes(c.service));
    console.log(JSON.stringify({ organization: org, channels: supported, expected: { twitter: 2, tiktok: 1 },
      matching: supported.filter(c => c.service === 'twitter').length === 2 && supported.filter(c => c.service === 'tiktok').length === 1,
      allAvailable: supported.every(c => !c.isDisconnected && !c.isLocked && !c.isQueuePaused) }, null, 2));
  }
} catch (error) { console.error(error.message?.startsWith('Buffer HTTP') ? error.message : 'Buffer verification failed. Check the local key file, permissions and configuration.'); process.exitCode = 1; }
