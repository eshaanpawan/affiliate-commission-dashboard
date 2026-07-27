'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Banknote,
  CalendarRange,
  ChartNoAxesCombined,
  CircleCheckBig,
  Filter,
  Gauge,
  Globe,
  LogOut,
  ScrollText,
  Siren,
  Sparkles,
  Trophy,
  Users,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { useDashboardRange } from '@/components/DashboardRangeProvider';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';

const NAV_GROUPS = [
  {
    label: 'Performance',
    items: [
      { href: '/', label: 'Overview', icon: Gauge },
      { href: '/monthly', label: 'Monthly', icon: CalendarRange },
      { href: '/leaderboard', label: 'Leaderboard', icon: Trophy },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { href: '/affiliates', label: 'Affiliates', icon: Users },
      { href: '/countries', label: 'Countries', icon: Globe },
      { href: '/funnel', label: 'Funnel vs Google', icon: Filter },
      { href: '/growth', label: 'Growth workspace', icon: Sparkles },
    ],
  },
  {
    label: 'Risk & money',
    items: [
      { href: '/warroom', label: 'Fraud War Room', icon: Siren, badgeKey: 'highRisk' as const },
      { href: '/payouts', label: 'Payout Review', icon: Banknote, badgeKey: 'heldCount' as const },
      { href: '/enforcement', label: 'Enforcement Log', icon: ScrollText },
    ],
  },
];

export function AppSidebar({ badges }: { badges?: { highRisk?: number; heldCount?: number } }) {
  const pathname = usePathname();
  const router = useRouter();
  const { range } = useDashboardRange();
  const { state: sidebarState } = useSidebar();

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
  }

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader className="border-b border-sidebar-border px-3 py-3">
        <div className="flex h-10 items-center gap-2 group-data-[collapsible=icon]:justify-center">
          <Link
            href={range === 'all' ? '/' : `/?range=${range}`}
            className="min-w-0 flex-1 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:hidden"
          >
            <div className="relative h-6 w-32">
              <Image
                src="/runable-wordmark-dark.png"
                alt="Runable"
                fill
                priority
                sizes="128px"
                className="object-contain object-left dark:hidden"
              />
              <Image
                src="/runable-wordmark-light.png"
                alt="Runable"
                fill
                priority
                sizes="128px"
                className="hidden object-contain object-left dark:block"
              />
            </div>
            <p className="mt-0.5 truncate text-[11px] text-sidebar-foreground/55">Affiliate operations</p>
          </Link>
          <SidebarTrigger
            className="size-8 shrink-0 text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground group-data-[collapsible=icon]:mx-auto"
            aria-label={sidebarState === 'collapsed' ? 'Expand navigation' : 'Collapse navigation'}
          />
        </div>
      </SidebarHeader>
      <SidebarContent className="px-1 py-2">
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label} className="py-1.5">
            <SidebarGroupLabel className="h-7 px-2 text-[11px] font-medium text-sidebar-foreground/50">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                {group.items.map((item) => {
                  const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                  const badge = 'badgeKey' in item && item.badgeKey ? badges?.[item.badgeKey] : undefined;
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={item.label}
                        className="h-9 gap-2.5 rounded-lg px-2.5 text-[13px] text-sidebar-foreground/72 hover:text-sidebar-foreground data-active:bg-sidebar-primary data-active:text-sidebar-primary-foreground data-active:shadow-sm"
                      >
                        <Link href={range === 'all' ? item.href : `${item.href}?range=${range}`}>
                          <item.icon />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                      {badge != null && badge > 0 && (
                        <SidebarMenuBadge>
                          <Badge
                            variant="destructive"
                            className="h-5 min-w-5 px-1 text-[10px] tabular-nums"
                          >
                            {badge > 99 ? '99+' : badge}
                          </Badge>
                        </SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border px-3 py-3">
        <div className="rounded-xl border border-sidebar-border bg-background/80 p-3 shadow-sm group-data-[collapsible=icon]:hidden">
          <p className="flex items-center gap-1.5 text-xs font-semibold">
            <ChartNoAxesCombined className="size-3.5" />
            Source health
          </p>
          <div className="mt-2 grid gap-1.5 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <CircleCheckBig className="size-3 text-emerald-600 dark:text-emerald-400" />
              Rewardful connected
            </span>
            <span className="flex items-center gap-1.5">
              <CircleCheckBig className="size-3 text-emerald-600 dark:text-emerald-400" />
              PostHog materialized
            </span>
          </div>
        </div>
        <SidebarSeparator className="group-data-[collapsible=icon]:hidden" />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={logout}
              tooltip="Log out"
              className="h-9 rounded-lg px-2.5 text-sidebar-foreground/65 hover:text-sidebar-foreground"
            >
              <LogOut />
              <span>Log out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail className="after:bg-sidebar-border/80" />
    </Sidebar>
  );
}
