import type { VideoCandidate } from '../shared/contracts';

export const SUBSCRIPTION_VIDEO_LIMIT = 400;

export function publicationTime(video: VideoCandidate): number {
  return typeof video.publishedAt === 'number' && Number.isFinite(video.publishedAt) && video.publishedAt >= 0
    ? video.publishedAt
    : Number.NEGATIVE_INFINITY;
}

/** Merge original uploads already admitted by the native followed-account checks. */
export function mergeSubscriptionVideos(previous: readonly VideoCandidate[], incoming: readonly VideoCandidate[], limit = SUBSCRIPTION_VIDEO_LIMIT): VideoCandidate[] {
  const indexed = new Map<string, { video: VideoCandidate; position: number }>();
  for (const video of [...previous, ...incoming]) {
    const existing = indexed.get(video.bvid);
    // A repeated upload can carry refreshed title/view data. Its original position
    // remains the deterministic tie-break when publication times are equal.
    indexed.set(video.bvid, { video, position: existing?.position ?? indexed.size });
  }
  return [...indexed.values()]
    .sort((left, right) => {
      const leftTime = publicationTime(left.video);
      const rightTime = publicationTime(right.video);
      if (leftTime !== rightTime) return leftTime > rightTime ? -1 : 1;
      return left.position - right.position;
    })
    .slice(0, limit)
    .map(({ video }) => video);
}

/** Creator libraries keep every loaded page, including videos beyond the feed's batch limit. */
export const mergeUploaderVideos = (previous: readonly VideoCandidate[], incoming: readonly VideoCandidate[]): VideoCandidate[] =>
  mergeSubscriptionVideos(previous, incoming, Number.POSITIVE_INFINITY);
