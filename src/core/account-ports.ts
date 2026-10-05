import type { AccountSnapshot } from '../shared/contracts';

export interface Credentials {
  cookies: Record<string, string>;
  refreshToken: string;
  pendingRefreshToken?: string;
}

export interface CredentialVault {
  isAvailable(): boolean;
  load(): Promise<Credentials | null>;
  save(credentials: Credentials): Promise<void>;
  clear(): Promise<void>;
}

export class BilibiliError extends Error {
  constructor(public readonly code: number, message: string) { super(message); }
}

export interface QrCode { url: string; key: string; }
export interface QrPoll { code: number; credentials: Credentials | null; }

export interface AccountApi {
  generateQr(): Promise<QrCode>;
  pollQr(key: string): Promise<QrPoll>;
  validate(credentials: Credentials): Promise<NonNullable<AccountSnapshot['profile']>>;
  renew(credentials: Credentials, persist: (next: Credentials) => Promise<void>): Promise<Credentials>;
  logout(credentials: Credentials): Promise<void>;
}

export interface WebLoginProvider {
  open(onCredentials: (credentials: Credentials) => Promise<void>, onClose: () => void): Promise<void>;
  close(): void;
}
