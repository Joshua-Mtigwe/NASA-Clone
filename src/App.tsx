import { useState } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Providers } from '@/app/Providers';
import { createQueryClient } from '@/app/queryClient';
import { appRoutes } from '@/app/routes';

const router = createBrowserRouter(appRoutes);

export default function App() {
  const [client] = useState(createQueryClient);
  return (
    <Providers client={client}>
      <RouterProvider router={router} />
    </Providers>
  );
}
