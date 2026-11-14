import { NavLink } from 'react-router';
import type { Role } from '@/api/types';
import { NAV } from '@/app/navigation';
import { ROLE_HOME } from '@/app/roles';
import { cn } from '@/lib/utils';

export function NavMenu({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main navigation">
      <ul className="space-y-1">
        {NAV[role].map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.path}>
              <NavLink
                to={item.path}
                // The role home is a prefix of every other route; match it exactly.
                end={item.path === ROLE_HOME[role]}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-accent-muted/60 font-medium text-ink'
                      : 'text-ink-muted hover:bg-navy-800 hover:text-ink',
                  )
                }
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {item.label}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
