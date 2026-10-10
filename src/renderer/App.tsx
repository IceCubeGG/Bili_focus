import { useI18n } from './i18n';
import { LanguageContext } from './i18n';
import { translator } from '../core/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowRight, Check, CheckCircle2, CircleHelp, Clock3, Compass, Download, ExternalLink,
  FolderClosed, Heart, LoaderCircle, LockKeyhole, LogOut,
  Monitor, MonitorPlay, Moon, Palette, QrCode, RefreshCw,
  Search, Settings2, ShieldCheck, Sun,
  UserRound, UsersRound, WifiOff, X,
} from 'lucide-react';
import { DEFAULT_SETTINGS } from '../shared/contracts';
import type { AccountSnapshot, AppSettings, AppTab, LoginMethod, LoginSnapshot, PlatformInfo } from '../shared/contracts';
import { platformBridge, platformKind } from '../platform/bridge';
import BrowsePage from './BrowsePage';
import SearchPage from './SearchPage';
import SubscribePage from './SubscribePage';
import VideoPage from './VideoPage';
import DownloadsPanel from './DownloadsPanel';

const EMPTY_ACCOUNT: AccountSnapshot = {
  status: 'signed-out', profile: null, lastCheckedAt: null,
  message: null,
  secureStorage: false,
};
const EMPTY_LOGIN: LoginSnapshot = { status: 'idle', qrDataUrl: null, expiresAt: null, message: null };

type Notice = { message: string; tone: 'success' | 'error' };

function formatChecked(timestamp: number | null, locale: string): string {
  if (!timestamp) return 'Not checked yet';
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(timestamp);
}

function AccountAvatar({ account, size = 'small' }: { account: AccountSnapshot; size?: 'small' | 'large' }) {
  const { t, locale } = useI18n();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [account.profile?.avatar]);
  return <span className={`account-avatar ${size}`}>
    {account.profile?.avatar && !failed
      ? <img src={account.profile.avatar} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      : <UserRound aria-hidden="true" />}
    {size === 'large' && account.status === 'signed-in' && <span className="avatar-check"><Check size={12} /></span>}
  </span>;
}

function StatusBadge({ account }: { account: AccountSnapshot }) {
  const { t, locale } = useI18n();
  const labels: Record<AccountSnapshot['status'], string> = {
    'signed-out': 'Signed out', 'checking': 'Checking session', 'signed-in': 'Connected',
    'expired': 'Session expired', 'offline': 'Connection unavailable',
  };
  return <span className={`status-badge ${account.status}`}><span />{t(labels[account.status])}</span>;
}

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  const { t, locale } = useI18n();
  return <section className="empty-state" aria-label={t(title)}>
    <div className="empty-state-icon">{icon}</div>
    <h2>{t(title)}</h2>
    <p>{t(description)}</p>
    {action && <div className="empty-state-action">{action}</div>}
  </section>;
}

export function LoadingState({ label = 'Getting everything ready…' }: { label?: string }) {
  const { t, locale } = useI18n();
  return <div className="loading-state" role="status"><LoaderCircle className="spin" size={24} /><p>{t(label)}</p></div>;
}

export function ErrorState({ title = 'Something did not load', description, retry }: { title?: string; description: string; retry?: () => void }) {
  const { t, locale } = useI18n();
  return <EmptyState icon={<WifiOff />} title={title} description={description}
    action={retry && <button className="button secondary" onClick={retry}><RefreshCw size={16} />{t("Try again")}</button>} />;
}

