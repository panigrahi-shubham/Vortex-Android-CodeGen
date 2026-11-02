// Types for webview-host.mjs.
export const WEBVIEW: {
  url: string;
  title: string;
  viewport: { width: number; height: number };
  dpr: number;
  nativeBounds: { x: number; y: number; width: number; height: number };
};
export function loadPlaywright(): unknown | null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function openWebView(samplesDir: string): Promise<{ page: any; reset(): Promise<void>; close(): Promise<void> }>;
