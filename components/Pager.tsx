'use client';

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface PagerProps {
  page: number;
  totalPages: number;
  total: number;
  perPage: number;
  onPage: (page: number) => void;
  label?: string;
}

/** Standard table pagination footer used by every paginated page. */
export function Pager({ page, totalPages, total, perPage, onPage, label = 'rows' }: PagerProps) {
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3">
      <p className="text-muted-foreground text-xs">
        {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()} {label}
      </p>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => onPage(1)} aria-label="First page">
          <ChevronsLeft className="size-3.5" />
        </Button>
        <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="size-3.5" />
        </Button>
        <span className="text-muted-foreground px-2 text-xs tabular-nums">
          Page {page} / {totalPages}
        </span>
        <Button variant="outline" size="icon-sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="size-3.5" />
        </Button>
        <Button variant="outline" size="icon-sm" disabled={page >= totalPages} onClick={() => onPage(totalPages)} aria-label="Last page">
          <ChevronsRight className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
