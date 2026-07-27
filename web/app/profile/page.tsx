"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { UserProfile, useUser } from "@clerk/nextjs";
import { useAuth } from "../../components/AuthProvider";
import { steerClerkAppearance } from "../../lib/clerkAppearance";

export default function ProfilePage() {
  const { user, loading } = useAuth();
  const { user: clerkUser, isLoaded } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login?redirect=/profile");
    }
  }, [loading, user, router]);

  if (loading || !isLoaded || !clerkUser) {
    return (
      <div className="min-h-screen bg-[#141414] flex items-center justify-center">
        <p className="text-[13px] text-[#6e6e6e]">Loading profile…</p>
      </div>
    );
  }

  const primaryEmail =
    clerkUser.primaryEmailAddress?.emailAddress ||
    clerkUser.emailAddresses[0]?.emailAddress ||
    "—";
  const otherEmails = clerkUser.emailAddresses.filter(
    (e) => e.emailAddress !== primaryEmail,
  );
  const memberSince = clerkUser.createdAt
    ? new Date(clerkUser.createdAt).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "—";

  return (
    <div className="min-h-screen bg-[#141414]">
      <header className="border-b border-[#2b2b2b]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-2 shrink-0 hover:opacity-80 transition-opacity"
            aria-label="Steer home"
          >
            <div className="w-5 h-5 rounded-[4px] bg-[#e4e4e4] flex items-center justify-center">
              <span className="text-[#141414] text-[9px] font-semibold">S</span>
            </div>
            <span className="text-[13px] text-[#a0a0a0] hidden sm:inline">
              Steer
            </span>
          </Link>
          <span className="text-[#2b2b2b]">/</span>
          <span className="text-[13px] text-[#e4e4e4]">Profile</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-6">
        <div>
          <h1 className="text-[22px] font-medium text-[#e4e4e4] tracking-tight">
            Your account
          </h1>
          <p className="text-[13px] text-[#6e6e6e] mt-1">
            Signed in with Clerk — manage email, password, and connected
            accounts below.
          </p>
        </div>

        <section className="rounded-lg border border-[#2b2b2b] bg-[#1a1a1a] p-4 sm:p-5">
          <div className="flex items-start gap-4">
            {clerkUser.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={clerkUser.imageUrl}
                alt=""
                width={56}
                height={56}
                className="w-14 h-14 rounded-full border border-[#2b2b2b] shrink-0 object-cover"
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-[#252525] border border-[#2b2b2b] flex items-center justify-center text-[18px] font-medium text-[#e4e4e4] shrink-0">
                {(clerkUser.fullName || clerkUser.firstName || "U")
                  .charAt(0)
                  .toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="text-[16px] font-medium text-[#e4e4e4] truncate">
                {clerkUser.fullName ||
                  [clerkUser.firstName, clerkUser.lastName]
                    .filter(Boolean)
                    .join(" ") ||
                  clerkUser.username ||
                  "User"}
              </h2>
              <p className="text-[13px] text-[#a0a0a0] truncate mt-0.5">
                {primaryEmail}
              </p>
              <p className="text-[11px] text-[#6e6e6e] mt-2">
                Member since {memberSince}
              </p>
            </div>
          </div>

          <dl className="mt-5 pt-5 border-t border-[#2b2b2b] grid gap-3 sm:grid-cols-2">
            <ProfileField label="Primary email" value={primaryEmail} />
            <ProfileField
              label="Username"
              value={clerkUser.username || "—"}
            />
            <ProfileField label="User ID" value={clerkUser.id} mono />
            <ProfileField
              label="Auth method"
              value={
                clerkUser.externalAccounts.length > 0
                  ? clerkUser.externalAccounts
                      .map((a) => a.provider.replace("oauth_", ""))
                      .join(", ")
                  : "Email"
              }
            />
          </dl>

          {otherEmails.length > 0 && (
            <div className="mt-4 pt-4 border-t border-[#2b2b2b]">
              <p className="text-[11px] text-[#6e6e6e] mb-2">
                Other email addresses
              </p>
              <ul className="space-y-1">
                {otherEmails.map((e) => (
                  <li
                    key={e.id}
                    className="text-[13px] text-[#a0a0a0] font-mono truncate"
                  >
                    {e.emailAddress}
                    {e.verification?.status === "verified" && (
                      <span className="ml-2 text-[10px] text-[#3ecf8e]">
                        verified
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section>
          <h2 className="text-[13px] font-medium text-[#a0a0a0] mb-3">
            Manage account
          </h2>
          <div className="rounded-lg border border-[#2b2b2b] overflow-hidden">
            <UserProfile
              routing="hash"
              appearance={{
                ...steerClerkAppearance,
                elements: {
                  ...steerClerkAppearance.elements,
                  rootBox: "w-full",
                  card: "bg-[#1a1a1a] border-0 shadow-none rounded-none",
                  navbar: "border-b border-[#2b2b2b]",
                  pageScrollBox: "bg-[#1a1a1a] p-0",
                },
              }}
            />
          </div>
        </section>
      </main>
    </div>
  );
}

function ProfileField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-[#6e6e6e] mb-0.5">{label}</dt>
      <dd
        className={`text-[13px] text-[#e4e4e4] truncate ${
          mono ? "font-mono text-[12px]" : ""
        }`}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}