function OptionsPage({ account, settings, platform, working, updateSettings, startLogin, refreshAccount, signOut }: {
  account: AccountSnapshot; settings: AppSettings; platform: PlatformInfo; working: string | null;
  updateSettings: (patch: Partial<Omit<AppSettings, 'version'>>) => void;
  startLogin: (method: LoginMethod) => void; refreshAccount: () => void; signOut: () => void;
}) {
  const { t, locale } = useI18n();
  const hasSession = Boolean(account.profile) || ['signed-in', 'expired', 'offline', 'checking'].includes(account.status);
  const native = platform.kind !== 'browser';
  const canSignIn = !working && account.secureStorage;
  return <>
    <div className="page-heading"><div><div className="eyebrow"><span className="pink-line" />{t("SETTLE IN")}</div><h1>{t("A space of your own")}<span className="pink-text">.</span></h1><p>{t("Your account, your preferences, your way of watching.")}</p></div><span className="local-settings-note"><ShieldCheck size={15} />{t("Settings stay on this device")}</span></div>
    <div className="options-layout">
      <section className="settings-card account-card" aria-labelledby="account-title">
        <div className="settings-card-heading"><div className="card-heading-icon"><UserRound size={18} /></div><h2 id="account-title">{t("Bilibili account")}</h2><StatusBadge account={account} /></div>
        <div className="account-summary"><AccountAvatar account={account} size="large" /><div><h3>{account.profile?.name ?? t("Welcome to your space")}</h3><p>{account.profile ? `UID ${account.profile.uid} · ${t("Level")} ${account.profile.level}${account.profile.isVip ? ` · ${t('Bilibili VIP')}` : ''}` : t("Choose QR, password, or SMS sign-in through Bilibili.")}</p></div></div>
        {account.message && <div className={`account-message ${account.status === 'expired' || account.status === 'offline' ? 'warning' : ''}`} role="status">{account.status === 'offline' ? <WifiOff size={16} /> : <CircleHelp size={16} />}<p>{t(account.message)}</p></div>}
        {account.status !== 'signed-in' && <section className="login-methods" aria-labelledby="login-method-title">
          <h3 id="login-method-title">{account.status === 'expired' ? t("Choose how to sign in again") : t("Choose how to sign in")}</h3>
          <div className="login-method-grid">
            <button className="login-method-button" onClick={() => startLogin('qr')} disabled={!canSignIn || !platform.loginMethods.includes('qr')} aria-describedby={!native ? 'login-unavailable' : undefined}>
              <span className="login-method-icon"><QrCode size={23} /></span><span><strong>{t("QR code")}</strong><span>{native && !platform.loginMethods.includes('qr') ? t("Use password or SMS on this device") : platform.kind === 'android' ? t("Scan with Bilibili on another device") : t("Scan with the Bilibili app")}</span></span><ArrowRight size={17} />
            </button>
            <button className="login-method-button" onClick={() => startLogin('web')} disabled={!canSignIn || !platform.loginMethods.includes('web')} aria-describedby={!native ? 'login-unavailable' : undefined}>
              <span className="login-method-icon"><ExternalLink size={22} /></span><span><strong>{t("Password or SMS")}</strong><span>{t("Sign in on Bilibili’s own page")}</span></span><ArrowRight size={17} />
            </button>
          </div>
          <p className="login-method-note" id="login-unavailable">{!native ? t("This is an interface preview. Account sign-in requires a native app with encrypted session storage.") : t("Password, phone number, verification code, and verification challenges are entered only on Bilibili’s official sign-in page.")}</p>
        </section>}
        <div className="account-actions">
          {native && <button className="button secondary" onClick={refreshAccount} disabled={Boolean(working)}><RefreshCw size={16} className={working === 'refresh' ? 'spin' : ''} />{working === 'refresh' ? t("Checking…") : t("Refresh status")}</button>}
          {hasSession && <button className="button subtle" onClick={signOut} disabled={Boolean(working)}>{working === 'sign-out' ? <LoaderCircle className="spin" size={16} /> : <LogOut size={16} />}{t("Sign out")}</button>}
        </div>
        <div className="account-footnote"><span><Clock3 size={13} />{t("Last checked:")} {t(formatChecked(account.lastCheckedAt, locale))}</span><span>{t("Account management is ready")}</span></div>
      </section>
      <section className="settings-card privacy-card">
        <div className={`security-icon ${account.secureStorage ? '' : 'unavailable'}`}><ShieldCheck size={27} /></div>
        <h2>{account.secureStorage ? t("Your session stays private") : native ? t("Secure storage unavailable") : t("Native sign-in required")}</h2>
        <p>{account.secureStorage ? t("Session credentials are encrypted by your operating system. They never enter this interface or your settings file.") : native ? t("Sign-in is disabled until operating-system encrypted storage is available. Your credentials will not be saved as plain text.") : t("This browser preview shows the interface. A native Bili Focus app connects your account using encrypted storage.")}</p>
        <div className="security-detail"><LockKeyhole size={15} /><span>{account.secureStorage ? t("Encrypted local session storage") : native ? t("Encrypted storage required") : t("No session stored in the browser")}</span></div>
      </section>
      <section className="settings-card appearance-card" aria-labelledby="appearance-title">
        <div className="settings-card-heading"><div className="card-heading-icon"><Palette size={18} /></div><h2 id="appearance-title">{t("Make it feel right")}</h2><span className="quiet-label">{t("APPEARANCE")}</span></div>
        <div className="setting-row"><div><h3>{t("Theme")}</h3><p>{t("Choose a mood, or follow your device.")}</p></div><div className="theme-selector" role="group" aria-label={t("Appearance theme")}>{([['system', 'System', Monitor], ['light', 'Light', Sun], ['dark', 'Dark', Moon]] as const).map(([value, label, Icon]) => <button key={value} onClick={() => updateSettings({ appearance: value })} aria-pressed={settings.appearance === value} className={settings.appearance === value ? 'selected' : ''}><Icon size={15} /><span>{t(label)}</span></button>)}</div></div>
        <div className="setting-row"><div><h3>{t("Compact video cards")}</h3><p>{t("Keep more of your video feeds in view.")}</p></div><button className="switch" role="switch" aria-checked={settings.compactCards} aria-label={t("Compact video cards")} onClick={() => updateSettings({ compactCards: !settings.compactCards })}><span /></button></div>
        <div className="setting-row"><div><h3>{t("Interface language")}</h3><p>{t("Choose the language used throughout the app.")}</p></div><select className="language-select" aria-label={t("Interface language")} data-testid="interface-language" value={settings.language} onChange={event => updateSettings({ language: event.target.value === "zh-CN" ? "zh-CN" : "en" })}><option value="en">English</option><option value="zh-CN">简体中文</option></select></div>
      </section>
      <DownloadsPanel />
    </div>
  </>;
}

