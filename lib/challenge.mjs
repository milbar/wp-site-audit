// Bot-védelmi köztes oldalak felismerése (Cloudflare, „One moment, please…”, „Kis türelmet…” stb.)
export const CHALLENGE_RE = /one moment|just a moment|kis türelmet|checking your browser|attention required|verifying you are human|access denied|ddos protection|security check/i;
export const titleOf = html => String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || '';
// a válasz egy védelmi oldal (a tényleges tartalom helyett)?
export function isChallenge(res) {
  if (!res || !res.status) return false;
  const body = res.body || '';
  if (CHALLENGE_RE.test(titleOf(body))) return true;
  return [403, 429, 503].includes(res.status) && body.length < 60000 && /cloudflare|sucuri|captcha|cf-chl|incapsula|_Incapsula_|ddos-guard|bot protection/i.test(body);
}
