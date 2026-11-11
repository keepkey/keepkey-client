/** Password-manager requests are background-only, never page-provider RPC.
 * Secret values are never returned in a browser-tool response or diagnostic. */
const secrets = new Set<string>();
const documentToken = crypto.randomUUID();
const fields = new Map<string, HTMLInputElement>();
export let passwordProtected = false;
export function isSecretField(el: Element): boolean {
  return (
    el instanceof HTMLInputElement &&
    (el.type === 'password' ||
      el.hasAttribute('data-keepkey-secret') ||
      /(?:password|one-time-code)/i.test(el.autocomplete))
  );
}
export function redactPasswordText(text: string): string {
  for (const secret of secrets) if (secret) text = text.split(secret).join('[redacted]');
  return text;
}
export function rememberSecret(value: string) {
  if (value) secrets.add(value);
}
export function redactPasswordResult(value: any): any {
  if (typeof value === 'string') return redactPasswordText(value);
  if (Array.isArray(value)) return value.map(redactPasswordResult);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [redactPasswordText(k), redactPasswordResult(v)]));
  return value;
}
export function passwordTargets(origin: string) {
  if (window.top !== window || location.origin !== origin || location.protocol !== 'https:')
    throw new Error('Password fill requires the exact HTTPS top-level login origin');
  fields.clear();
  const targets: { ref: string; label: string }[] = [];
  for (const input of Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]'))) {
    const rect = input.getBoundingClientRect();
    if (
      input.disabled ||
      input.readOnly ||
      rect.width <= 0 ||
      rect.height <= 0 ||
      getComputedStyle(input).visibility === 'hidden'
    )
      continue;
    const ref = crypto.randomUUID();
    fields.set(ref, input);
    targets.push({
      ref,
      label: redactPasswordText(input.autocomplete || input.getAttribute('aria-label') || input.name || 'Password'),
    });
  }
  return { documentToken, origin: location.origin, targets };
}
export function fillPassword(msg: {
  origin: string;
  documentToken: string;
  ref: string;
  password: string;
  expiresAt: number;
}) {
  if (
    window.top !== window ||
    location.origin !== msg.origin ||
    location.protocol !== 'https:' ||
    msg.documentToken !== documentToken ||
    Date.now() >= msg.expiresAt ||
    msg.expiresAt > Date.now() + 60000
  )
    throw new Error('Password fill expired or the document changed');
  const input = fields.get(msg.ref);
  fields.delete(msg.ref); // one use, including failed attempts
  if (
    !input?.isConnected ||
    input.type !== 'password' ||
    input.disabled ||
    input.readOnly ||
    input.getBoundingClientRect().width <= 0 ||
    getComputedStyle(input).visibility === 'hidden'
  )
    throw new Error('Password field changed. Review it again.');
  if (input.form?.action && new URL(input.form.action, location.href).origin !== msg.origin)
    throw new Error('Password form submits to a different origin');
  if (typeof msg.password !== 'string' || msg.password.length > 128) throw new Error('Invalid password value');
  passwordProtected = true;
  rememberSecret(msg.password);
  input.setAttribute('data-keepkey-secret', 'true');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, msg.password);
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  return { filled: true, submitted: false };
}