function LoginModal({ login, method, account, startLogin, close }: { login: LoginSnapshot; method: LoginMethod; account: AccountSnapshot; startLogin: () => void; close: () => void }) {
  const { t, locale } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key !== 'Tab') return;
      const items = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex="0"]');
      if (!items?.length) return;
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { document.removeEventListener('keydown', onKeyDown); window.clearInterval(interval); previousFocus?.focus(); };
  }, [close]);
  const seconds = login.expiresAt ? Math.max(0, Math.ceil((login.expiresAt - now) / 1000)) : 0;
  const web = method === 'web';
  const active = ['generating', 'waiting', 'scanned'].includes(login.status);
  const opening = login.status === 'opening';
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="login-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="login-title" aria-describedby="login-description">
      <button className="icon-button modal-close" ref={closeButtonRef} onClick={close} aria-label={t("Close sign-in")}><X size={20} /></button>
      <div className="modal-brand-icon"><MonitorPlay size={25} /></div>
      <span className="eyebrow">{t("WELCOME TO BILI FOCUS")}</span>
      <h2 id="login-title">{login.status === 'success' ? t("You’re all connected") : t("Your account. Your space.")}</h2>
      <p id="login-description">{login.status === 'success' ? t("Welcome, {0}. Your Bilibili session is securely saved on this device.", { 0: account.profile?.name ?? 'friend' }) : web ? t("Use password or SMS sign-in on the official Bilibili screen. Complete any verification there, then return here.") : platformKind === 'android' ? t("Scan this code with the Bilibili app on another device, then confirm sign-in there.") : t("Open the Bilibili mobile app, scan this QR code, then confirm sign-in on your phone.")}</p>
      {web ? <div className={`web-login-panel ${login.status === 'success' ? 'success' : ''}`}>
        {login.status === 'success' ? <CheckCircle2 size={58} strokeWidth={1.3} /> : opening ? <LoaderCircle className="spin" size={42} strokeWidth={1.3} /> : <ExternalLink size={42} strokeWidth={1.3} />}
        <strong>{login.status === 'success' ? t("Your account is connected") : opening ? t("Opening Bilibili sign-in…") : login.status === 'error' ? t("Sign-in needs another try") : t("Continue on Bilibili’s sign-in screen")}</strong>
        {login.status !== 'success' && <span>{t("Select Password or SMS on Bilibili’s page. Your session connects automatically after sign-in.")}</span>}
      </div> : <div className={`qr-container ${login.status === 'success' ? 'success' : ''}`}>
        {login.status === 'generating' || login.status === 'idle' ? <LoadingState label={t("Creating a secure QR code…")} />
          : login.status === 'success' ? <CheckCircle2 size={66} strokeWidth={1.3} />
          : login.status === 'expired' || login.status === 'error' ? <div className="qr-unavailable"><QrCode size={45} strokeWidth={1.3} /><span>{login.status === 'expired' ? t("QR code expired") : t("Could not create a QR code")}</span></div>
          : login.qrDataUrl ? <img src={login.qrDataUrl} alt={t("Bilibili sign-in QR code")} />
          : <LoadingState label={t("Preparing your QR code…")} />}
      </div>}
      <div className={`login-state ${login.status}`} role="status">
        {login.status === 'web-login' ? <><span className="waiting-dot" />{t("Waiting for Bilibili sign-in")}</>
          : login.status === 'waiting' ? <><span className="waiting-dot" />{t("Waiting for you to scan")}{seconds > 0 && <span className="qr-timer">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>}</>
          : login.status === 'scanned' ? <><CheckCircle2 size={16} />{t("Scanned — confirm in the Bilibili app")}</>
          : login.status === 'success' ? <><ShieldCheck size={16} />{t("Session saved securely")}</>
          : login.status === 'expired' ? web ? t("Reopen sign-in to continue.") : t("Generate a fresh code to continue.")
          : login.status === 'error' ? t(login.message ?? 'Please try again.')
          : <><LoaderCircle className="spin" size={15} />{t("Connecting to Bilibili…")}</>}
      </div>
      {login.message && login.status !== 'error' && login.status !== 'success' && <p className="login-message">{t(login.message)}</p>}
      <div className="modal-actions">{login.status === 'success'
        ? <button className="button primary" onClick={close}>{t("Make yourself at home")}<ArrowRight size={16} /></button>
        : <><button className="button secondary" onClick={close}>{t("Cancel")}</button>{web ? <button className="button primary" onClick={startLogin} disabled={opening}><ExternalLink size={16} />{opening ? t("Opening…") : t("Reopen sign-in")}</button> : !active && <button className="button primary" onClick={startLogin}><RefreshCw size={16} />{t("New QR code")}</button>}</>}
      </div>
      <div className="login-security"><LockKeyhole size={13} />{web ? t("Credentials stay on Bilibili. Session encrypted on this device.") : t("No password needed. Encrypted on this device.")}</div>
    </div>
  </div>;
}

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const t = translator(settings.language);
  useEffect(() => { document.documentElement.lang = settings.language === 'zh-CN' ? 'zh-CN' : 'en'; }, [settings.language]);
  const [platform, setPlatform] = useState<PlatformInfo>({ kind: platformKind, loginMethods: [] });
  const [account, setAccount] = useState<AccountSnapshot>(EMPTY_ACCOUNT);
  const [login, setLogin] = useState<LoginSnapshot>(EMPTY_LOGIN);
  const [loginMethod, setLoginMethod] = useState<LoginMethod>('qr');
  const [ready, setReady] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [search, setSearch] = useState<{ scroll: number } | null>(null);
  const searchRef = useRef(search); searchRef.current = search;
  const [watch, setWatch] = useState<{ bvid: string; source: AppTab | 'search'; scroll: number } | null>(null);
  const watchRef = useRef(watch); watchRef.current = watch;
  const feedFocus = useRef<HTMLElement | null>(null);
  const settingRevision = useRef(0);
  const loginRevision = useRef(0);

  useEffect(() => { window.scrollTo({ top: 0, left: 0 }); }, [settings.lastTab]);

  useEffect(() => {
    let mounted = true;
    const offAccount = platformBridge.onAccountChanged(snapshot => { if (mounted) setAccount(snapshot); });
    const offLogin = platformBridge.onLoginChanged(snapshot => {
      if (!mounted) return;
      setLogin(snapshot);
      if (snapshot.method) setLoginMethod(snapshot.method);
      // Starting a method resets the previous attempt with an ordinary idle event.
      // Only the explicit native-window dismissal closes an open dialog here.
      if (snapshot.status === 'idle' && snapshot.message) setLoginOpen(false);
    });
    void Promise.allSettled([platformBridge.getPlatform(), platformBridge.getSettings(), platformBridge.getAccount(), platformBridge.getLogin()]).then(([device, saved, current, currentLogin]) => {
      if (!mounted) return;
      if (device.status === 'fulfilled') setPlatform(device.value);
      else setNotice({ tone: 'error', message: 'Sign-in methods could not be loaded. Restart the app and try again.' });
      if (saved.status === 'fulfilled') setSettings(saved.value);
      else setNotice({ tone: 'error', message: 'Could not load your preferences. Changes may not be saved.' });
      if (current.status === 'fulfilled') setAccount(current.value);
      else setAccount({ ...EMPTY_ACCOUNT, status: 'offline', message: 'The account service could not be reached. Restart the app and try again.' });
      if (currentLogin.status === 'fulfilled') {
        setLogin(currentLogin.value);
        if (currentLogin.value.method) setLoginMethod(currentLogin.value.method);
        if (['generating', 'waiting', 'scanned', 'opening', 'web-login'].includes(currentLogin.value.status)) setLoginOpen(true);
      }
      setReady(true);
    });
    return () => { mounted = false; offAccount(); offLogin(); };
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => { document.documentElement.dataset.theme = settings.appearance === 'system' ? (media.matches ? 'dark' : 'light') : settings.appearance; };
    applyTheme();
    media.addEventListener('change', applyTheme);
    return () => media.removeEventListener('change', applyTheme);
  }, [settings.appearance]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const updateSettings = useCallback((patch: Partial<Omit<AppSettings, 'version'>>) => {
    const revision = ++settingRevision.current;
    setSettings(previous => ({ ...previous, ...patch }));
    void platformBridge.updateSettings(patch).then(saved => {
      if (revision === settingRevision.current) setSettings(saved);
    }).catch(() => setNotice({ tone: 'error', message: 'Could not save that preference. Please try again.' }));
  }, []);

  const navigate = useCallback((tab: AppTab) => {
    setWatch(null); setSearch(null); const url = new URL(location.href); url.hash = ''; history.replaceState(null, '', url.href);
    updateSettings({ lastTab: tab });
  }, [updateSettings]);
  const openVideo = useCallback((bvid: string) => {
      const current = watchRef.current, url = new URL(location.href); url.hash = `watch/${bvid}`;
      if (current) { history.replaceState({ biliVideo: true }, '', url.href); setWatch({ ...current, bvid }); }
      else {
      feedFocus.current = document.activeElement as HTMLElement | null;
      history.pushState({ biliVideo: true }, '', url.href);
      setWatch({ bvid, source: searchRef.current ? 'search' : settings.lastTab, scroll: window.scrollY });
      }
    window.scrollTo(0, 0);
  }, [settings.lastTab]);
  const returnToFeed = useCallback(() => {
    const current = watchRef.current; setWatch(null);
    if (current) requestAnimationFrame(() => { window.scrollTo(0, current.scroll); feedFocus.current?.focus({ preventScroll: true }); });
  }, []);
  const closeVideo = useCallback(() => { if (history.state?.biliVideo) history.back(); else returnToFeed(); }, [returnToFeed]);
  const returnFromSearch = useCallback(() => {
    const current = searchRef.current; setSearch(null);
    if (current) requestAnimationFrame(() => { window.scrollTo(0, current.scroll); document.querySelector<HTMLButtonElement>('.open-search')?.focus({ preventScroll: true }); });
  }, []);
  const closeSearch = useCallback(() => { if (history.state?.biliSearch) history.back(); else returnFromSearch(); }, [returnFromSearch]);
  const openSearch = () => {
    if (search || watch) return;
    const url = new URL(location.href); url.hash = 'search'; history.pushState({ biliSearch: true }, '', url.href);
    setSearch({ scroll: window.scrollY }); window.scrollTo(0, 0);
  };
  useEffect(() => {
    const back = () => { if (watchRef.current) returnToFeed(); else if (searchRef.current) returnFromSearch(); };
    window.addEventListener('popstate', back); return () => window.removeEventListener('popstate', back);
  }, [returnToFeed, returnFromSearch]);
  const startLogin = useCallback((method: LoginMethod) => {
    if (!platform.loginMethods.includes(method) || !account.secureStorage) return;
    const revision = ++loginRevision.current;
    setLoginMethod(method);
    setLoginOpen(true);
    setLogin({ ...EMPTY_LOGIN, method, status: method === 'web' ? 'opening' : 'generating' });
    void (method === 'web' ? platformBridge.startWebLogin() : platformBridge.startLogin()).then(snapshot => {
      if (revision === loginRevision.current) setLogin(snapshot);
    }).catch(() => {
      if (revision === loginRevision.current) setLogin({ ...EMPTY_LOGIN, method, status: 'error', message: 'Bilibili sign-in could not be reached. Please try again.' });
    });
  }, [account.secureStorage, platform.loginMethods]);
  const closeLogin = useCallback(() => {
    const revision = ++loginRevision.current;
    setLoginOpen(false);
    void platformBridge.cancelLogin().then(snapshot => {
      if (revision === loginRevision.current) setLogin(snapshot);
    }).catch(() => setNotice({ tone: 'error', message: 'Sign-in could not be closed. Please close the Bilibili window and try again.' }));
  }, []);
  const refreshAccount = useCallback(() => {
    if (platform.kind === 'browser') return;
    setWorking('refresh');
    void platformBridge.refreshAccount().then(snapshot => {
      setAccount(snapshot);
      if (snapshot.status === 'signed-in') setNotice({ tone: 'success', message: 'Your Bilibili account is connected.' });
    }).catch(() => setNotice({ tone: 'error', message: 'Could not check your account. Please try again.' })).finally(() => setWorking(null));
  }, [platform.kind]);
  const signOut = useCallback(() => {
    if (platform.kind === 'browser') return;
    setWorking('sign-out');
    void platformBridge.signOut().then(snapshot => {
      setAccount(snapshot);
      setNotice({ tone: 'success', message: 'Signed out. Your saved session was removed from this device.' });
    }).catch(() => setNotice({ tone: 'error', message: 'Could not finish signing out. Please try again.' })).finally(() => setWorking(null));
  }, [platform.kind]);

  return <LanguageContext.Provider value={settings.language}><div className="app-shell">
    <header className="topbar"><div className="topbar-left"><button className="profile-button" onClick={() => navigate('options')} disabled={!ready} aria-label={account.profile ? t("Account settings for {0}", { 0: account.profile.name }) : t("Open account settings")} title={account.profile?.name ?? t("Your account")}><AccountAvatar account={account} /></button><span className="topbar-divider" /><div className="brand"><div className="brand-mark"><MonitorPlay size={24} /></div><span>Bili<span className="brand-light">Focus</span><span className="brand-dot" /></span></div></div><div className="topbar-right"><button className="icon-button open-search" onClick={openSearch} disabled={!ready || Boolean(watch)} aria-label={t("Search videos")} aria-pressed={Boolean(search)} title={t("Search videos")}><Search size={21} /></button><span className="build-tag">{platform.kind === 'browser' ? t("BROWSER PREVIEW") : platform.kind === 'android' ? t("ANDROID · V0.4") : t("DESKTOP · V0.4")}</span></div></header>
    <main className={`main-content tab-${settings.lastTab}${watch ? ' tab-video' : ''}`} id="main-content"><div hidden={Boolean(watch || search)}>{!ready ? <LoadingState /> : settings.lastTab === 'browse' ? <BrowsePage key={`${account.profile?.uid ?? 'guest'}:${account.status === 'expired' ? 'expired' : 'available'}`} account={account} compactCards={settings.compactCards} platform={platform} openVideo={openVideo} /> : settings.lastTab === 'subscribe' ? <SubscribePage key={`${account.profile?.uid ?? 'guest'}:${account.status}`} account={account} compactCards={settings.compactCards} platform={platform} navigate={navigate} openVideo={openVideo} /> : <OptionsPage account={account} settings={settings} platform={platform} working={working} updateSettings={updateSettings} startLogin={startLogin} refreshAccount={refreshAccount} signOut={signOut} />}</div>{search && <div hidden={Boolean(watch)}><SearchPage key={`${account.profile?.uid ?? 'guest'}:${account.status}`} compactCards={settings.compactCards} platform={platform} close={closeSearch} openVideo={openVideo} /></div>}{watch && <VideoPage key={`${watch.bvid}:${account.profile?.uid ?? 'guest'}:${account.status}`} bvid={watch.bvid} account={account} sourceLabel={watch.source === 'search' ? t("Search") : watch.source === 'subscribe' ? t("Subscribe") : t("Browse")} close={closeVideo} openVideo={openVideo} />}</main>
    <footer className="app-footer"><div className="footer-note"><span className="footer-status-dot" /><span>{platform.kind === 'browser' ? t("Interface preview · native app for sign-in") : t("A calmer way to Bilibili")}</span></div><nav className="bottom-nav" aria-label={t("Main navigation")}>{([['browse', 'Browse', Compass], ['subscribe', 'Subscribe', UsersRound], ['options', 'Options', Settings2]] as const).map(([tab, label, Icon]) => <button key={tab} className={settings.lastTab === tab ? 'active' : ''} onClick={() => navigate(tab)} aria-current={settings.lastTab === tab ? 'page' : undefined} disabled={!ready}><Icon size={21} strokeWidth={settings.lastTab === tab ? 2 : 1.7} /><span>{t(label)}</span>{settings.lastTab === tab && <span className="nav-dot" />}</button>)}</nav><span className="footer-version">{t("Made for your interests")}</span></footer>
    {notice && <div className={`toast ${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.tone === 'success' ? <CheckCircle2 size={18} /> : <CircleHelp size={18} />}<span>{t(notice.message)}</span><button className="icon-button" onClick={() => setNotice(null)} aria-label={t("Dismiss notification")}><X size={15} /></button></div>}
    {loginOpen && <LoginModal login={login} method={login.method ?? loginMethod} account={account} startLogin={() => startLogin(login.method ?? loginMethod)} close={closeLogin} />}
  </div></LanguageContext.Provider>;
}
