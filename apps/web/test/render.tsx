import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ApiProvider } from '../src/api/ApiProvider';
import type { ApiClient } from '../src/api/client';
import { AppRoutes } from '../src/App';
import { ToastProvider } from '../src/components/ui';

export function renderAt(path: string, api: ApiClient) {
  return render(
    <ApiProvider client={api}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </ToastProvider>
    </ApiProvider>,
  );
}
