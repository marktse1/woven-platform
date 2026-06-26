"use client";

import type { ReactNode } from "react";

type Props = {
  title: string;
  description: string;
  badge?: string;
  disabled?: boolean;
  children: ReactNode;
  footer?: ReactNode;
};

/** Shared panel chrome for one Pipeline Studio step — reuses the existing card styling. */
export default function StepCard({ title, description, badge, disabled, children, footer }: Props) {
  return (
    <div className="rounded-[12px] p-5" style={disabled ? { opacity: 0.5, pointerEvents: "none" } : undefined}>
      <div className="flex items-center gap-2 mb-1">
        <p className="text-[11px] font-bold tracking-[.12em] uppercase" style={{ color: "#e8e1d5" }}>{title}</p>
        {badge && (
          <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase" style={{ background: "rgba(123,194,74,.16)", color: "#a6e06a" }}>
            {badge}
          </span>
        )}
      </div>
      <p className="text-[12px] mb-3" style={{ color: "#c7bfb2" }}>{description}</p>
      {children}
      {footer && <div className="mt-3 pt-3 border-t border-line">{footer}</div>}
    </div>
  );
}
