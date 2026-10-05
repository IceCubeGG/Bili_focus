// Optional guest-only compatibility probe. Never loads a session or posts a message.
import { build } from 'esbuild';
const compiled = await build({ entryPoints: ['src/electron/video-client.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const { VideoClient } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const request = async (url, init) => {
  const response = await fetch(url, init);
  if (process.argv.includes('--debug-schema') && new URL(url).pathname === '/x/v2/reply') {
    const data = (await response.clone().json()).data;
    console.log(JSON.stringify({ guestOnly: true, schema: 'comments', keys: Object.keys(data), paging: data.page, need_login: data.need_login, controlKeys: Object.keys(data.control ?? {}), replies: data.replies === null ? null : data.replies?.length, pinned: data.top_replies?.length, hots: data.hots?.length }));
  }
  return response;
};
const client = new VideoClient(() => null, () => 0, request);
try {
  const bvid = process.argv.slice(2).find(value => !value.startsWith('--')) ?? 'BV1xx411c7mD';
  const details = await client.getVideoDetails({ bvid });
  console.log(JSON.stringify({ guestOnly: true, stage: 'details', bvid: details.bvid, parts: details.parts.length, tags: details.tags.length }));
  const cid = details.parts[0].cid;
  const playback = await client.getVideoPlayback({ bvid, cid, format: 'progressive' });
  console.log(JSON.stringify({ guestOnly: true, stage: 'playback', format: playback.dash ? 'DASH' : 'progressive', quality: playback.qualityLabel, available: playback.qualities.map(choice => choice.label), segments: playback.sources.length }));
  const streamUrl = playback.dash?.video.find(track => track.quality === playback.quality)?.url ?? playback.sources[0]?.url;
  const stream = await client.stream(new Request(streamUrl, { headers: { Range: 'bytes=0-65535' } }));
  const reader = stream.body?.getReader(); const first = reader ? await reader.read() : null; if (reader) await reader.cancel();
  console.log(JSON.stringify({ guestOnly: true, stage: 'media-range', status: stream.status, contentType: stream.headers.get('Content-Type'), initialBytes: first?.value?.byteLength ?? 0 }));
  if (![200, 206].includes(stream.status)) throw new Error('The guest media range could not be retrieved.');
  const dm = await client.getDanmu({ bvid, cid, segment: 1 });
  console.log(JSON.stringify({ guestOnly: true, stage: 'danmu', items: dm.items.length }));
  const comments = await client.getVideoComments({ bvid, page: 1, sort: 'hot', root: null });
  console.log(JSON.stringify({ guestOnly: true, stage: 'comments', items: comments.items.length, total: comments.total, closed: comments.closed }));
} catch (error) { console.error(error instanceof Error ? error.message : 'Guest compatibility check failed.'); process.exitCode = 1; }
finally { client.clear(); }
