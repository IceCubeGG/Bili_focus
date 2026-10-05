import type { BrowsePreset, VideoCandidate, VideoLabels } from '../shared/contracts';
import { normalizeLabel, normalizeUploaderId } from './browse-settings';

export type VideoLabelMap = ReadonlyMap<string, VideoLabels> | Readonly<Record<string, VideoLabels>>;

/** Each configured dimension accepts any selected value. "all" combines dimensions with AND. */
export function candidateMatchesPreset(video: VideoCandidate, labels: VideoLabels | undefined, preset: BrowsePreset): boolean {
  const selectedLabels = preset.labels.map(normalizeLabel).filter(Boolean);
  const selectedUploaders = preset.uploaders.map((uploader) => normalizeUploaderId(uploader.id)).filter((id): id is string => id !== null);
  const hasLabels = selectedLabels.length > 0;
  const hasUploaders = selectedUploaders.length > 0;
  // An empty custom preset must not silently turn into an unrestricted feed.
  if (!hasLabels && !hasUploaders) return false;

  const availableLabels = labels?.status === 'ready' && labels.bvid === video.bvid
    ? new Set(labels.labels.map(normalizeLabel))
    : new Set<string>();
  const matchesLabels = hasLabels && selectedLabels.some((label) => availableLabels.has(label));
  const uploaderId = normalizeUploaderId(video.uploader.id);
  const matchesUploader = hasUploaders && uploaderId !== null && selectedUploaders.includes(uploaderId);

  if (preset.match === 'any') return matchesLabels || matchesUploader;
  return (!hasLabels || matchesLabels) && (!hasUploaders || matchesUploader);
}

export function filterCandidates(videos: readonly VideoCandidate[], labelMap: VideoLabelMap, preset: BrowsePreset | null): VideoCandidate[] {
  if (preset === null) return [...videos];
  const getLabels = (bvid: string): VideoLabels | undefined => labelMap instanceof Map
    ? labelMap.get(bvid)
    : (labelMap as Readonly<Record<string, VideoLabels>>)[bvid];
  return videos.filter((video) => candidateMatchesPreset(video, getLabels(video.bvid), preset));
}
