/** Shared Clerk dark-theme styling for Steer. */
export const steerClerkAppearance = {
  variables: {
    colorBackground: "#1a1a1a",
    colorText: "#e4e4e4",
    colorTextSecondary: "#a0a0a0",
    colorInputBackground: "#252525",
    colorInputText: "#e4e4e4",
    colorPrimary: "#e4e4e4",
    colorDanger: "#f07070",
    colorSuccess: "#3ecf8e",
    borderRadius: "0.375rem",
  },
  elements: {
    rootBox: "w-full",
    card: "bg-[#1a1a1a] border border-[#2b2b2b] shadow-none",
    navbar: "bg-[#1a1a1a] border-[#2b2b2b]",
    navbarButton: "text-[#a0a0a0] hover:text-[#e4e4e4]",
    navbarButtonIcon: "text-[#a0a0a0]",
    pageScrollBox: "bg-[#1a1a1a]",
    page: "bg-[#1a1a1a]",
    profileSection: "border-[#2b2b2b]",
    profileSectionTitle: "text-[#e4e4e4]",
    profileSectionTitleText: "text-[#e4e4e4]",
    profileSectionContent: "text-[#a0a0a0]",
    profileSectionPrimaryButton:
      "bg-[#252525] border border-[#2b2b2b] text-[#e4e4e4] hover:bg-[#2e2e2e]",
    formFieldLabel: "text-[#a0a0a0]",
    formFieldInput:
      "bg-[#252525] border border-[#2b2b2b] text-[#e4e4e4] focus:border-[#4d9fff]",
    formButtonPrimary:
      "bg-[#e4e4e4] text-[#141414] hover:bg-white border-0",
    formButtonReset: "text-[#a0a0a0] hover:text-[#e4e4e4]",
    badge: "bg-[#252525] text-[#a0a0a0] border border-[#2b2b2b]",
    avatarBox: "border border-[#2b2b2b]",
    headerTitle: "text-[#e4e4e4]",
    headerSubtitle: "text-[#6e6e6e]",
    accordionTriggerButton: "text-[#e4e4e4] hover:bg-[#252525]",
    accordionContent: "bg-[#141414]",
    userPreviewMainIdentifier: "text-[#e4e4e4]",
    userPreviewSecondaryIdentifier: "text-[#6e6e6e]",
    userButtonPopoverCard: "bg-[#1a1a1a] border border-[#2b2b2b] shadow-xl",
    userButtonPopoverActionButton:
      "text-[#e4e4e4] hover:bg-[#252525]",
    userButtonPopoverActionButtonText: "text-[#e4e4e4]",
    userButtonPopoverActionButtonIcon: "text-[#a0a0a0]",
    userButtonPopoverFooter: "hidden",
  },
} as const;
