"use client";
import { SignInButton, SignUpButton, UserButton, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { useCreatorStatus } from "@/lib/useCreatorStatus";

function CreatorBadge() {
  const { isSignedIn } = useUser();
  const status = useCreatorStatus();
  if (!isSignedIn || status !== "approved") return null;
  return (
    <span
      className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-[.06em] select-none"
      style={{ background: "rgba(86,166,232,.18)", color: "#8fc6f0", border: "1px solid rgba(86,166,232,.3)" }}
    >
      Creator
    </span>
  );
}

export default function AccountStrip() {
  const { isSignedIn } = useUser();

  return (
    <div className="flex items-center gap-[18px] px-12 py-2 text-xs text-dim"
      style={{ background: "rgba(0,0,0,.35)" }}>

      {isSignedIn ? (
        <>
          <Link href="/wishlist" className="hover:text-ink cursor-pointer no-underline text-dim">Wishlist</Link>
          <div className="flex-1" />
          <span className="text-accent font-semibold">$24.50 wallet</span>
          <CreatorBadge />
          <UserButton
            appearance={{
              elements: { avatarBox: "w-6 h-6" },
            }}
          />
        </>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
