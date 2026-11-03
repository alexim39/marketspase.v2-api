/** YouTube URL → video id. Accepts watch, youtu.be, shorts, embed and raw ids. */
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

export const TUTORIAL_AREAS = ['Start', 'Prospects', 'Sessions', 'Wallet', 'Team', 'Grow'];

export function extractYouTubeId(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  if (ID_RE.test(raw)) return raw;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0] ?? '';
    return ID_RE.test(id) ? id : null;
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const path = url.pathname;
    if (path === '/watch') {
      const id = url.searchParams.get('v') ?? '';
      return ID_RE.test(id) ? id : null;
    }
    for (const prefix of ['/embed/', '/shorts/', '/live/', '/v/']) {
      if (path.startsWith(prefix)) {
        const id = path.slice(prefix.length).split('/')[0].split('?')[0] ?? '';
        if (ID_RE.test(id)) return id;
      }
    }
  }
  return null;
}

/** Privacy-enhanced embed URL (never the raw user string — XSS-proof by construction). */
export const embedUrl = (id) => `https://www.youtube-nocookie.com/embed/${id}?rel=0`;

export const thumbnailUrl = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

export const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;
