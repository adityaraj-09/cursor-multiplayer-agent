"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CircleDot,
  LayoutGrid,
  Layers3,
  Menu,
  Plus,
  Settings2,
  Terminal,
  UserRound,
  X,
} from "lucide-react";
import UserMenu from "./UserMenu";
import type { OrgInfo } from "../lib/api";
import type { WorkspaceScope } from "../lib/workspace";

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

  const sidebar = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
        <div className="flex h-6 w-6 items-center justify-center rounded-[5px] bg-[#e4e4e4] shrink-0">
          <span className="text-[11px] font-semibold text-[#141414]">S</span>
        </div>
        <span className="text-[14px] font-medium text-[#e4e4e4] flex-1">
          Steer
        </span>
        {mobileOpen && (
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="lg:hidden inline-flex h-8 w-8 items-center justify-center rounded-md text-[#a0a0a0] hover:text-[#e4e4e4]"
            aria-label="Close sidebar"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        )}
      </div>

      <nav className="px-3 space-y-0.5">
        <NavItem href="/dashboard" active={pathname === "/dashboard"} icon={Layers3}>
          Sessions
        </NavItem>
        <NavItem
          href="/issues"
          active={pathname === "/issues" || pathname.startsWith("/issues/")}
          icon={CircleDot}
        >
          Issues
        </NavItem>
        <NavItem href="/board" active={pathname === "/board"} icon={LayoutGrid}>
          Board
        </NavItem>
        <NavItem
          href="/cli-pair"
          active={pathname.startsWith("/cli-pair")}
          icon={Terminal}
        >
          Pair CLI
        </NavItem>
        <NavItem
          href="/settings"
          active={
            pathname.startsWith("/settings") ||
            (pathname.includes("/org/") && pathname.endsWith("/settings"))
          }
          icon={Settings2}
        >
          Settings
        </NavItem>
        <NavItem
          href="/profile"
          active={pathname.startsWith("/profile")}
          icon={UserRound}
        >
          Profile
        </NavItem>
      </nav>

      <div className="mt-6 px-3 min-h-0 flex-1 flex flex-col">
        <p className="px-2 mb-1.5 text-[10px] font-medium uppercase tracking-wide text-[#6e6e6e]">
          Workspace
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto space-y-0.5 pr-0.5">
          <WorkspaceButton
            active={scope === "personal"}
            onClick={() => onSelectScope("personal")}
          >
            Personal
          </WorkspaceButton>
          {orgs.map((org) => (
            <WorkspaceButton
              key={org.id}
              active={scope === org.id}
              onClick={() => onSelectScope(org.id)}
            >
              {org.name}
            </WorkspaceButton>
          ))}
        </div>
        <button
          type="button"
          onClick={onNewTeam}
          className={`mt-1 flex h-8 w-full items-center gap-2 rounded-md px-2 text-[12px] transition-colors ${
            creatingTeam
              ? "bg-[#252525] text-[#e4e4e4]"
              : "text-[#6e6e6e] hover:bg-[#1e1e1e] hover:text-[#e4e4e4]"
          }`}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          New team
        </button>
      </div>

      <div className="shrink-0 border-t border-[#2b2b2b] p-3">
        <Link
          href={createHref}
          className="mb-3 flex h-9 items-center justify-center rounded-md bg-[#e4e4e4] text-[13px] font-medium text-[#141414] hover:bg-white transition-colors"
        >
          New session
        </Link>
        <div className="flex items-center gap-2.5 px-0.5">
          <UserMenu />
          <div className="min-w-0">
            <p className="truncate text-[12px] text-[#e4e4e4]">
              {userName || "Account"}
            </p>
            <p className="truncate text-[11px] text-[#6e6e6e]">Signed in</p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#141414] text-[#e4e4e4]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[240px] border-r border-[#2b2b2b] bg-[#171717] lg:block">
        {sidebar}
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
            {sidebar}
          </aside>
        </div>
      )}

      <div className="lg:pl-[240px] min-h-screen flex flex-col">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[#2b2b2b] bg-[#141414]/95 px-3 sm:px-5 backdrop-blur lg:hidden">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#2b2b2b] bg-[#1f1f1f] text-[#a0a0a0] hover:text-[#e4e4e4]"
              aria-label="Open menu"
            >
              <Menu className="h-4 w-4" strokeWidth={1.75} />
            </button>
            <span className="text-[14px] font-medium truncate">Steer</span>
          </div>
          <Link
            href={createHref}
            className="h-8 px-3 rounded-md bg-[#e4e4e4] text-[#141414] text-[12px] font-medium hover:bg-white inline-flex items-center"
          >
            New
          </Link>
        </header>
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  );
}

function NavItem({
  href,
  active,
  icon: Icon,
  children,
}: {
  href: string;
  active: boolean;
  icon: typeof LayoutGrid;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors ${
        active
          ? "bg-[#252525] text-[#e4e4e4]"
          : "text-[#a0a0a0] hover:bg-[#1e1e1e] hover:text-[#e4e4e4]"
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
      {children}
    </Link>
  );
}

function WorkspaceButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-8 w-full items-center rounded-md px-2 text-left text-[12px] truncate transition-colors ${
        active
          ? "bg-[#17202a] text-[#8ec5ff]"
          : "text-[#a0a0a0] hover:bg-[#1e1e1e] hover:text-[#e4e4e4]"
      }`}
    >
      {children}
    </button>
  );
}
