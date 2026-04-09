"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useDemoMode } from "@/lib/demo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogIn, LogOut, User } from "lucide-react";

export function UserMenu() {
  const { user, isAuthenticated, logout } = useAuth();
  const isDemo = useDemoMode();

  // In demo mode without auth, show a "Sign in" button
  if (isDemo && (!isAuthenticated || !user)) {
    return (
      <Link href="/login">
        <Button variant="outline" size="sm" className="gap-2">
          <LogIn className="h-4 w-4" />
          <span className="hidden sm:inline">Sign in</span>
        </Button>
      </Link>
    );
  }

  if (!isAuthenticated || !user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          {user.picture ? (
            <img
              src={user.picture}
              alt=""
              className="h-6 w-6 rounded-full"
              referrerPolicy="no-referrer"
            />
          ) : (
            <User className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">{user.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <div className="px-2 py-1.5 text-sm text-muted-foreground">
          {user.email}
        </div>
        <DropdownMenuItem onClick={logout}>
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
