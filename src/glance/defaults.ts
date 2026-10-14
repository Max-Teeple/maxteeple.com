/** One-way hash of the initial kitchen password. The plaintext is not in the repo. */
export const GLANCE_INITIAL_PASSWORD_HASH =
  'pbkdf2$8000$KAgRdcFxXkGAZvalMqHkmQ$ducOD3lOOxm-HLwnkTDWnRjtNEgs3soZrT2s_lM-MEs';

export const GLANCE_COOKIE = '__Host-glance_session';
export const GLANCE_SESSION_SECONDS = 60 * 60 * 24 * 365;
export const GLANCE_FAIL_LIMIT = 8;
export const GLANCE_FAIL_WINDOW_MS = 15 * 60 * 1000;

export const DEFAULT_WIDGETS = {
  countdown: true,
  sun: true,
  air: true,
  summary: true,
  lights: true,
  family: true
};

export const THEMES = ['auto', 'aurora', 'desert', 'golf', 'glass'] as const;
export type GlanceTheme = (typeof THEMES)[number];
