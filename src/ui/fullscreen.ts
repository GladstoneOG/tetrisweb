/**
 * Cross-browser fullscreen helpers. Every call is wrapped so unsupported
 * contexts (iOS Safari iPhone, embedded webviews, jsdom) degrade silently.
 */

type FsElement = HTMLElement & {
  webkitRequestFullscreen?: (options?: unknown) => Promise<void> | void;
  webkitRequestFullScreen?: () => void;
  msRequestFullscreen?: () => Promise<void> | void;
};

type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitCurrentFullScreenElement?: Element | null;
  msFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitCancelFullScreen?: () => void;
  msExitFullscreen?: () => Promise<void> | void;
};

export function isFullscreen(doc: Document = document): boolean {
  const d = doc as FsDocument;
  return Boolean(
    d.fullscreenElement || d.webkitFullscreenElement || d.webkitCurrentFullScreenElement || d.msFullscreenElement
  );
}

function settle(result: unknown): Promise<boolean> {
  if (result && typeof (result as Promise<void>).then === 'function') {
    return (result as Promise<void>).then(
      () => true,
      () => false
    );
  }
  return Promise.resolve(true);
}

/** Requests fullscreen; resolves `true` on success, `false` when unsupported/denied. Never throws. */
export function requestFullscreen(el?: HTMLElement | null): Promise<boolean> {
  try {
    if (typeof document === 'undefined') return Promise.resolve(false);
    if (isFullscreen()) return Promise.resolve(true);
    const target = (el ?? document.documentElement) as FsElement;
    if (typeof target.requestFullscreen === 'function') {
      return settle(target.requestFullscreen({ navigationUI: 'hide' } as FullscreenOptions));
    }
    if (typeof target.webkitRequestFullscreen === 'function') {
      return settle(target.webkitRequestFullscreen());
    }
    if (typeof target.webkitRequestFullScreen === 'function') {
      return settle(target.webkitRequestFullScreen());
    }
    if (typeof target.msRequestFullscreen === 'function') {
      return settle(target.msRequestFullscreen());
    }
  } catch {
    // Unsupported or not triggered by a user gesture.
  }
  return Promise.resolve(false);
}

/** Exits fullscreen if active. Never throws. */
export function exitFullscreen(): Promise<boolean> {
  try {
    if (typeof document === 'undefined' || !isFullscreen()) return Promise.resolve(false);
    const d = document as FsDocument;
    if (typeof d.exitFullscreen === 'function') return settle(d.exitFullscreen());
    if (typeof d.webkitExitFullscreen === 'function') return settle(d.webkitExitFullscreen());
    if (typeof d.webkitCancelFullScreen === 'function') return settle(d.webkitCancelFullScreen());
    if (typeof d.msExitFullscreen === 'function') return settle(d.msExitFullscreen());
  } catch {
    // ignore
  }
  return Promise.resolve(false);
}
