import { createRequire } from 'node:module';
import { friendUrlKey } from '../src/utils/friend-data.mjs';
const require = createRequire(import.meta.url);
const { fetchPublicResource, hasBacklink, publicUrl } = require('../.github/scripts/friend-policy.cjs');
const weekMs = 7 * 24 * 60 * 60 * 1000;

export function normalizedFriendUrl(value) {
  return friendUrlKey(publicUrl(value).href);
}

async function fetchPage(url) {
  const result = await fetchPublicResource(url, { allowCrossOrigin: true, maxRedirects: 5 });
  return { ...result, content: result.body.toString('utf8') };
}

function previousScreenshot(previous, url, checkedAt) {
  const result = previous?.results?.find(item => {
    try { return normalizedFriendUrl(item.url) === normalizedFriendUrl(url); } catch { return false; }
  });
  try {
    const screenshotUrl = publicUrl(result.screenshotUrl).href;
    const timestamp = Date.parse(result.screenshotAt);
    if (!Number.isFinite(timestamp) || timestamp > checkedAt.getTime()) return {};
    return { screenshotUrl, screenshotAt: new Date(timestamp).toISOString() };
  } catch { return {}; }
}

export async function checkFriends(friends, options = {}) {
  const now = options.now || new Date();
  const checkedAt = now.toISOString();
  const getPage = options.fetchPage || fetchPage;
  const results = [];
  for (const friend of friends.filter(item => item.enabled === true && item.siteurl)) {
    const prior = previousScreenshot(options.previous, friend.siteurl, now);
    const result = {
      title: friend.title || '', url: friend.siteurl, status: 'unknown', checkedAt,
      httpStatus: null, latencyMs: null, backlink: friend.linkpage ? 'unknown' : 'unchecked',
      screenshotUrl: prior.screenshotUrl || null, screenshotAt: prior.screenshotAt || null,
    };
    const startedAt = performance.now();
    let response;
    try {
      publicUrl(friend.siteurl);
      response = await getPage(friend.siteurl);
      result.httpStatus = response.status;
      result.status = [401, 403, 429].includes(response.status) ? 'restricted' : response.status >= 200 && response.status < 400 ? 'ok' : 'error';
    } catch {
      result.status = 'error';
    }
    result.latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
    if (friend.linkpage && options.ownUrl) {
      try {
        publicUrl(friend.linkpage);
        const linkPage = await getPage(friend.linkpage);
        if (linkPage.status >= 200 && linkPage.status < 300) result.backlink = hasBacklink(linkPage.content, options.ownUrl) ? 'found' : 'missing';
      } catch { /* A failed backlink request remains unknown. */ }
    }
    if (result.status === 'ok' && options.capture && (!result.screenshotAt || now.getTime() - Date.parse(result.screenshotAt) >= weekMs)) {
      try {
        result.screenshotUrl = publicUrl(await options.capture(response.actualUrl || friend.siteurl, friend)).href;
        result.screenshotAt = checkedAt;
      } catch {
        options.onScreenshotError?.(friend);
      }
    }
    results.push(result);
  }
  return { schemaVersion: 1, checkedAt, results };
}
