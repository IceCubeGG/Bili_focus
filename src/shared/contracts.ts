export type AppTab = 'browse' | 'subscribe' | 'options';
export type Appearance = 'system' | 'light' | 'dark';
export type InterfaceLanguage = 'en' | 'zh-CN';

export interface AppSettings {
  version: 1;
  lastTab: AppTab;
  appearance: Appearance;
  compactCards: boolean;
  language: InterfaceLanguage;
}

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  lastTab: 'browse',
  appearance: 'system',
  compactCards: false,
  language: 'en',
};

export type AccountStatus = 'signed-out' | 'checking' | 'signed-in' | 'expired' | 'offline';

export interface AccountSnapshot {
  status: AccountStatus;
  profile: { uid: number; name: string; avatar: string; level: number; isVip: boolean } | null;
  lastCheckedAt: number | null;
  message: string | null;
  secureStorage: boolean;
}

export type LoginMethod = 'qr' | 'web';
export type LoginStatus = 'idle' | 'generating' | 'waiting' | 'scanned' | 'opening' | 'web-login' | 'success' | 'expired' | 'error';

export interface PlatformInfo {
  kind: 'desktop' | 'android' | 'browser';
  loginMethods: LoginMethod[];
}

export interface LoginSnapshot {
  status: LoginStatus;
  qrDataUrl: string | null;
  expiresAt: number | null;
  message: string | null;
  method?: LoginMethod;
}

export interface VideoCandidate {
  bvid: string;
  title: string;
  cover: string;
  durationSeconds: number;
  uploader: { id: string; name: string };
  views: number;
  publishedAt: number | null;
}

export interface RecommendationPage {
  videos: VideoCandidate[];
  cursor: string | null;
  hasMore: boolean;
}

/** Authenticated, original video uploads from verified followed accounts only. */
export interface SubscriptionPage {
  videos: VideoCandidate[];
  cursor: string | null;
  hasMore: boolean;
}

/** The selected followed creator's upload library, independent of recent dynamics. */
export interface UploaderVideoPage extends SubscriptionPage { total: number; }

export interface FollowedUploader { id: string; name: string; avatar: string; }
export interface FollowedUploaderPage { uploaders: FollowedUploader[]; cursor: string | null; hasMore: boolean; total: number; }
export interface SubscriptionGroup { id: string; name: string; uploaderIds: string[]; }
export interface SubscriptionGroups { version: 1; groups: SubscriptionGroup[]; }

export interface VideoLabels {
  bvid: string;
  labels: string[];
  status: 'ready' | 'unavailable';
}

export interface VideoPart { cid: string; page: number; title: string; durationSeconds: number; }
export interface VideoEpisode { bvid: string; title: string; section: string; }
export interface VideoDetails extends VideoCandidate {
  aid: string; description: string; uploaderAvatar: string; tags: string[];
  parts: VideoPart[]; episodes: VideoEpisode[];
}
/** URLs are opaque native-host media handles, never cookies or remote stream URLs. */
export interface VideoQuality { id: number; label: string; }
export interface DashTrack {
  quality: number; url: string; mimeType: string; codecs: string; bandwidth: number;
  initialization: string; indexRange: string; width: number; height: number;
}
export interface VideoPlayback {
  handle: string; sources: { url: string; durationSeconds: number }[]; qualityLabel: string;
  quality: number; qualities: VideoQuality[];
  dash?: { durationSeconds: number; video: DashTrack[]; audio: DashTrack[] };
}
export interface Danmu { id: string; timeSeconds: number; text: string; color: number; mode: 1 | 4 | 5; }
export interface DanmuPage { items: Danmu[]; segment: number; }
export interface VideoComment {
  id: string; author: { id: string; name: string; avatar: string }; text: string;
  publishedAt: number | null; likes: number; replyCount: number; replies: VideoComment[];
}
export interface VideoCommentsPage { items: VideoComment[]; page: number; hasMore: boolean; total: number; closed: boolean; }
export interface VideoPostResult { message: string; }

