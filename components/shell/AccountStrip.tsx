"use client";
import { Show, SignInButton, SignUpButton, SignOutButton, UserButton } from "@clerk/nextjs";
import Link from "next/link";

export default function AccountStrip() {
  return (
    <div className="flex items-center gap-[18px] px-12 py-2 text-xs text-dim"
      style={{ background: "rgba(0,0,0,.35)" }}>

      <Show when="signed-in">
        <Link href="/wishlist" className="hover:text-ink cursor-pointer no-underline text-dim">Wishlist</Link>
        <div className="flex-1" />
        <span className="text-accent font-semibold">$24.50 wallet</span>
        <UserButton
          appearance={{
            elements: {
              avatarBox: "w-6 h-6",
            },
          }}
        />
      </Show>

      <Show when="signed-out">
        <div className="flex-1" />
        <SignInButton mode="redirect">
          <button className="hover:text-ink cursor-pointer bg-transparent border-none text-xs text-dim font-[inherit]">
            Sign in
          </button>
        </SignInButton>
        <SignUpButton mode="redirect">
          <button className="px-3 py-1 rounded-md font-semibold cursor-pointer border-none text-xs"
            style={{ background: "linear-gradient(180deg, #56a6e8, #2c6aa0)", color: "#06121d" }}>
            Create account
          </button>
        </SignUpButton>
      </Show>
    </div>
  );
}
