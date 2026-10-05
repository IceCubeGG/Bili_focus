import { useI18n } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, FolderOpen, Pencil, Plus, RefreshCw, Search, Trash2, UsersRound, X } from 'lucide-react';
import { platformBridge } from '../platform/bridge';
import { emptySubscriptionGroups, type SubscriptionSelection } from '../core/subscription-groups';
import type { FollowedUploader, SubscriptionGroup, SubscriptionGroups } from '../shared/contracts';

type Props = { selection: SubscriptionSelection; refreshRevision: number; onSelect: (selection: SubscriptionSelection, groups: SubscriptionGroups, title: string) => void };

function CreatorAvatar({ uploader }: { uploader: FollowedUploader }) {
  const { t, locale } = useI18n();
  const [failed, setFailed] = useState(false);
  return <span className="creator-avatar">{uploader.avatar && !failed ? <img src={uploader.avatar} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setFailed(true)} /> : uploader.name.slice(0, 1)}</span>;
}

export default function SubscriptionDirectory({ selection, refreshRevision, onSelect }: Props) {
  const { t, locale } = useI18n();
  const [uploaders, setUploaders] = useState<FollowedUploader[]>([]);
  const [groups, setGroups] = useState<SubscriptionGroups>(emptySubscriptionGroups);
  const [groupsReady, setGroupsReady] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<SubscriptionGroup | null>(null);
  const [saving, setSaving] = useState(false);
  const epoch = useRef(0);
  const groupRequest = useRef(0);
  const alive = useRef(true);
  const dialog = useRef<HTMLDialogElement>(null);
  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect;
  const selectionRef = useRef(selection); selectionRef.current = selection;

  async function load(reset: boolean) {
    const current = reset ? ++epoch.current : epoch.current;
    setLoading(true); setError(null);
    if (reset) { setUploaders([]); setCursor(null); setHasMore(false); }
    try {
      const page = await platformBridge.getFollowedUploaderPage({ cursor: reset ? null : cursor });
      if (!alive.current || current !== epoch.current) return;
      setUploaders(previous => [...new Map([...(reset ? [] : previous), ...page.uploaders].map(uploader => [uploader.id, uploader])).values()]);
      setCursor(page.cursor); setHasMore(page.hasMore); setTotal(page.total);
    } catch (error) { if (alive.current && current === epoch.current) setError(error instanceof Error ? error.message : 'Could not load followed uploaders.'); }
    finally { if (alive.current && current === epoch.current) setLoading(false); }
  }
  useEffect(() => {
    alive.current = true;
    void load(true);
    const currentGroups = ++groupRequest.current;
    void platformBridge.getSubscriptionGroups().then(value => {
      if (alive.current && currentGroups === groupRequest.current) {
        setGroups(value); setGroupsReady(true); setGroupError(null);
        const selected = selectionRef.current;
        if (selected.kind === 'group') onSelectRef.current(selected, value, value.groups.find(group => group.id === selected.id)?.name ?? 'Group no longer available');
      }
    }).catch(error => { if (alive.current && currentGroups === groupRequest.current) setGroupError(error instanceof Error ? error.message : 'Could not load groups.'); });
    return () => { alive.current = false; epoch.current++; groupRequest.current++; };
  }, [refreshRevision]);
  useEffect(() => { if (draft) dialog.current?.showModal(); }, [draft?.id]);

  const filtered = uploaders.filter(uploader => `${uploader.name} ${uploader.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const choose = (next: SubscriptionSelection, title: string) => onSelect(next, groups, title);
  async function save(next: SubscriptionGroups, removed = false) {
    groupRequest.current++;
    setSaving(true); setGroupError(null);
    try {
      const saved = await platformBridge.updateSubscriptionGroups(next);
      if (!alive.current) return;
      setGroups(saved); setGroupsReady(true); setDraft(null); dialog.current?.close();
      const currentSelection = selectionRef.current;
      const selected = currentSelection.kind === 'group' ? saved.groups.find(group => group.id === currentSelection.id) : null;
      if (removed && currentSelection.kind === 'group' && !selected) onSelectRef.current({ kind: 'all' }, saved, 'All followed uploaders');
      else onSelectRef.current(currentSelection, saved, selected?.name ?? (currentSelection.kind === 'uploader' ? uploaders.find(uploader => uploader.id === currentSelection.id)?.name ?? 'Selected uploader' : 'All followed uploaders'));
    } catch (error) { if (alive.current) setGroupError(error instanceof Error ? error.message : 'Could not save this group.'); }
    finally { if (alive.current) setSaving(false); }
  }

  return <aside className="subscription-directory" id="subscription-directory" aria-label={t("Followed uploaders and groups")}>
    <div className="directory-heading"><h2>{t("Subscriptions")}</h2><button className="icon-button" title={t("Refresh followed uploaders")} aria-label={t("Refresh followed uploaders")} disabled={loading} onClick={() => void load(true)}><RefreshCw size={17} className={loading ? 'spin' : ''} /></button></div>
    <button className={`directory-choice all-followed ${selection.kind === 'all' ? 'selected' : ''}`} aria-pressed={selection.kind === 'all'} onClick={() => choose({ kind: 'all' }, 'All followed uploaders')}><UsersRound size={21} /><span>{t("All followed uploaders")}</span></button>
    <div className="directory-section-heading"><h3>{t("Groups")}</h3><button className="text-button new-subscription-group" disabled={!groupsReady || saving || groups.groups.length >= 30} onClick={() => setDraft({ id: crypto.randomUUID(), name: '', uploaderIds: [] })}><Plus size={15} />{t("New group")}</button></div>
    {groupError && <p className="directory-error" role="alert">{t(groupError)}</p>}
    {groups.groups.length === 0 && groupsReady && <p className="directory-hint">{t("Make lists for topics or favorites. A creator can belong to several groups.")}</p>}
    <div className="directory-groups">{groups.groups.map(group => <div className="directory-group-row" key={group.id}>
      <button className={`directory-choice ${selection.kind === 'group' && selection.id === group.id ? 'selected' : ''}`} aria-pressed={selection.kind === 'group' && selection.id === group.id} data-group-id={group.id} onClick={() => choose({ kind: 'group', id: group.id }, group.name)}><FolderOpen size={19} /><span>{group.name}<small>{group.uploaderIds.length} {t("members")}</small></span></button>
      <button className="icon-button edit-subscription-group" aria-label={t("Edit {0}", { 0: group.name })} disabled={saving} onClick={() => setDraft(structuredClone(group))}><Pencil size={15} /></button>
    </div>)}</div>
    <div className="directory-section-heading"><h3>{t("Followed uploaders")}</h3><small>{uploaders.length} / {total}</small></div>
    <label className="directory-search"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t("Search loaded names or UIDs")} aria-label={t("Search followed uploaders")} /></label>
    {error && <div className="directory-error" role="alert"><p>{t(error)}</p><button className="text-button" disabled={loading} onClick={() => void load(cursor === null)}>{t("Try again")}</button></div>}
    <div className="directory-uploaders">{filtered.map(uploader => <button key={uploader.id} data-followed-uid={uploader.id} className={`directory-choice ${selection.kind === 'uploader' && selection.id === uploader.id ? 'selected' : ''}`} aria-pressed={selection.kind === 'uploader' && selection.id === uploader.id} onClick={() => choose({ kind: 'uploader', id: uploader.id }, uploader.name)}><CreatorAvatar uploader={uploader} /><span title={uploader.name}>{uploader.name}</span>{selection.kind === 'uploader' && selection.id === uploader.id && <Check size={16} />}</button>)}</div>
    {loading && <p className="directory-hint" role="status">{t("Loading followed uploaders…")}</p>}
    {!loading && !error && !filtered.length && <p className="directory-hint">{query ? t("No matching loaded uploaders. Try another name, or load more.") : t("No followed uploaders in this batch.")}</p>}
    {hasMore && <button className="text-button directory-more" disabled={loading} onClick={() => void load(false)}><ChevronDown size={16} />{t("Load more uploaders")}</button>}
    <dialog className="subscription-group-dialog" ref={dialog} onCancel={event => { if (saving) event.preventDefault(); else setDraft(null); }}>
      {draft && <form onSubmit={event => { event.preventDefault(); void save({ version: 1, groups: [...groups.groups.filter(group => group.id !== draft.id), draft] }); }}>
        <div className="directory-heading"><h2>{groups.groups.some(group => group.id === draft.id) ? t("Edit group") : t("Create group")}</h2><button type="button" className="icon-button" aria-label={t("Close group editor")} disabled={saving} onClick={() => { dialog.current?.close(); setDraft(null); }}><X size={20} /></button></div>
        <label className="field-label">{t("Group name")}<input autoFocus required maxLength={80} value={draft.name} disabled={saving} onChange={event => { const name = event.target.value; setDraft(previous => previous ? { ...previous, name } : null); }} placeholder={t("For example, Science")} /></label>
        <p className="directory-hint">{t("Select followed creators. Load more uploaders in the list before editing if someone is missing. Groups are local to this account and device; they do not change Bilibili follows.")}</p>
        <div className="group-member-choices">{uploaders.map(uploader => <label key={uploader.id}><input type="checkbox" checked={draft.uploaderIds.includes(uploader.id)} disabled={saving} onChange={event => { const checked = event.target.checked; setDraft(previous => previous ? { ...previous, uploaderIds: checked ? [...previous.uploaderIds, uploader.id] : previous.uploaderIds.filter(id => id !== uploader.id) } : null); }} /><CreatorAvatar uploader={uploader} /><span>{uploader.name}</span></label>)}
          {draft.uploaderIds.filter(id => !uploaders.some(uploader => uploader.id === id)).map(id => <label key={id}><input type="checkbox" checked disabled={saving} onChange={() => setDraft(previous => previous ? { ...previous, uploaderIds: previous.uploaderIds.filter(value => value !== id) } : null)} /><span>UID {id} {t("— not in the loaded list")}</span></label>)}
        </div>
        {groupError && <p className="directory-error" role="alert">{t(groupError)}</p>}
        <div className="group-editor-actions"><button type="submit" className="button primary save-subscription-group" disabled={saving || !draft.name.trim()}>{saving ? t("Saving…") : t("Save group")}</button>{groups.groups.some(group => group.id === draft.id) && <button type="button" className="button secondary delete-subscription-group" disabled={saving} onClick={() => { if (confirm(t("Delete the group “{0}”? This does not unfollow any creators.", { 0: draft.name }))) void save({ version: 1, groups: groups.groups.filter(group => group.id !== draft.id) }, true); }}><Trash2 size={16} />{t("Delete group")}</button>}</div>
      </form>}
    </dialog>
  </aside>;
}
