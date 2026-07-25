import { AppSidebar } from '@/components/AppSidebar';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      {/* min-w-0 lets this flex child shrink below its content's min-width —
          without it any wide table pushes the whole page past the viewport */}
      <SidebarInset className="min-w-0 overflow-x-hidden">
        <header className="bg-background/80 sticky top-0 z-40 flex h-12 shrink-0 items-center gap-2 border-b px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 !h-4" />
          <p className="text-muted-foreground text-sm">Runable affiliate program</p>
        </header>
        <div className="min-w-0 flex-1">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
