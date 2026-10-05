import type { BrowsePreset, BrowseSettings } from '../shared/contracts';

const MAX_PRESETS = 20;
const MAX_LABELS = 30;
const MAX_UPLOADERS = 50;
const MAX_NAME_LENGTH = 80;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function normalizeLabel(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeUploaderId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  if (!/^\d{1,20}$/.test(id)) return null;
  const normalized = id.replace(/^0+/, '');
  return normalized || null;
}

function presetId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

function sanitizePreset(value: unknown): BrowsePreset | null {
  const data = record(value);
  const id = presetId(data?.id);
  if (!data || !id) return null;
  const labels: string[] = [];
  const seenLabels = new Set<string>();
  if (Array.isArray(data.labels)) {
    for (const value of data.labels) {
      if (typeof value !== 'string') continue;
      const label = value.trim();
      const normalized = normalizeLabel(label);
      if (!label || label.length > MAX_NAME_LENGTH || seenLabels.has(normalized)) continue;
      seenLabels.add(normalized);
      labels.push(label);
      if (labels.length === MAX_LABELS) break;
    }
  }
  const uploaders: BrowsePreset['uploaders'] = [];
  const seenUploaders = new Set<string>();
  if (Array.isArray(data.uploaders)) {
    for (const value of data.uploaders) {
      const uploader = record(value);
      const uploaderId = normalizeUploaderId(uploader?.id);
      if (!uploader || !uploaderId || seenUploaders.has(uploaderId)) continue;
      seenUploaders.add(uploaderId);
      uploaders.push({
        id: uploaderId,
        name: typeof uploader.name === 'string' ? uploader.name.trim().slice(0, MAX_NAME_LENGTH) : '',
      });
      if (uploaders.length === MAX_UPLOADERS) break;
    }
  }
  return {
    id,
    name: typeof data.name === 'string' && data.name.trim() ? data.name.trim().slice(0, MAX_NAME_LENGTH) : 'Untitled preset',
    labels,
    uploaders,
    match: data.match === 'any' ? 'any' : 'all',
  };
}

export function sanitizeBrowseSettings(value: unknown): BrowseSettings {
  const data = record(value);
  const presets: BrowsePreset[] = [];
  const seenIds = new Set<string>();
  if (Array.isArray(data?.presets)) {
    for (const value of data.presets) {
      const preset = sanitizePreset(value);
      if (!preset || seenIds.has(preset.id)) continue;
      seenIds.add(preset.id);
      presets.push(preset);
      if (presets.length === MAX_PRESETS) break;
    }
  }
  const requestedActiveId = presetId(data?.activePresetId);
  return {
    version: 1,
    activePresetId: requestedActiveId && seenIds.has(requestedActiveId) ? requestedActiveId : null,
    presets,
  };
}
