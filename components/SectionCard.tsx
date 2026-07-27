'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface SectionCardProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** A Card whose header toggles a Collapsible body — the repeating shell of every dashboard section. */
export function SectionCard({ title, description, open, onOpenChange, action, children, className }: SectionCardProps) {
  return (
    <Card className={cn('overflow-hidden py-0', className)}>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CardHeader className="[.border-b]:pb-0 gap-1 border-b py-4">
          <div className="min-w-0">
            <CardTitle className="flex items-center text-sm">{title}</CardTitle>
            {description && <CardDescription className="mt-0.5 text-xs">{description}</CardDescription>}
          </div>
          <CardAction className="flex items-center gap-2">
            {action}
            <CollapsibleTrigger
              aria-label={open ? 'Collapse section' : 'Expand section'}
              className="group hover:bg-muted focus-visible:ring-ring inline-flex size-8 cursor-pointer items-center justify-center rounded-md outline-none focus-visible:ring-2"
            >
              <ChevronDown className="text-muted-foreground size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
          </CardAction>
        </CardHeader>
        <CollapsibleContent>{children}</CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
