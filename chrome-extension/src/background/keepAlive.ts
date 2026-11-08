/** Keep MV3 alive only while an interactive request is pending (Chrome 110+).
 * Calling an extension API resets the worker timer; a JS timer alone does not.
 * https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers#keep_a_service_worker_alive
 */
export async function withServiceWorkerKeepAlive<T>(operation: () => Promise<T>): Promise<T> {
  const heartbeat = () => {
    void chrome.runtime.getPlatformInfo().catch(() => {});
  };
  heartbeat();
  const timer = setInterval(heartbeat, 20_000);
  try {
    return await operation();
  } finally {
    clearInterval(timer);
  }
}
