import { inject } from 'vue';
import type { CaidoSDK } from '../index';

export function useCaidoSDK(): CaidoSDK | null {
  return inject<CaidoSDK>('sdk') || null;
}
