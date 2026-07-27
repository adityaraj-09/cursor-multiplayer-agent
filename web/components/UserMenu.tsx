"use client";

import { UserButton } from "@clerk/nextjs";
import { steerClerkAppearance } from "../lib/clerkAppearance";

export default function UserMenu() {
  return (
    <UserButton
      userProfileUrl="/profile"
      appearance={{
        ...steerClerkAppearance,
        elements: {
          ...steerClerkAppearance.elements,
          avatarBox: "w-7 h-7",
          userButtonTrigger:
            "rounded-full focus:shadow-none focus:ring-1 focus:ring-[#4d9fff]",
        },
      }}
    />
  );
}
