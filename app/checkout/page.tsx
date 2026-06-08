"use client";
import { useState } from "react";

type PayMethod = "card" | "wallet" | "express";
type PayStatus = "idle" | "processing" | "success";

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
      Payments processed by Stripe — Woven never stores your full card number.
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 mb-4">
      <label className="text-[13px] font-semibold text-muted">{label}</label>
      {children}
    </div>
  );
}

const inputCls = "bg-[#0a0e13] border border-line rounded-lg px-3.5 py-3 text-ink text-[14px] w-full outline-none focus:border-accent focus:shadow-[0_0_0_3px_rgba(86,166,232,.14)] transition-[border-color,box-shadow] font-[inherit]";

export default function CheckoutPage() {
  const [method, setMethod] = useState<PayMethod>("card");
  const [passAddon, setPassAddon] = useState(true);
  const [status, setStatus] = useState<PayStatus>("idle");

  const handlePay = () => {
    setStatus("processing");
    setTimeout(() => setStatus("success"), 1700);
  };

  const payMethods: { id: PayMethod; glyph: string; title: string; sub: string }[] = [
    { id: "card",    glyph: "💳",  title: "Card",         sub: "Visa · MC · Amex"  },
    { id: "wallet",  glyph: "◆",   title: "Woven Wallet", sub: "$24.50 available"  },
    { id: "express", glyph: "",   title: "Apple Pay",    sub: "One-tap"           },
  ];

  return (
    <div className="max-w-[1440px] mx-auto px-12 pt-6 pb-16">
      <div className="flex items-center gap-2 text-[12.5px] text-dim mb-4">
        <a className="hover:text-ink cursor-pointer">Store</a>
        <span>›</span>
        <a className="hover:text-ink cursor-pointer">Cart</a>
        <span>›</span>
        <span className="text-ink">Checkout</span>
      </div>

      <h1 className="text-[30px] font-extrabold tracking-[-0.02em] mb-4">Checkout</h1>

      <div className="grid gap-7 items-start" style={{ gridTemplateColumns: "1fr 420px" }}>
        {/* Left — Payment */}
        <div className="bg-panel border border-line rounded-[10px] p-6">
          <p className="text-[12.5px] font-bold tracking-[.12em] uppercase text-muted mb-3.5">Payment method</p>

          {/* Method tabs */}
          <div className="grid grid-cols-3 gap-2.5 mb-5">
            {payMethods.map(m => (
              <button key={m.id} onClick={() => setMethod(m.id)}
                className="flex flex-col gap-1.5 p-3.5 border rounded-[10px] cursor-pointer text-left transition-all"
                style={{
                  background: method === m.id ? "rgba(86,166,232,.14)" : "#1b2836",
                  borderColor: method === m.id ? "#56a6e8" : "#26384a",
                }}>
                <span className="text-[18px]">{m.glyph}</span>
                <span className="font-bold text-[13.5px]">{m.title}</span>
                <span className="text-[11.5px] text-dim">{m.sub}</span>
              </button>
            ))}
          </div>

          {/* Card form */}
          {method === "card" && (
            <div>
              <Field label="Email for receipt">
                <input className={inputCls} defaultValue="maya@example.com" />
              </Field>
              <Field label="Card number">
                <div className="relative">
                  <input className={inputCls} defaultValue="4242 4242 4242 4242" />
                  <div className="absolute right-3 top-[38px] flex gap-1.5">
                    {["VISA", "MC", "AMEX"].map(b => (
                      <span key={b} className="w-[34px] h-[22px] rounded bg-panel3 border border-line flex items-center justify-center text-[9px] font-extrabold text-muted">{b}</span>
                    ))}
                  </div>
                </div>
              </Field>
              <div className="grid grid-cols-3 gap-3.5">
                <Field label="Expiry"><input className={inputCls} defaultValue="09 / 28" /></Field>
                <Field label="CVC"><input className={inputCls} defaultValue="•••" /></Field>
                <Field label="ZIP"><input className={inputCls} defaultValue="94110" /></Field>
              </div>
              <Field label="Name on card">
                <input className={inputCls} defaultValue="Maya Bellweather" />
              </Field>
              <div className="grid grid-cols-2 gap-3.5">
                <Field label="Country">
                  <select className={inputCls + " cursor-pointer"}>
                    {["United States", "United Kingdom", "Canada", "Germany", "Japan"].map(c => <option key={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label=" ">
                  <label className="flex items-center gap-2 text-[12px] text-dim py-3">
                    <input type="checkbox" defaultChecked /> Save card for one-tap buys
                  </label>
                </Field>
              </div>
            </div>
          )}

          {/* Wallet form */}
          {method === "wallet" && (
            <div>
              <div className="flex gap-2.5 p-3.5 rounded-[9px] text-[13px] text-[#bcdcf3] mb-3.5"
                style={{ background: "rgba(86,166,232,.14)", border: "1px solid #2c6aa0" }}>
                ◆ Paying with Woven Wallet. Your balance covers this order — the remainder, if any, falls back to your saved card.
              </div>
              <div className="flex justify-between text-[14px] py-1.5"><span className="text-muted">Wallet balance</span><span className="font-semibold">$24.50</span></div>
              <div className="flex justify-between text-[14px] py-1.5"><span className="text-muted">After this purchase</span><span className="font-semibold">$12.51</span></div>
            </div>
          )}

          {/* Express form */}
          {method === "express" && (
            <div className="flex gap-2.5 p-3.5 rounded-[9px] text-[13px] text-[#bcdcf3]"
              style={{ background: "rgba(86,166,232,.14)", border: "1px solid #2c6aa0" }}>
              Continue with Apple Pay to confirm with Face ID. No card details needed.
            </div>
          )}

          <div className="h-px bg-line my-4" />
          <SecureLine />
        </div>

        {/* Right — Order */}
        <div className="bg-panel border border-line rounded-[10px] p-6">
          <p className="text-[12.5px] font-bold tracking-[.12em] uppercase text-muted mb-1.5">Order summary</p>

          {/* Item */}
          <div className="flex gap-3 py-3.5 border-b border-line">
            <GradArt className="w-[78px] h-12 rounded-md shrink-0" />
            <div className="flex-1">
              <div className="font-semibold text-[14px]">Hollow Tide</div>
              <div className="text-[12px] text-dim mt-0.5">Base game · Lantern Few</div>
            </div>
            <div className="font-bold text-right">
              $11.99<span className="block text-right text-[11px] text-dim line-through">$15.99</span>
            </div>
          </div>

          {/* Pass addon */}
          <button onClick={() => setPassAddon(v => !v)}
            className="flex items-center gap-3 w-full px-3.5 py-3 my-3.5 rounded-[9px] text-left cursor-pointer transition-colors"
            style={{ border: "1px dashed #324a61", background: "transparent" }}>
            <div className="w-5 h-5 rounded-md shrink-0 flex items-center justify-center font-extrabold text-[14px]"
              style={{
                background: passAddon ? "#56a6e8" : "transparent",
                border: passAddon ? "1.5px solid #56a6e8" : "1.5px solid #324a61",
                color: passAddon ? "#06121d" : "transparent",
              }}>✓</div>
            <div className="flex-1">
              <div className="font-semibold text-[13.5px]">Add Woven Pass — 14 days free</div>
              <div className="text-[11.5px] text-dim">Then $9.99/mo · 400+ games · cancel anytime</div>
            </div>
            <div className="font-bold text-green">$0.00</div>
          </button>

          <div className="flex justify-between text-[14px] py-1.5"><span className="text-muted">Subtotal</span><span className="font-semibold">$11.99</span></div>
          <div className="flex justify-between text-[14px] py-1.5"><span className="text-muted">Bundle discount</span><span className="font-semibold text-green">−$4.00</span></div>
          <div className="flex justify-between text-[14px] py-1.5"><span className="text-muted">Tax (CA)</span><span className="font-semibold">$0.96</span></div>
          <div className="h-px bg-line my-4" />
          <div className="flex justify-between items-center">
            <span className="text-[15px] text-muted">Total due today</span>
            <span className="text-[24px] font-extrabold">$8.95</span>
          </div>

          {status === "idle" && (
            <button onClick={handlePay}
              className="w-full mt-4 py-4 rounded-[9px] font-bold text-[15px] cursor-pointer border-none"
              style={{ background: "linear-gradient(180deg, #8bc34a, #5c8a1e)", color: "#0e1a06" }}>
              Pay $8.95
            </button>
          )}

          {status === "processing" && (
            <div className="flex items-center justify-center gap-2.5 text-muted text-[13px] mt-3">
              <span className="w-4 h-4 rounded-full border-2 border-line2 border-t-accent animate-spin-slow" />
              Confirming payment with Stripe…
            </div>
          )}

          {status === "success" && (
            <div className="text-center pt-5">
              <div className="w-[54px] h-[54px] rounded-full flex items-center justify-center text-[26px] mx-auto mb-3"
                style={{ background: "rgba(123,194,74,.16)", border: "1px solid rgba(123,194,74,.4)", color: "#a6e06a" }}>✓</div>
              <div className="font-bold text-[17px]">Payment complete</div>
              <div className="text-muted text-[13px] mt-1">Hollow Tide is in your Library. A receipt was sent to your email.</div>
              <button className="w-full mt-4 py-3 rounded-[9px] font-bold cursor-pointer border-none"
                style={{ background: "linear-gradient(180deg, #56a6e8, #2c6aa0)", color: "#06121d" }}>
                ▶ Play now in browser
              </button>
            </div>
          )}

          <div className="flex justify-center items-center gap-1.5 text-[12px] text-dim mt-3.5">
            Powered by <strong style={{ color: "#9aa8ff" }}>stripe</strong> · 🔒 Secure
          </div>
        </div>
      </div>
    </div>
  );
}
