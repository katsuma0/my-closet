// Haptic feedback.
// iOS app (WKWebView, see ios/): a "haptic" message to the native side.
// Android / Chrome: Vibration API.
// iOS Safari (18+): toggling a native <input switch> produces a system haptic tick.

let iosLabel = null;

const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function iosTick() {
  if (!iosLabel) {
    const id = 'haptic-switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.setAttribute('switch', '');
    input.style.cssText = 'position:fixed;left:-9999px;opacity:0;pointer-events:none';
    iosLabel = document.createElement('label');
    iosLabel.htmlFor = id;
    iosLabel.style.cssText = 'position:fixed;left:-9999px;opacity:0;pointer-events:none';
    document.body.append(input, iosLabel);
  }
  iosLabel.click();
}

const patterns = {
  light: 8,
  select: 12,
  medium: 18,
  heavy: [28],
  success: [12, 60, 18],
  warning: [20, 80, 20],
  long: [10, 30, 22],
};

// Inside the iOS app (see ios/), the native side plays real haptics.
const native = () => window.webkit?.messageHandlers?.haptic;

export function haptic(kind = 'light') {
  try {
    if (native()) native().postMessage(kind);
    else if (isIOS) {
      iosTick();
      if (kind === 'success' || kind === 'long' || kind === 'warning') setTimeout(iosTick, 90);
    } else if (navigator.vibrate) {
      navigator.vibrate(patterns[kind] ?? 10);
    }
  } catch { /* no-op */ }
}
