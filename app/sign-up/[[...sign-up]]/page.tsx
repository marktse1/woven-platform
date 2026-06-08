import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "linear-gradient(180deg, #0f151d 0, #0b0f14 360px, #0b0f14 100%)" }}>
      <SignUp
        appearance={{
          elements: {
            rootBox: "w-full max-w-md",
            card: "bg-panel border border-line shadow-[0_24px_60px_rgba(0,0,0,.6)] rounded-[14px]",
            headerTitle: "text-ink text-[22px] font-extrabold tracking-[-0.02em]",
            headerSubtitle: "text-muted text-[13px]",
            socialButtonsBlockButton: "bg-panel2 border border-line text-ink hover:bg-panel3 rounded-[9px]",
            socialButtonsBlockButtonText: "text-ink font-semibold",
            dividerLine: "bg-line",
            dividerText: "text-dim text-[12px]",
            formFieldLabel: "text-muted text-[13px] font-semibold",
            formFieldInput: "bg-[#0a0e13] border border-line rounded-lg text-ink text-[14px] focus:border-accent focus:ring-0 focus:shadow-[0_0_0_3px_rgba(86,166,232,.14)]",
            formButtonPrimary: "rounded-[9px] font-bold text-[14px] bg-gradient-to-b from-accent to-accent2 text-[#06121d] hover:opacity-90",
            footerActionLink: "text-accent font-semibold hover:text-accent",
            footerActionText: "text-dim text-[13px]",
            alertText: "text-bad text-[13px]",
            formFieldErrorText: "text-bad text-[12px]",
            internal: "bg-panel",
          },
          variables: {
            colorBackground: "#16202c",
            colorText: "#e7eef4",
            colorTextSecondary: "#8aa0b4",
            colorPrimary: "#56a6e8",
            colorDanger: "#e35c5c",
            borderRadius: "10px",
            fontFamily: "Inter, sans-serif",
          },
        }}
      />
    </div>
  );
}
