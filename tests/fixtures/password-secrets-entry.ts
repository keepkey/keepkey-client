// Test-only bridge for browser assertions; never part of the extension entry.
import * as secrets from '../../pages/content/src/passwordSecrets'
;(globalThis as any).__passwordSecrets = secrets
