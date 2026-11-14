import { useEffect } from 'react';
import type { NavItem } from '@/app/navigation';
import { DataState } from '@/components/shared';

/** Stand-in for a route whose real page is delivered in a later phase. */
export function PlaceholderPage({ item }: { item: NavItem }) {
  useEffect(() => {
    document.title = `${item.label} · AEGIS`;
  }, [item.label]);

  return (
    <section aria-labelledby="page-title" className="space-y-4">
      <div className="space-y-1">
        <h1 id="page-title" className="text-heading">
          {item.label}
        </h1>
        <p className="text-ink-muted">{item.description}</p>
      </div>
      <DataState
        status="empty"
        emptyMessage={`This page is not built yet. It is delivered in Phase ${item.phase}.`}
      />
    </section>
  );
}
