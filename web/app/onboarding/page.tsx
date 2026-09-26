"use client";

import Image from "next/image";
import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  GitFork,
  LoaderCircle,
  Upload,
} from "lucide-react";
import {
  fetchWorkspaceGithub,
  startWorkspaceGithubOAuth,
  type WorkspaceGithubInfo,
} from "../../lib/api";

const ARTWORK =
  "/images/34deb6335ecf73e9008dc9907d50b9a2874b44f2bcbe233f4aa77e24da9ab071.png";

const roles = [
  { value: "founder", label: "Founder", detail: "Building and shipping the product" },
  { value: "engineering", label: "Engineering", detail: "Writing and reviewing code" },
  { value: "product", label: "Product", detail: "Planning and coordinating work" },
  { value: "design", label: "Design", detail: "Crafting the product experience" },
  { value: "other", label: "Something else", detail: "Exploring how Steer can help" },
];

const sources = [
  "A friend or colleague",
  "X / Twitter",
  "GitHub",
  "Search",
  "YouTube or a podcast",
  "Other",
];

function OnboardingPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoaded } = useUser();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(() =>
    searchParams.get("step") === "connect" ? 2 : 0,
  );
  const [username, setUsername] = useState("");
  const [avatar, setAvatar] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState("");
  const [role, setRole] = useState("");
  const [source, setSource] = useState("");
  const [github, setGithub] = useState<WorkspaceGithubInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const redirect = useMemo(() => {
    const requested = searchParams.get("redirect") || "/dashboard";
    return requested.startsWith("/") && !requested.startsWith("//")
      ? requested
      : "/dashboard";
  }, [searchParams]);

  useEffect(() => {
    if (isLoaded && !user) {
      router.replace(
        `/login?redirect=${encodeURIComponent(`/onboarding?redirect=${redirect}`)}`,
      );
    }
  }, [isLoaded, redirect, router, user]);

  useEffect(() => {
    if (!user) return;
    // Clerk hydrates the user after the first client render; seed editable fields once it arrives.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUsername(user.username || "");
    const metadata = user.unsafeMetadata as {
      role?: string;
      discoverySource?: string;
    };
    setRole(metadata.role || "");
    setSource(metadata.discoverySource || "");
  }, [user]);

  useEffect(() => {
    if (!user || step !== 2) return;
    fetchWorkspaceGithub()
      .then(setGithub)
      .catch(() => setGithub(null));
  }, [step, user]);

  useEffect(
    () => () => {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    },
    [avatarPreview],
  );

  const chooseAvatar = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Choose a PNG, JPG, or WebP image.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Choose an image smaller than 10 MB.");
      return;
    }
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatar(file);
    setAvatarPreview(URL.createObjectURL(file));
    setError("");
  };

  const saveProfile = async () => {
    if (!user) return;
    const cleanUsername = username.trim();
    if (!/^[a-zA-Z0-9_-]{3,30}$/.test(cleanUsername)) {
      setError("Use 3–30 letters, numbers, underscores, or hyphens.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await user.update({ username: cleanUsername });
      if (avatar) await user.setProfileImage({ file: avatar });
      setStep(1);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "We couldn’t save your profile.",
      );
    } finally {
      setBusy(false);
    }
  };

  const savePreferences = async () => {
    if (!user) return;
    if (!role || !source) {
      setError("Choose a role and how you found Steer.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await user.update({
        unsafeMetadata: {
          ...user.unsafeMetadata,
          role,
          discoverySource: source,
        },
      });
      setStep(2);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "We couldn’t save your answers.",
      );
    } finally {
      setBusy(false);
    }
  };

  const connectGithub = async () => {
    setBusy(true);
    setError("");
    try {
      const returnTo = `/onboarding?step=connect&redirect=${encodeURIComponent(redirect)}`;
      window.location.href = await startWorkspaceGithubOAuth({ returnTo });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "We couldn’t connect GitHub.",
      );
      setBusy(false);
    }
  };

  const finish = async () => {
    if (!user) return;
    setBusy(true);
    setError("");
    try {
      await user.update({
        unsafeMetadata: {
          ...user.unsafeMetadata,
          onboardingComplete: true,
          onboardingCompletedAt: new Date().toISOString(),
        },
      });
      router.push(redirect);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "We couldn’t finish setup.",
      );
      setBusy(false);
    }
  };

  if (!isLoaded || !user) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#080808] text-white/45">
        <LoaderCircle className="h-5 w-5 animate-spin" />
      </main>
    );
  }

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#080808] px-4 py-8 text-white sm:px-8 sm:py-12">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(72,116,164,0.12),transparent_38%)]" />

      <section className="relative mx-auto grid min-h-[680px] w-full max-w-[1040px] overflow-hidden rounded-[28px] border border-white/10 bg-[#0d0d0d] shadow-[0_40px_120px_rgba(0,0,0,0.65)] lg:grid-cols-[0.9fr_1.1fr]">
        <aside className="relative min-h-[240px] overflow-hidden lg:min-h-full">
          <Image
            src={ARTWORK}
            alt="A watercolor path opening toward the sea"
            fill
            priority
            sizes="(max-width: 1024px) 100vw, 450px"
            className="object-cover object-top"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0b0b0b] via-transparent to-black/5" />
          <div className="absolute inset-x-0 bottom-0 p-7 sm:p-9">
            <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-[10px] border border-white/20 bg-black/35 text-sm font-semibold backdrop-blur-md">
              S
            </div>
            <p className="max-w-[310px] text-[22px] font-medium leading-[1.2] tracking-[-0.035em] text-white">
              Your team’s control room for building with agents.
            </p>
            <p className="mt-3 max-w-[300px] text-[13px] leading-relaxed text-white/58">
              A few details now help us shape your first workspace around the
              way you build.
            </p>
          </div>
        </aside>

        <div className="flex min-h-[540px] flex-col px-6 py-7 sm:px-10 sm:py-9 lg:px-12">
          <header className="flex items-center justify-between gap-6">
            <span className="text-[12px] font-medium uppercase tracking-[0.16em] text-white/38">
              Set up your workspace
            </span>
            <div className="flex items-center gap-1.5" aria-label={`Step ${step + 1} of 3`}>
              {[0, 1, 2].map((item) => (
                <span
                  key={item}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    item === step
                      ? "w-8 bg-white"
                      : item < step
                        ? "w-4 bg-[#78a7cf]"
                        : "w-4 bg-white/14"
                  }`}
                />
              ))}
            </div>
          </header>

          <div className="my-auto py-10">
            {step === 0 && (
              <div className="animate-fade-up">
                <p className="mb-3 text-[12px] font-medium text-[#8fb7d8]">
                  Step 1 of 3 · Your profile
                </p>
                <h1 className="text-[32px] font-medium leading-tight tracking-[-0.045em] sm:text-[38px]">
                  Let’s put a name to the work.
                </h1>
                <p className="mt-3 max-w-md text-[14px] leading-relaxed text-white/48">
                  This is how teammates will recognize you in rooms, reviews,
                  and live sessions.
                </p>

                <div className="mt-8 flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                  <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full border border-white/10 bg-white/[0.06]">
                    <Image
                      src={avatarPreview || user.imageUrl}
                      alt=""
                      fill
                      sizes="56px"
                      className="object-cover"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium">Profile photo</p>
                    <p className="mt-0.5 text-[11px] text-white/38">
                      PNG, JPG, or WebP · 10 MB max
                    </p>
                  </div>
                  <input
                    ref={fileInputRef}
                    className="hidden"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={chooseAvatar}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex h-9 items-center gap-2 rounded-full border border-white/14 px-3.5 text-[12px] font-medium transition hover:border-white/30 hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8fb7d8]"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Upload
                  </button>
                </div>

                <label className="mt-5 block text-[12px] font-medium text-white/62" htmlFor="username">
                  Username
                </label>
                <div className="mt-2 flex h-12 items-center rounded-xl border border-white/12 bg-black/25 px-4 transition focus-within:border-[#8fb7d8]/70 focus-within:ring-2 focus-within:ring-[#8fb7d8]/10">
                  <span className="mr-2 text-white/28">@</span>
                  <input
                    id="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="yourname"
                    autoComplete="username"
                    className="h-full w-full bg-transparent text-[14px] outline-none placeholder:text-white/22"
                  />
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="animate-fade-up">
                <p className="mb-3 text-[12px] font-medium text-[#8fb7d8]">
                  Step 2 of 3 · Make it yours
                </p>
                <h1 className="text-[32px] font-medium leading-tight tracking-[-0.045em] sm:text-[38px]">
                  How do you work?
                </h1>
                <p className="mt-3 text-[14px] text-white/48">
                  We’ll use this to tailor examples and defaults—not your access.
                </p>

                <fieldset className="mt-7">
                  <legend className="text-[12px] font-medium text-white/62">Your role</legend>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {roles.map((item) => (
                      <button
                        type="button"
                        key={item.value}
                        onClick={() => setRole(item.value)}
                        className={`relative rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8fb7d8] ${
                          role === item.value
                            ? "border-[#8fb7d8]/70 bg-[#8fb7d8]/10"
                            : "border-white/10 bg-white/[0.02] hover:border-white/20"
                        }`}
                      >
                        <span className="block text-[13px] font-medium">{item.label}</span>
                        <span className="mt-0.5 block text-[10px] text-white/35">{item.detail}</span>
                        {role === item.value && (
                          <Check className="absolute right-3 top-3 h-3.5 w-3.5 text-[#9bc3e2]" />
                        )}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <label className="mt-6 block text-[12px] font-medium text-white/62" htmlFor="source">
                  Where did you hear about Steer?
                </label>
                <select
                  id="source"
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  className="mt-2 h-12 w-full appearance-none rounded-xl border border-white/12 bg-[#101010] px-4 text-[13px] outline-none transition focus:border-[#8fb7d8]/70 focus:ring-2 focus:ring-[#8fb7d8]/10"
                >
                  <option value="" disabled>
                    Select one
                  </option>
                  {sources.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </div>
            )}

            {step === 2 && (
              <div className="animate-fade-up">
                <p className="mb-3 text-[12px] font-medium text-[#8fb7d8]">
                  Step 3 of 3 · Connect your tools
                </p>
                <h1 className="text-[32px] font-medium leading-tight tracking-[-0.045em] sm:text-[38px]">
                  Bring your repositories.
                </h1>
                <p className="mt-3 max-w-md text-[14px] leading-relaxed text-white/48">
                  Connect GitHub so agents can work from your repositories and
                  open pull requests when the work is ready.
                </p>

                <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.025] p-5">
                  <div className="flex items-center gap-4">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-black">
                      <GitFork className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-medium">GitHub</p>
                      <p className="mt-0.5 truncate text-[11px] text-white/38">
                        {github?.connected
                          ? github.login
                            ? `Connected as @${github.login}`
                            : "Account connected"
                          : "Repository access and pull requests"}
                      </p>
                    </div>
                    {github?.connected && (
                      <CheckCircle2 className="h-5 w-5 text-[#69c99a]" />
                    )}
                  </div>

                  {!github?.connected && (
                    <button
                      type="button"
                      onClick={() => void connectGithub()}
                      disabled={busy || github === null}
                      className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/14 text-[13px] font-medium transition hover:border-white/30 hover:bg-white/[0.05] disabled:opacity-45"
                    >
                      {busy ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : (
                        <GitFork className="h-4 w-4" />
                      )}
                      Connect GitHub
                    </button>
                  )}
                </div>

                <p className="mt-4 text-[11px] leading-relaxed text-white/30">
                  Steer only requests the permissions needed to read repositories
                  and create branches and pull requests. You can disconnect anytime.
                </p>
              </div>
            )}

            {error && (
              <p role="alert" className="mt-5 text-[12px] text-[#f08b8b]">
                {error}
              </p>
            )}
          </div>

          <footer className="flex items-center gap-3 border-t border-white/[0.07] pt-6">
            {step > 0 && (
              <button
                type="button"
                onClick={() => {
                  setError("");
                  setStep((current) => current - 1);
                }}
                disabled={busy}
                className="inline-flex h-11 items-center gap-2 rounded-full px-3 text-[12px] text-white/42 transition hover:text-white disabled:opacity-40"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </button>
            )}
            <div className="flex-1" />
            {step === 2 && !github?.connected && (
              <button
                type="button"
                onClick={() => void finish()}
                disabled={busy}
                className="h-11 px-3 text-[12px] text-white/38 transition hover:text-white disabled:opacity-40"
              >
                I’ll do this later
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                step === 0
                  ? void saveProfile()
                  : step === 1
                    ? void savePreferences()
                    : void finish()
              }
              disabled={busy || (step === 2 && !github?.connected)}
              className="inline-flex h-11 min-w-[138px] items-center justify-center gap-2 rounded-full bg-white px-5 text-[13px] font-semibold text-black transition hover:bg-[#e7eef4] disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8fb7d8] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d0d0d]"
            >
              {busy && step !== 2 ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : step === 2 ? (
                "Enter Steer"
              ) : (
                <>
                  Continue
                  <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          </footer>
        </div>
      </section>
    </main>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-dvh items-center justify-center bg-[#080808] text-white/45">
          <LoaderCircle className="h-5 w-5 animate-spin" />
        </main>
      }
    >
      <OnboardingPageInner />
    </Suspense>
  );
}
