import { createFriendStatusService, FRIEND_STATUS_CACHE_CONTROL } from './_lib/friend-status.mjs';

const service = createFriendStatusService();
export default async function handler(request, nodeResponse) {
  let response;
  if (request.method !== 'GET') {
    response = Response.json({ error: '此接口仅支持 GET' }, { status: 405, headers: { Allow: 'GET', 'Cache-Control': 'no-store' } });
  } else {
    try {
      response = Response.json(await service.read(), { headers: { 'Cache-Control': FRIEND_STATUS_CACHE_CONTROL } });
    } catch {
      response = Response.json({ error: '友链检测结果暂不可用，请稍后重试' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
  }
  if (!nodeResponse) return response;
  nodeResponse.statusCode = response.status;
  response.headers.forEach((value, key) => nodeResponse.setHeader?.(key, value));
  nodeResponse.end(await response.text());
}
