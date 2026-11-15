import { createContext, useContext, useState, type ReactNode } from 'react';
import { HttpApiClient, type ApiClient } from './client';

const ApiContext = createContext<ApiClient | null>(null);

export function ApiProvider({ client, children }: { client?: ApiClient; children: ReactNode }) {
  const [value] = useState<ApiClient>(() => client ?? new HttpApiClient(import.meta.env.VITE_API_BASE_URL ?? ''));
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiClient {
  const api = useContext(ApiContext);
  if (!api) throw new Error('ApiProvider is missing');
  return api;
}
