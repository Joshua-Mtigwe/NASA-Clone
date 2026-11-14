import { useEffect } from 'react';
import { Link } from 'react-router';
import { ROLE_HOME } from '@/app/roles';
import { DataState } from '@/components/shared';
import { useSession } from '@/features/auth/sessionStore';

export function NotFoundPage() {
  const role = useSession((s) => s.role);

  useEffect(() => {
    document.title = 'Page not found · AEGIS';
  }, []);

  return (
    <section aria-labelledby="not-found-title" className="space-y-4">
      <h1 id="not-found-title" className="text-heading">
        Page not found
      </h1>
      <DataState status="empty" emptyMessage="There is no page at this address." />
      {role && (
        <Link to={ROLE_HOME[role]} className="text-accent underline-offset-4 hover:underline">
          Go to my home page
        </Link>
      )}
    </section>
  );
}
