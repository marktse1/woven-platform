"use client";
import { useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { getSupabaseClient } from "@/lib/supabase";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

type PayStatus = "idle" | "processing" | "success" | "error";

type Game = {
  id: string;
  title: string;
  price_cents: number;
};

type ItemKind = "game" | "asset";

function GradArt({ className = "" }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden ${className}`}
      style={{ background: "linear-gradient(140deg, #3a7fc4, #7d4bd0)" }}>
      <div className="absolute inset-0" style={{ background: "radial-gradient(70% 60% at 25% 14%, rgba(255,255,255,.30), transparent 60%)" }} />
    </div>
  );
}

function SecureLine({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-1.5 text-[12px] text-dim ${className}`}>
      🔒 <strong className="text-muted font-semibold">Encrypted & PCI-compliant.</strong>
      Payments processed by Stripe — Woven never stores your card number.
    </div>
  );
}

// Inner form — must be inside <Elements>
function CheckoutForm({
  game,
  itemKind,
}: {
  game: Game | null;
  itemKind: ItemKind;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [status, setStatus] = useState<PayStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const priceCents = game?.price_cents ?? 0;
  const taxCents = Math.round(priceCents * 0.08);
  const totalCents = priceCents + taxCents;
  const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;

  const handlePay = async () => {
    if (!stripe || !elements) return;
    setStatus("processing");
    setErrorMsg("");

    const returnUrl = `${window.location.origin}${itemKind === "asset" ? "/marketplace" : "/library"}`;

    const result = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl },
      redirect: "if_required",
    });

    if (result.error) {
      setErrorMsg(result.error.message ?? "Payment failed.");
      setStatus("error");
    } else {
      setStatus("success");
    }
  };

  if (status === "success") {
    return (
      <div className="text-center py-10">
        <div className="w-[54px] h-[54px] rounded-full flex items-center justify-center text-[26px] mx-auto mb-3"
          style={{ background: "rgba(123,194,74,.16)", border: "1px solid rgba(123,194,74,.4)", color: "#a6e06a" }}>✓</div>
        <div className="font-bold text-[17px]">Payment complete</div>
        <div className="text-muted text-[13px] mt-1">
          {itemKind === "asset"
            ? `${game?.title ?? "Your asset"} is ready to download from your Assets tab. A receipt was sent to your email.`
            : `${game?.title ?? "Your game"} is in your Library. A receipt was sent to your email.`}
        </div>
        <a href={itemKind === "asset" ? "/marketplace" : "/library"}>
          <button className="w-full mt-4 py-3 rounded-[9px] font-bold cursor-pointer border-none"
            style={{ background: "linear-gradient(180deg, #56a6e8, #2c6aa0)", color: "#06121d" }}>
            {itemKind === "asset" ? "▶ Back to Marketplace" : "▶ Go to Library"}
          </button>
        </a>
      </div>
    );
  }

  return (
    <div className="grid gap-7 items-start grid-cols-1 lg:grid-cols-[1fr_420px]">
      {/* Left — Payment */}
      <div className="bg-panel border border-line rounded-[10px] p-6">
        <p className="text-[12.5px] font-bold tracking-[.12em] uppercase text-muted mb-4">Payment details</p>

        <PaymentElement options={{ layout: "tabs" }} />

        <div className="h-px bg-line my-4" />
        <SecureLine />

        {errorMsg && (
          <div className="mt-3 text-[13px] text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
            {errorMsg}
          </div>
        )}
      </div>

      {/* Right — Order */}
      <div className="bg-panel border border-line rounded-[10px] p-6">
        <p className="text-[12.5px] font-bold tracking-[.12em] uppercase text-muted mb-1.5">Order summary</p>

        {/* Item */}
        {game && (
          <div className="flex gap-3 py-3.5 border-b border-line">
            <GradArt className="w-[78px] h-12 rounded-md shrink-0" />
            <div className="flex-1">
              <div className="font-semibold text-[14px]">{game.title}</div>
              <div className="text-[12px] text-dim mt-0.5">{itemKind === "asset" ? "Digital asset" : "Base game"}</div>
            </div>
            <div className="font-bold text-right">{fmt(game.price_cents)}</div>
          </div>
        )}

        <div className="flex justify-between text-[14px] py-1.5"><span className="text-muted">Subtotal</span><span className="font-semibold">{fmt(priceCents)}</span></div>
        <div className="flex justify-between text-[14px] py-1.5"><span className="text-muted">Tax (est.)</span><span className="font-semibold">{fmt(taxCents)}</span></div>
        <div className="h-px bg-line my-3" />
        <div className="flex justify-between items-center">
          <span className="text-[15px] text-muted">Total due today</span>
          <span className="text-[24px] font-extrabold">{fmt(totalCents)}</span>
        </div>

        {status === "idle" && (
          <button onClick={handlePay}
            className="w-full mt-4 py-4 rounded-[9px] font-bold text-[15px] cursor-pointer border-none"
            style={{ background: "linear-gradient(180deg, #8bc34a, #5c8a1e)", color: "#0e1a06" }}>
            {`Pay ${fmt(totalCents)}`}
          </button>
        )}

        {status === "processing" && (
          <div className="flex items-center justify-center gap-2.5 text-muted text-[13px] mt-3">
            <span className="w-4 h-4 rounded-full border-2 border-line2 border-t-accent animate-spin-slow" />
            Confirming with Stripe…
          </div>
        )}

        <div className="flex justify-center items-center gap-1.5 text-[12px] text-dim mt-3.5">
          Powered by <strong style={{ color: "#9aa8ff" }}>stripe</strong> · 🔒 Secure
        </div>
      </div>
    </div>
  );
}

