/* temp registry check */
import { allProviders } from '../../src/lib/scraper/core/registry';

const all = allProviders();
console.log(
  'providers:',
  all.map((p) => `${p.key}(${p.kind})${p.isConfigured() ? '' : ' [disabled]'}`).join(', ') || 'NONE',
);
