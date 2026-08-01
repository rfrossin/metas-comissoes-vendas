import { AsyncLocalStorage } from "node:async_hooks";

export interface TenantContext {
  companyId: string;
}

export const tenantContext = new AsyncLocalStorage<TenantContext>();