// Outer page — fetches clientSecret, then renders Elements wrapper
export default function CheckoutPage() {
  const [game, setGame] = useState<Game | null>(null);
  const [itemKind, setItemKind] = useState<ItemKind>("game");
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gameId = params.get("gameId");
    const assetId = params.get("assetId");

    if (assetId) {
      setItemKind("asset");
      const supabase = getSupabaseClient();
      if (!supabase) { setLoadError("Marketplace unavailable."); return; }

      supabase
        .from("creator_assets")
        .select("id, name, price_cents, visibility")
        .eq("id", assetId)
        .eq("visibility", "sellable")
        .maybeSingle()
        .then(async ({ data }) => {
          if (!data) { setLoadError("Asset not found or no longer for sale."); return; }
          setGame({ id: data.id, title: data.name, price_cents: data.price_cents });

          // No priceCents sent — create-intent derives the charge from the
          // asset's own price_cents server-side for this branch.
          const res = await fetch("/api/checkout/create-intent", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assetId: data.id }),
          });
          const d = await res.json();
          if (d.clientSecret) setClientSecret(d.clientSecret);
          else setLoadError(d.error ?? "Could not create payment.");
        });
      return;
    }

    setItemKind("game");

    if (!gameId) {
      setLoadError("No game selected. Return to the store.");
      return;
    }

    // Fetch game details from Supabase
    const supabase = getSupabaseClient();
    if (!supabase) { setLoadError("Store unavailable."); return; }

    supabase
      .from("games")
      .select("id, title, price_cents")
      .eq("id", gameId)
      .eq("status", "live")
      .maybeSingle()
      .then(async ({ data }) => {
        if (!data) { setLoadError("Game not found."); return; }
        setGame(data as Game);

        // Create PaymentIntent
        const res = await fetch("/api/checkout/create-intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gameId: data.id, priceCents: data.price_cents }),
        });
        const d = await res.json();
        if (d.clientSecret) setClientSecret(d.clientSecret);
        else setLoadError(d.error ?? "Could not create payment.");
      });
  }, []);

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-12 pt-6 pb-16">
      <div className="flex items-center gap-2 text-[12.5px] text-dim mb-4">
        <a href="/" className="hover:text-ink cursor-pointer">Store</a>
        <span>›</span>
        <span className="text-ink">Checkout</span>
      </div>

      <h1 className="text-[30px] font-extrabold tracking-[-0.02em] mb-6">Checkout</h1>

      {loadError ? (
        <div className="bg-panel border border-line rounded-[10px] px-6 py-8 text-center">
          <div className="text-dim text-[14px]">{loadError}</div>
          <a href="/" className="inline-block mt-4 text-accent text-[13px] font-semibold">← Back to store</a>
        </div>
      ) : clientSecret ? (
        <Elements
          stripe={stripePromise}
          options={{
            clientSecret,
            appearance: {
              theme: "night",
              variables: {
                colorPrimary: "#56a6e8",
                colorBackground: "#0a0e13",
                colorText: "#e7eef4",
                colorDanger: "#e87070",
                fontFamily: "inherit",
                borderRadius: "8px",
              },
            },
          }}
        >
          <CheckoutForm
            game={game}
            itemKind={itemKind}
          />
        </Elements>
      ) : (
        <div className="flex items-center justify-center gap-2.5 text-muted text-[13px] py-20">
          <span className="w-4 h-4 rounded-full border-2 border-line2 border-t-accent animate-spin-slow" />
          Loading checkout…
        </div>
      )}
    </div>
  );
}
