/**
 * Session scope for the shared API.
 *
 * Partner and admin apps run in the same browser against the same API host.
 * Both used to share the `jwt` cookie, so signing into one replaced the other
 * session. The admin app now sends `X-Client: admin`; that selects the
 * `admin_jwt` cookie instead of the partner `jwt` cookie.
 */
export const isAdminScope = (req) =>
  String(req?.headers?.['x-client'] ?? '').trim().toLowerCase() === 'admin';

export const sessionCookieName = (req) => (isAdminScope(req) ? 'admin_jwt' : 'jwt');
