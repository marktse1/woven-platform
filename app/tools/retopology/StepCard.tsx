"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";

type Props = {
  title: string;
  description: string;
  badge?: string;
  badgeColor?: "green" | "purple";
  disabled?: boolean;
  children: ReactNode;
  footer?: ReactNode;
};

/** Shared panel chrome for one Pipeline Studio step — animates in on mount. */
export default function StepCard({ title, description, badge, badgeColor = "green", disabled, children, footer }: Props) {
  const badgeStyle = badgeColor === "purple"
    ? { background: "rgba(108,95,168,.2)", color: "#c4b4ff" }
    : { background: "rgba(123,194,74,.16)", color: "#a6e06a" };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: disabled ? 0.5 : 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-[12px] p-5"
      style={disabled ? { pointerEvents: "none" } : undefined}
    >
      <div className="flex items-center gap-2 mb-1">
        <p className="text-[11px] font-bold tracking-[.12em] uppercase" style={{ color: "#e8e1d5" }}>{title}</p>
        {badge && (
          <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase" style={badgeStyle}>
            {badge}
          </span>
        )}
      </div>
      <p className="text-[12px] mb-3" style={{ color: "#c7bfb2" }}>{description}</p>
      {children}
      {footer && <div className="mt-3 pt-3 border-t border-line">{footer}</div>}
    </motion.div>
  );
}
