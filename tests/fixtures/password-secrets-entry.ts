// Synthetic browser fixture; never part of the extension entry.
import * as secrets from '../../pages/content/src/passwordSecrets';
import * as core from '../../packages/shared/lib/utils/agentDomCore';
core.configureAgentSecrets({
  isSecretField: secrets.isSecretField,
  rememberSecret: secrets.rememberSecret,
  redact: secrets.redactPasswordResult,
});
(globalThis as any).__passwordSecrets = secrets;
(globalThis as any).__agentDomCore = core;
