"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CircleDot,
  LayoutGrid,
  Layers3,
  Menu,
  Network,
  PanelLeft,
  PanelLeftClose,
  Plus,
  Settings2,
  Terminal,
  UserRound,
  X,
} from "lucide-react";
import UserMenu from "./UserMenu";
import type { OrgInfo } from "../lib/api";
import type { WorkspaceScope } from "../lib/workspace";

const SIDEBAR_KEY = "steer.sidebarCollapsed";

export default function DashboardShell({
  children,
  orgs,
  scope,
  onSelectScope,
  onNewTeam,
  creatingTeam,
  createHref,
  userName,
}: {
  children: ReactNode;
  orgs: OrgInfo[];
  scope: WorkspaceScope;
  onSelectScope: (next: WorkspaceScope) => void;
  onNewTeam: () => void;
  creatingTeam?: boolean;
  createHref: string;
  userName?: string;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [collapseReady, setCollapseReady] = useState(false);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(SIDEBAR_KEY) === "1");
    setCollapseReady(true);
  }, []);

  useEffect(() => {
    if (!collapseReady) return;
    window.localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
  }, [collapsed, collapseReady]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname, scope]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  const sidebar = (compact: boolean) => (
    <div className="flex h-full min-h-0 flex-col">
      <div className={`flex h-14 shrink-0 items-center ${compact ? "justify-center px-1" : "gap-2.5 px-3"}`}>
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] bg-[#e4e4e4]">
          <span className="text-[11px] font-semibold text-[#141414]">S</span>
        </div>
        {!compact && <span className="min-w-0 flex-1 text-[14px] font-medium text-[#e4e4e4]">Steer</span>}
        <button
          type="button"
          onClick={() => (mobileOpen ? setMobileOpen(false) : setCollapsed((v) => !v))}
          className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-md text-[#6e6e6e] hover:text-[#e4e4e4] lg:inline-flex"
          aria-label={compact ? "Expand sidebar" : "Collapse sidebar"}
          title={compact ? "Expand sidebar" : "Collapse sidebar"}
        >
          {compact ? <PanelLeft className="h-4 w-4" strokeWidth={1.75} /> : <PanelLeftClose className="h-4 w-4" strokeWidth={1.75} />}
        </button>
        {mobileOpen && (
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#a0a0a0] hover:text-[#e4e4e4] lg:hidden"
            aria-label="Close sidebar"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        )}
      </div>

      <nav className={`space-y-0.5 ${compact ? "px-1.5" : "px-3"}`}>
        <NavItem href="/dashboard" active={pathname === "/dashboard"} icon={Layers3} compact={compact}>
          Sessions
        </NavItem>
        <NavItem
          href="/issues"
          active={pathname === "/issues" || pathname.startsWith("/issues/")}
          icon={CircleDot}
          compact={compact}
        >
          Issues
        </NavItem>
        <NavItem
          href="/swarms"
          active={pathname === "/swarms" || pathname.startsWith("/swarms/")}
          icon={Network}
          compact={compact}
        >
          Swarms
        </NavItem>
        <NavItem href="/board" active={pathname === "/board"} icon={LayoutGrid} compact={compact}>
          Board
        </NavItem>
        <NavItem href="/cli-pair" active={pathname.startsWith("/cli-pair")} icon={Terminal} compact={compact}>
          Pair CLI
        </NavItem>
        <NavItem
          href="/settings"
          active={pathname.startsWith("/settings") || (pathname.includes("/org/") && pathname.endsWith("/settings"))}
          icon={Settings2}
          compact={compact}
        >
          Settings
        </NavItem>
        <NavItem href="/profile" active={pathname.startsWith("/profile")} icon={UserRound} compact={compact}>
          Profile
        </NavItem>
      </nav>

      <div className={`mt-6 min-h-0 flex-1 flex flex-col ${compact ? "px-1.5" : "px-3"}`}>
        {!compact && (
          <p className="mb-1.5 px-2 text-[10px] font-medium uppercase tracking-wide text-[#6e6e6e]">Workspace</p>
        )}
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-0.5">
          <WorkspaceButton
            active={scope === "personal"}
            onClick={() => onSelectScope("personal")}
            label="Personal"
            compact={compact}
          />
          {orgs.map((org) => (
            <WorkspaceButton
              key={org.id}
              active={scope === org.id}
              onClick={() => onSelectScope(org.id)}
              label={org.name}
              compact={compact}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={onNewTeam}
          title="New team"
          className={`mt-1 flex h-8 items-center rounded-md text-[12px] transition-colors ${
            compact ? "w-8 justify-center px-0" : "w-full gap-2 px-2"
          } ${creatingTeam ? "bg-[#252525] text-[#e4e4e4]" : "text-[#6e6e6e] hover:bg-[#1e1e1e] hover:text-[#e4e4e4]"}`}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          {!compact && "New team"}
        </button>
      </div>

      <div className={`shrink-0 border-t border-[#2b2b2b] ${compact ? "p-1.5" : "p-3"}`}>
        <Link
          href={createHref}
          title="New session"
          className={`mb-3 flex items-center justify-center rounded-md bg-[#e4e4e4] font-medium text-[#141414] transition-colors hover:bg-white ${
            compact ? "h-8 w-8 text-[16px]" : "h-9 text-[13px]"
          }`}
        >
          {compact ? <Plus className="h-4 w-4" strokeWidth={2} /> : "New session"}
        </Link>
        <div className={`flex items-center ${compact ? "justify-center" : "gap-2.5 px-0.5"}`}>
          <UserMenu />
          {!compact && (
            <div className="min-w-0">
              <p className="truncate text-[12px] text-[#e4e4e4]">{userName || "Account"}</p>
              <p className="truncate text-[11px] text-[#6e6e6e]">Signed in</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#141414] text-[#e4e4e4]">
      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden border-r border-[#2b2b2b] bg-[#171717] transition-[width] duration-200 lg:block ${
          collapsed ? "w-16" : "w-[240px]"
        }`}
      >
        {sidebar(collapsed)}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/55"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative h-full w-[min(280px,86vw)] border-r border-[#2b2b2b] bg-[#171717] shadow-2xl">
            {sidebar(false)}
          </aside>
        </div>
      )}

      <div
        className={`flex min-h-screen flex-col transition-[padding] duration-200 ${
          collapsed ? "lg:pl-16" : "lg:pl-[240px]"
        }`}
      >
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[#2b2b2b] bg-[#141414]/95 px-3 backdrop-blur sm:px-5 lg:hidden">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#2b2b2b] bg-[#1f1f1f] text-[#a0a0a0] hover:text-[#e4e4e4]"
              aria-label="Open menu"
            >
              <Menu className="h-4 w-4" strokeWidth={1.75} />
            </button>
            <span className="truncate text-[14px] font-medium">Steer</span>
          </div>
          <Link
            href={createHref}
            className="inline-flex h-8 items-center rounded-md bg-[#e4e4e4] px-3 text-[12px] font-medium text-[#141414] hover:bg-white"
          >
            New
          </Link>
        </header>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

function NavItem({
  href,
  active,
  icon: Icon,
  compact,
  children,
}: {
  href: string;
  active: boolean;
  icon: typeof LayoutGrid;
  compact: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      title={typeof children === "string" ? children : undefined}
      className={`flex h-8 items-center rounded-md text-[13px] transition-colors ${
        compact ? "w-8 justify-center px-0" : "gap-2.5 px-2"
      } ${active ? "bg-[#252525] text-[#e4e4e4]" : "text-[#a0a0a0] hover:bg-[#1e1e1e] hover:text-[#e4e4e4]"}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
      {!compact && children}
    </Link>
  );
}

function WorkspaceButton({
  active,
  onClick,
  label,
  compact,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  compact: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`flex h-8 items-center rounded-md text-[12px] transition-colors ${
        compact ? "w-8 justify-center px-0" : "w-full px-2 text-left"
      } ${active ? "bg-[#17202a] text-[#8ec5ff]" : "text-[#a0a0a0] hover:bg-[#1e1e1e] hover:text-[#e4e4e4]"}`}
    >
      {compact ? label.slice(0, 1).toUpperCase() : <span className="truncate">{label}</span>}
    </button>
  );
}
