import { describe, expect, it } from 'vitest';
import { sanitizeBrowseSettings } from '../src/core/browse-settings';
import { DEFAULT_BROWSE_SETTINGS } from '../src/shared/contracts';

const preset = (id: string) => ({ id, name: `Preset ${id}`, labels: [], uploaders: [], match: 'all' });

describe('browse preset validation', () => {
  it.each([null, undefined, [], 'browse', 42])('recovers an invalid settings document: %j', (value) => {
    expect(sanitizeBrowseSettings(value)).toEqual(DEFAULT_BROWSE_SETTINGS);
  });

  it('keeps only public settings and deduplicates exact normalized labels and uploader IDs', () => {
    expect(sanitizeBrowseSettings({
      version: 99,
      activePresetId: ' study ',
      token: 'secret',
      presets: [{
        id: ' study ', name: ' Study ', match: 'any', labels: [' Math ', 'MATH', 'Mathematics', '', 3],
        uploaders: [{ id: '00123', name: ' Teacher ' }, { id: '123', name: 'Duplicate' }, { id: '456', name: 'Other', cookie: 'secret' }],
        cookie: 'secret',
      }],
    })).toEqual({
      version: 1, activePresetId: 'study', presets: [{
        id: 'study', name: 'Study', match: 'any', labels: ['Math', 'Mathematics'],
        uploaders: [{ id: '123', name: 'Teacher' }, { id: '456', name: 'Other' }],
      }],
    });
  });

  it('drops invalid and duplicate stable IDs and clears a deleted active preset', () => {
    const result = sanitizeBrowseSettings({ activePresetId: 'deleted', presets: [
      preset('one'), preset('one'), preset('with space'), preset(''), preset('x'.repeat(65)), {}, [], preset('two'),
    ] });
    expect(result.activePresetId).toBeNull();
    expect(result.presets.map((item) => item.id)).toEqual(['one', 'two']);
  });

  it('limits saved presets, labels, uploaders and display names without accepting malformed IDs', () => {
    const result = sanitizeBrowseSettings({ activePresetId: 'p21', presets: Array.from({ length: 25 }, (_, index) => ({
      ...preset(`p${index}`), name: 'N'.repeat(100), match: 'unsupported',
      labels: ['', 'L'.repeat(81), ...Array.from({ length: 40 }, (_, label) => `Label ${label}`)],
      uploaders: [{ id: '0' }, { id: '-1' }, { id: 42 }, { id: '1'.repeat(21) }, ...Array.from({ length: 60 }, (_, uid) => ({ id: String(uid + 1), name: 'U'.repeat(100) }))],
    })) });
    expect(result.presets).toHaveLength(20);
    expect(result.activePresetId).toBeNull();
    expect(result.presets[0]).toMatchObject({ name: 'N'.repeat(80), match: 'all' });
    expect(result.presets[0].labels).toHaveLength(30);
    expect(result.presets[0].labels[0]).toBe('Label 0');
    expect(result.presets[0].uploaders).toHaveLength(50);
    expect(result.presets[0].uploaders[0]).toEqual({ id: '1', name: 'U'.repeat(80) });
  });

  it('returns fresh nested data so callers cannot mutate persisted input', () => {
    const original = { activePresetId: 'one', presets: [{ ...preset('one'), labels: ['Math'], uploaders: [{ id: '1', name: 'Teacher' }] }] };
    const sanitized = sanitizeBrowseSettings(original);
    sanitized.presets[0].labels.push('Music');
    sanitized.presets[0].uploaders[0].name = 'Changed';
    expect(original.presets[0].labels).toEqual(['Math']);
    expect(original.presets[0].uploaders[0].name).toBe('Teacher');
    expect(sanitizeBrowseSettings({ presets: [{ id: 'one' }] }).presets[0].name).toBe('Untitled preset');
  });
});
