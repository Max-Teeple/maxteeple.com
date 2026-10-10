declare module 'bcryptjs' {
  export function compareSync(password: string, hash: string): boolean;
  export function hashSync(password: string, salt: number | string): string;
}

declare module 'cloudflare:test' {
  export const env: {
    LIVEVIEW_DB: D1Database;
    LIVEVIEW_MEDIA: KVNamespace;
    ADMIN_APPROVAL_TOKEN: string;
    JWT_SECRET?: string;
  };
  export const SELF: Fetcher;
}
