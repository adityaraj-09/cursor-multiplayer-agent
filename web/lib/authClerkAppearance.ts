/** Clerk theme for the split auth page — cards stay rectangular; pills are buttons only. */
export const authClerkAppearance = {
  layout: {
    socialButtonsPlacement: "top" as const,
    socialButtonsVariant: "blockButton" as const,
    showOptionalFields: true,
  },
  variables: {
    colorBackground: "transparent",
    colorForeground: "#f5f5f5",
    colorMutedForeground: "#8a8a8a",
    colorInput: "#0a0a0a",
    colorInputForeground: "#f5f5f5",
    colorPrimary: "#f4f4f5",
    colorPrimaryForeground: "#111111",
    colorText: "#f5f5f5",
    colorTextSecondary: "#8a8a8a",
    colorInputBackground: "#0a0a0a",
    colorInputText: "#f5f5f5",
    colorTextOnPrimaryBackground: "#111111",
    colorDanger: "#f07070",
    colorSuccess: "#3ecf8e",
    colorNeutral: "#8a8a8a",
    borderRadius: "0.75rem",
  },
  elements: {
    rootBox: "steer-auth-clerk w-full",
    card: "steer-auth-card bg-transparent shadow-none border-0 p-0 w-full",
    cardBox: "steer-auth-card bg-transparent shadow-none border-0 w-full",
    main: "w-full",
    headerTitle:
      "text-[28px] sm:text-[32px] font-semibold tracking-tight text-white",
    headerSubtitle: "text-[14px] text-white/45 mt-2",
    formHeaderTitle: "text-[22px] font-semibold tracking-tight text-white",
    formHeaderSubtitle: "text-[13px] text-white/45",
    socialButtons: "flex flex-col gap-2.5 w-full",
    socialButtonsBlockButton:
      "steer-auth-pill bg-[#f4f4f5] hover:bg-white border-0 text-[#111] shadow-none",
    socialButtonsBlockButtonText: "text-[#111] text-[13px] font-medium",
    dividerLine: "bg-white/12",
    dividerText: "text-[#6e6e6e] text-[11px] tracking-[0.14em] uppercase",
    formFieldLabel: "text-[#a0a0a0] text-[13px]",
    formFieldInput:
      "steer-auth-pill bg-black border border-white/18 text-[#f5f5f5] placeholder:text-[#6e6e6e]",
    formFieldInputShowPasswordButton: "text-[#8a8a8a] hover:text-[#f5f5f5]",
    formFieldErrorText: "text-[#f07070]",
    formButtonPrimary:
      "steer-auth-pill bg-[#f4f4f5] hover:bg-white text-[#111] border-0 shadow-none font-medium",
    formButtonReset: "text-[#8a8a8a] hover:text-[#f5f5f5]",
    footer: "bg-transparent border-0 shadow-none",
    footerActionText: "text-white/45",
    footerActionLink: "text-white underline underline-offset-4",
    identityPreviewText: "text-[#f5f5f5]",
    identityPreviewEditButton: "text-[#8a8a8a] hover:text-[#f5f5f5]",
    alternativeMethodsBlockButton:
      "steer-auth-pill bg-[#f4f4f5] hover:bg-white border-0 text-[#111]",
    alternativeMethodsBlockButtonText: "text-[#111]",
    otpCodeFieldInput:
      "bg-black border border-white/18 text-[#f5f5f5] rounded-xl",
  },
} as const;
