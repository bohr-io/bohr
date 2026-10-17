import { vi } from 'vitest';

// Every test passes a fake fetch; reaching the global one means a code path forgot it
vi.stubGlobal('fetch', async () => {
  throw new Error('Tests must not reach the network: pass a fake fetch');
});
