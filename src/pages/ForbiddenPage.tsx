import { ShieldAlert } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { ROLE_HOME, ROLE_LABELS } from '@/app/roles';
import { Button } from '@/components/ui/button';
import { useSession } from '@/features/auth/sessionStore';

export function ForbiddenPage() {
  const role = useSession((s) => s.role);

  useEffect(() => {
    document.title = 'Access restricted · AEGIS';
  }, []);

  return (
    <section
      aria-labelledby="forbidden-title"
      className="mx-auto flex max-w-lg flex-col items-center gap-3 rounded-lg border border-status-action/40 p-8 text-center"
    >
      <ShieldAlert className="h-8 w-8 text-status-action" aria-hidden="true" />
      <h1 id="forbidden-title" className="text-heading">
        Access restricted
      </h1>
      <p className="text-ink-muted">
        {role
          ? `The ${ROLE_LABELS[role]} role does not have access to this page.`
          : 'You do not have access to this page.'}
      </p>
      <p className="text-caption text-ink-subtle">Error 403</p>
      {role && (
        <Button asChild variant="outline">
          <Link to={ROLE_HOME[role]}>Go to my home page</Link>
        </Button>
      )}
    </section>
  );
}