export type DownloadState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export interface DownloadJob {
  id: string; bvid: string; cid: string | null; kind: 'video' | 'cover'; title: string;
  state: DownloadState; downloadedBytes: number; totalBytes: number | null;
  files: string[]; error: string | null; createdAt: number;
}
export interface DownloadsSnapshot { folder: string | null; jobs: DownloadJob[]; }
export interface SaveFolder { id: string; label: string; location: string; }
export interface SaveFoldersSnapshot { folders: SaveFolder[]; activeFolderId: string | null; }
export interface SavedFile { id: string; name: string; kind: 'video' | 'cover'; bytes: number; modifiedAt: number; }
export interface SavedFilesSnapshot { folderId: string; files: SavedFile[]; truncated: boolean; }

export interface BrowsePreset {
  id: string;
  name: string;
  labels: string[];
  uploaders: { id: string; name: string }[];
  match: 'all' | 'any';
}

export interface BrowseSettings {
  version: 1;
  activePresetId: string | null;
  presets: BrowsePreset[];
}

export const DEFAULT_BROWSE_SETTINGS: BrowseSettings = { version: 1, activePresetId: null, presets: [] };

export interface BilibiliBridge {
  getSaveFolders(): Promise<SaveFoldersSnapshot>;
  controlSaveFolder(options: { id: string; action: 'select' | 'forget' }): Promise<SaveFoldersSnapshot>;
  listSavedFiles(options: { folderId: string }): Promise<SavedFilesSnapshot>;
  openSavedFile(options: { folderId: string; fileId: string }): Promise<void>;
  getDownloads(): Promise<DownloadsSnapshot>;
  chooseDownloadFolder(): Promise<DownloadsSnapshot>;
  startDownload(options: { bvid: string; cid: string | null; kind: 'video' | 'cover' }): Promise<DownloadsSnapshot>;
  controlDownload(options: { id: string; action: 'cancel' | 'retry' | 'remove' }): Promise<DownloadsSnapshot>;
  getVideoDetails(options: { bvid: string }): Promise<VideoDetails>;
  getVideoPlayback(options: { bvid: string; cid: string; quality?: number; format?: 'progressive' }): Promise<VideoPlayback>;
  releaseVideoPlayback(options: { handle: string }): Promise<void>;
  getDanmu(options: { bvid: string; cid: string; segment: number }): Promise<DanmuPage>;
  sendDanmu(options: { bvid: string; cid: string; text: string; timeSeconds: number }): Promise<VideoPostResult>;
  getVideoComments(options: { bvid: string; page: number; sort: 'hot' | 'newest'; root: string | null }): Promise<VideoCommentsPage>;
  sendVideoComment(options: { bvid: string; text: string; root: string | null; parent: string | null }): Promise<VideoPostResult>;
  openCreatorProfile(options: { uploaderId: string }): Promise<void>;
  getPlatform(): Promise<PlatformInfo>;
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<Omit<AppSettings, 'version'>>): Promise<AppSettings>;
  getAccount(): Promise<AccountSnapshot>;
  getLogin(): Promise<LoginSnapshot>;
  startLogin(): Promise<LoginSnapshot>;
  startWebLogin(): Promise<LoginSnapshot>;
  cancelLogin(): Promise<LoginSnapshot>;
  refreshAccount(): Promise<AccountSnapshot>;
  signOut(): Promise<AccountSnapshot>;
  getRecommendationPage(options: { cursor: string | null }): Promise<RecommendationPage>;
  getSubscriptionPage(options: { cursor: string | null }): Promise<SubscriptionPage>;
  getUploaderVideoPage(options: { uploaderId: string; cursor: string | null }): Promise<UploaderVideoPage>;
  getFollowedUploaderPage(options: { cursor: string | null }): Promise<FollowedUploaderPage>;
  getSubscriptionGroups(): Promise<SubscriptionGroups>;
  updateSubscriptionGroups(settings: SubscriptionGroups): Promise<SubscriptionGroups>;
  getVideoLabels(options: { bvids: string[] }): Promise<VideoLabels[]>;
  getBrowseSettings(): Promise<BrowseSettings>;
  updateBrowseSettings(settings: BrowseSettings): Promise<BrowseSettings>;
  onAccountChanged(callback: (snapshot: AccountSnapshot) => void): () => void;
  onLoginChanged(callback: (snapshot: LoginSnapshot) => void): () => void;
}

declare global {
  interface Window { bilibili?: BilibiliBridge; }
}
