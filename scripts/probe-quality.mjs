// Guest-only diagnostic: no saved session, cookies, or signed CDN URLs are logged.
import { build } from 'esbuild';

const compiled = await build({ entryPoints: ['src/electron/video-client.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const { VideoClient } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const describeTrack = raw => ({
  quality: raw.id, codec: raw.codecs, mimeType: raw.mimeType ?? raw.mime_type,
  width: raw.width, height: raw.height, bandwidth: raw.bandwidth,
  initialization: raw.SegmentBase?.Initialization ?? raw.segment_base?.initialization,
  indexRange: raw.SegmentBase?.indexRange ?? raw.segment_base?.index_range,
  backups: Array.isArray(raw.backupUrl ?? raw.backup_url) ? (raw.backupUrl ?? raw.backup_url).length : 0,
});
const request = async (url, init) => {
  const response = await fetch(url, init);
  if (new URL(url).pathname === '/x/player/wbi/playurl') {
    const result = await response.clone().json(), data = result.data ?? {};
    console.log(JSON.stringify({ guestOnly: true, stage: 'api', code: result.code,
      quality: data.quality, acceptQuality: data.accept_quality, format: data.format,
      durationSeconds: data.dash?.duration, preview: data.is_preview,
      video: data.dash?.video?.map(describeTrack), audio: data.dash?.audio?.map(describeTrack),
      progressiveSegments: data.durl?.length,
    }));
  }
  return response;
};
const client = new VideoClient(() => null, () => 0, request);
async function range(url, label, byteRange = 'bytes=0-65535') {
  const response = await client.stream(new Request(url, { headers: { Range: byteRange } }));
  const bytes = new Uint8Array(await response.arrayBuffer());
  console.log(JSON.stringify({ guestOnly: true, stage: 'range', label, requested: byteRange, status: response.status,
    mime: response.headers.get('Content-Type'), contentRange: response.headers.get('Content-Range'),
    bytes: bytes.byteLength, firstBox: bytes.byteLength >= 8 ? new TextDecoder().decode(bytes.subarray(4, 8)) : null,
  }));
  if (response.status !== 206 || !bytes.byteLength) throw new Error(`Media range failed for ${label}.`);
}
try {
  const bvid = process.argv.slice(2).find(value => !value.startsWith('--')) ?? 'BV1xx411c7mD';
  const details = await client.getVideoDetails({ bvid }), cid = details.parts[0].cid;
  for (const options of [{ format: 'progressive', quality: 64 }, { quality: 64 }, { quality: 120 }]) {
    let playback;
    try {
      playback = await client.getVideoPlayback({ bvid, cid, ...options });
      console.log(JSON.stringify({ guestOnly: true, stage: 'playback', requested: options.quality,
        format: playback.dash ? 'dash' : 'progressive', quality: playback.quality, qualityLabel: playback.qualityLabel,
        available: playback.qualities.map(choice => choice.label),
      }));
      if (playback.dash) {
        const video = playback.dash.video.find(track => track.quality === playback.quality && track.codecs.startsWith('avc1')) ?? playback.dash.video.find(track => track.quality === playback.quality);
        const audio = playback.dash.audio[0];
        for (const [label, track] of [['video', video], ['audio', audio]]) {
          if (!track) throw new Error(`Missing ${label} track.`);
          await range(track.url, label);
          await range(track.url, `${label}-initialization`, `bytes=${track.initialization}`);
          await range(track.url, `${label}-index`, `bytes=${track.indexRange}`);
        }
      } else {
        await range(playback.sources[0].url, 'progressive');
      }
    } finally {
      if (playback) client.releaseVideoPlayback({ handle: playback.handle });
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Guest quality check failed.');
  process.exitCode = 1;
} finally {
  client.clear();
}
