import { useState } from 'react';

export interface DataTableColumn<T> {
  header: string;
  cell: (row: T) => string;
}

/**
 * The table view every chart offers. Rows render only when opened, so long
 * series stay cheap.
 */
export function DataTable<T>({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: DataTableColumn<T>[];
  rows: T[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="mt-3 text-sm"
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer text-accent-strong underline-offset-4 hover:underline">
        Show data table ({rows.length} rows)
      </summary>
      {open && (
        <div className="mt-2 max-h-72 overflow-auto rounded-md border">
          <table className="w-full text-left text-caption">
            <caption className="sr-only">{caption}</caption>
            <thead className="sticky top-0 bg-navy-800">
              <tr>
                {columns.map((c) => (
                  <th key={c.header} scope="col" className="px-3 py-2 font-medium text-ink-muted">
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-t">
                  {columns.map((c) => (
                    <td key={c.header} className="px-3 py-1.5 text-ink">
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
