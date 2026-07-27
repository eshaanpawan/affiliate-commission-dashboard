import { Suspense } from 'react';

import { AppSidebar } from '@/components/AppSidebar';
import { DashboardHeader } from '@/components/DashboardHeader';
import { DashboardRangeProvider } from '@/components/DashboardRangeProvider';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <DashboardRangeProvider>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset className="min-h-svh min-w-0 overflow-x-clip">
            <DashboardHeader />
            <div className="mx-auto w-full max-w-[1560px] min-w-0 flex-1">{children}</div>
          </SidebarInset>
        </SidebarProvider>
      </DashboardRangeProvider>
    </Suspense>
  );
}
