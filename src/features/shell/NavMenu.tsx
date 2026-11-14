import { ChevronDown } from 'lucide-react';
import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router';
import { isNavGroup, NAV, type NavGroup, type NavItem } from '@/app/navigation';
import { ROLE_HOME, type DashboardRole } from '@/app/roles';
import { cn } from '@/lib/utils';
import { useUi } from './uiStore';

const linkClass = (isActive: boolean, nested = false) =>
  cn(
    'relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-200',
    nested && 'py-1.5',
    isActive
      ? 'bg-accent-muted/50 font-medium text-ink shadow-[inset_2px_0_0_0_#22c3dd]'
      : 'text-ink-muted hover:bg-navy-800 hover:text-ink',
  );

function ItemLink({
  item,
  role,
  nested,
  onNavigate,
}: {
  item: NavItem;
  role: DashboardRole;
  nested?: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.path}
      // The role home is a prefix of every other route; match it exactly.
      end={item.path === ROLE_HOME[role]}
      onClick={onNavigate}
      className={({ isActive }) => linkClass(isActive, nested)}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {item.label}
    </NavLink>
  );
}

function Group({
  group,
  role,
  onNavigate,
}: {
  group: NavGroup;
  role: DashboardRole;
  onNavigate?: () => void;
}) {
  const { pathname } = useLocation();
  const containsActive = group.children.some((c) => pathname === c.path);
  const expanded = useUi((s) => s.expandedNavGroups.includes(group.id));
  const setExpanded = useUi((s) => s.setNavGroupExpanded);
  const open = expanded || containsActive;

  // Opening a child page (by link, back/forward or a redirect) expands its group.
  useEffect(() => {
    if (containsActive) setExpanded(group.id, true);
  }, [containsActive, group.id, setExpanded]);

  const Icon = group.icon;
  const panelId = `nav-group-${group.id}`;
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setExpanded(group.id, !open)}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-200',
          containsActive
            ? 'font-medium text-ink'
            : 'text-ink-muted hover:bg-navy-800 hover:text-ink',
        )}
        data-active={containsActive || undefined}
      >
        <Icon
          className={cn('h-4 w-4 shrink-0', containsActive && 'text-accent')}
          aria-hidden="true"
        />
        <span className="flex-1">{group.label}</span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 transition-transform duration-200',
            open ? 'rotate-0' : '-rotate-90',
          )}
          aria-hidden="true"
        />
      </button>
      {/* grid-rows 0fr -> 1fr animates height without measuring. */}
      <div
        id={panelId}
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
        hidden={!open}
      >
        <ul className="ml-5 mt-1 space-y-0.5 overflow-hidden border-l border-surface-border pl-2">
          {group.children.map((child) => (
            <li key={child.path}>
              <ItemLink item={child} role={role} nested onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

export function NavMenu({ role, onNavigate }: { role: DashboardRole; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main navigation">
      <ul className="space-y-1">
        {NAV[role].map((entry) =>
          isNavGroup(entry) ? (
            <Group key={entry.id} group={entry} role={role} onNavigate={onNavigate} />
          ) : (
            <li key={entry.path}>
              <ItemLink item={entry} role={role} onNavigate={onNavigate} />
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}
