import type { AccountRow } from './db';

export type Bindings = {
  LIVEVIEW_DB: D1Database;
  LIVEVIEW_MEDIA: KVNamespace;
  ASSETS: Fetcher;
  /** Optional override. When unset, a generated secret is stored in D1 and reused. */
  JWT_SECRET?: string;
  /** Optional override. When unset, a generated admin token is stored in D1 and never returned. */
  ADMIN_APPROVAL_TOKEN?: string;
  /** Public site base, e.g. https://maxteeple.com/liveview */
  SITE_URL?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_PHONE_NUMBER?: string;
  STREAM_WEBHOOK_SECRET?: string;
  /** Optional HTTPS endpoint that receives invite payloads. SMTP is not available on Workers. */
  INVITE_WEBHOOK_URL?: string;
};

export type Variables = {
  account: AccountRow;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: Variables;
};
