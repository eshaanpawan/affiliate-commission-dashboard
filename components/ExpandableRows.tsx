'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Pager } from '@/components/Pager';

interface ExpandableRowsProps<T> {
  items: T[];
  /** Rows shown while collapsed. Default 5. */
  preview?: number;
  /** Rows per page once expanded. Default 10. */
  perPage?: number;
  /** Noun used in the footer copy, e.g. "affiliates". */
  label?: string;
  /** Renders the current slice — a Table (with its body) or any list markup. */
  render: (pageRows: T[]) => ReactNode;
}

/**
 * Standard collapse/expand pattern for long lists: collapsed shows a short
 * preview with an "Expand" button; expanded paginates via the shared Pager
 * with a "Collapse" button next to it.
 */
export function ExpandableRows<T>({ items, preview = 5, perPage = 10, label = 'rows', render }: ExpandableRowsProps<T>) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(items.length / perPage));
  const safePage = Math.min(page, totalPages);
  const rows = expanded
    ? items.slice((safePage - 1) * perPage, safePage * perPage)
    : items.slice(0, preview);
  const collapsible = items.length > preview;

  return (
    <>
      {render(rows)}
      {collapsible ? (
        expanded ? (
          <div className="flex flex-wrap items-center border-t">
            <div className="min-w-0 flex-1 [&>div]:border-t-0">
              <Pager
                page={safePage}
                totalPages={totalPages}
                total={items.length}
                perPage={perPage}
                onPage={setPage}
                label={label}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mr-4 mb-2 sm:mb-0"
              onClick={() => { setExpanded(false); setPage(1); }}
            >
              <ChevronUp className="size-3.5" /> Collapse
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 border-t px-5 py-3">
            <p className="text-muted-foreground text-xs">
              Showing {Math.min(preview, items.length)} of {items.length.toLocaleString()} {label}
            </p>
            <Button variant="outline" size="sm" onClick={() => { setExpanded(true); setPage(1); }}>
              <ChevronDown className="size-3.5" /> Expand
            </Button>
          </div>
        )
      ) : null}
    </>
  );
}
