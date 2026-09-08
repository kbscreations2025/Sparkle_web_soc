"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MonitorSmartphone } from "lucide-react";
import { AuthShell, AuthField, AuthError, AuthSubmitButton } from "@/components/auth/AuthShell";
import { OtpCodeInput } from "@/components/auth/OtpCodeInput";
import { useAuth } from "@/lib/auth-context";
import { login, verifyOtp, type ApiResult, type ApiUser, type ActiveSession, type AuthPayload } from "@/lib/api";
import { homeFor } from "@/lib/shell";

const OTP_LENGTH = 6;

/**
 * Why the backend let someone through the central login but not into this app.
 * Without these, a valid sign-in that no organization has provisioned just
 * returns the person to a blank form with no idea what went wrong.
 */
const DENIAL_MESSAGES: Record<string, string> = {
  not_provisioned: "You do not have access to this application yet. Ask an admin to add you.",
  account_inactive: "Your account here is not active. Ask an admin to restore it.",
  ambiguous_tenant: "Your account belongs to more than one organization. Ask an admin to resolve it.",
  signed_out_elsewhere: "You were signed out because this account signed in on another device.",
};

/** Which call was refused, so the confirm retries that same one. */
type ConflictSource = "credentials" | "otp";

type Conflict = {
  source: ConflictSource;
  sessions: ActiveSession[];
  maxSessions?: number;
  message?: string;
};

/** "2 Sept, 14:30" — enough to recognise a session, without the noise. */
function formatStarted(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** The full UA string is unreadable; the browser and OS are what identify a device. */
function describeDevice(userAgent?: string) {
  if (!userAgent) return "Unknown device";
  const browser =
    /edg/i.test(userAgent) ? "Edge"
    : /chrome|crios/i.test(userAgent) ? "Chrome"
    : /firefox|fxios/i.test(userAgent) ? "Firefox"
    : /safari/i.test(userAgent) ? "Safari"
    : null;
  const os =
    /windows/i.test(userAgent) ? "Windows"
    : /android/i.test(userAgent) ? "Android"
    : /iphone|ipad|ios/i.test(userAgent) ? "iOS"
    : /mac os|macintosh/i.test(userAgent) ? "macOS"
    : /linux/i.test(userAgent) ? "Linux"
    : null;

  if (browser && os) return `${browser} on ${os}`;
  return browser || os || "Unknown device";
}

export default function LoginPage() {
  const router = useRouter();
  const { setUser } = useAuth();
  const [step, setStep] = useState<"credentials" | "sessions" | "otp">("credentials");
  const [email, setEmail] = useState("");
  // Held past the credentials step on purpose: the force-logout retry has to
  // resend the identical request, so discarding it here would mean asking the
  // user to type their password again just to confirm.
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [conflict, setConflict] = useState<Conflict | null>(null);
  // The proxy redirects here with ?denied=<code> when the central login
  // accepted them but this app did not. Shown until they submit again.
  const deniedCode = useSearchParams().get("denied");
  const [error, setError] = useState(deniedCode ? DENIAL_MESSAGES[deniedCode] ?? "" : "");
  const [loading, setLoading] = useState(false);

  // Runs an auth call and hands the result to `onResult`, centralizing the
  // loading/error/network-failure handling shared by every step.
  async function submitStep<T>(
    request: () => Promise<ApiResult<T>>,
    onResult: (result: ApiResult<T>) => void
  ) {
    setError("");
    setLoading(true);
    try {
      onResult(await request());
    } catch {
      setError("Could not reach the login service");
    } finally {
      setLoading(false);
    }
  }

  // Seeding the user here is what lets the dashboard paint immediately instead
  // of asking the backend who just signed in.
  function enterApp(user: ApiUser | undefined) {
    if (user) setUser(user);
    // Super admins get the console, everyone else the dashboard — the same rule
    // the proxy applies, so this never lands somewhere it gets bounced from.
    router.push(user ? homeFor(user) : "/");
  }

  /**
   * Both verify-login and verify-otp can answer with any of the same four
   * statuses, so they share one handler. `source` records which call this was,
   * so a session conflict knows what to retry once the user confirms.
   */
  function handleAuthResult(result: ApiResult<AuthPayload>, source: ConflictSource) {
    if (result.status === "success") {
      setConflict(null);
      return enterApp(result.user);
    }

    if (result.status === "session_limit_reached") {
      setConflict({
        source,
        sessions: result.active_sessions ?? [],
        maxSessions: result.max_active_sessions,
        message: result.message,
      });
      setStep("sessions");
      return;
    }

    // Reached from the credentials step on a new device, and again after a
    // force-logout there: clearing the conflict doesn't excuse this device from
    // proving itself, so it still lands on the OTP step.
    if (result.status === "otp_required") {
      setConflict(null);
      setStep("otp");
      return;
    }

    setConflict(null);
    setError(result.message || (source === "otp" ? "Invalid or expired OTP" : "Invalid email or password"));
  }

  function handleCredentialsSubmit(e: FormEvent) {
    e.preventDefault();
    submitStep(
      () => login(email, password),
      (result) => handleAuthResult(result, "credentials")
    );
  }

  function handleOtpSubmit(e: FormEvent) {
    e.preventDefault();
    if (otp.trim().length !== OTP_LENGTH) {
      setError(`Enter the ${OTP_LENGTH}-digit code.`);
      return;
    }
    submitStep(
      () => verifyOtp(email, otp.trim()),
      (result) => handleAuthResult(result, "otp")
    );
  }

  // The confirmed retry. Repeats whichever call was refused — with the same OTP
  // where that's the one that hit the limit, since it was never consumed.
  function handleForceLogout(e: FormEvent) {
    e.preventDefault();
    if (!conflict) return;

    const { source } = conflict;
    submitStep(
      () => (source === "otp" ? verifyOtp(email, otp.trim(), true) : login(email, password, true)),
      (result) => handleAuthResult(result, source)
    );
  }

  function backToCredentials() {
    setStep("credentials");
    setConflict(null);
    setOtp("");
    setError("");
  }

  if (step === "sessions") {
    const { sessions, maxSessions, message } = conflict ?? { sessions: [] };

    return (
      <AuthShell eyebrow="Already Signed In">
        <form onSubmit={handleForceLogout} className="space-y-3.5">
          <p className="text-[12px] leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>
            {message ||
              "You're already logged in elsewhere on this application. Continue here to end that session."}
          </p>

          {sessions.length > 0 && (
            <ul className="space-y-1.5">
              {sessions.map((session) => {
                const started = formatStarted(session.created_at);
                return (
                  <li
                    key={session.session_id}
                    className="flex items-start gap-2.5 rounded-xl px-3 py-2.5"
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    <MonitorSmartphone
                      size={14}
                      className="mt-0.5 shrink-0"
                      style={{ color: "rgba(196,168,106,0.8)" }}
                    />
                    <div className="min-w-0">
                      <p className="text-[12px] truncate" style={{ color: "rgba(255,255,255,0.82)" }}>
                        {describeDevice(session.user_agent)}
                      </p>
                      <p className="text-[10px] truncate" style={{ color: "rgba(255,255,255,0.38)" }}>
                        {session.ip_address || "unknown IP"}
                        {started && ` · since ${started}`}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Explains the refusal rather than just listing sessions: with a
              limit of 1, "log out the other one" is the only way forward. */}
          {maxSessions !== undefined && (
            <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>
              This application allows {maxSessions} active {maxSessions === 1 ? "session" : "sessions"}.
            </p>
          )}

          {error && <AuthError>{error}</AuthError>}

          <AuthSubmitButton loading={loading} label="Sign out other devices" />

          <button
            type="button"
            onClick={backToCredentials}
            className="w-full text-center text-[11px] transition-colors hover:text-white/70"
            style={{ color: "rgba(255,255,255,0.4)" }}
          >
            Cancel
          </button>
        </form>
      </AuthShell>
    );
  }

  if (step === "otp") {
    return (
      <AuthShell eyebrow="Verify It's You">
        <form onSubmit={handleOtpSubmit} className="space-y-3.5">
          <p className="text-[12px]" style={{ color: "rgba(255,255,255,0.5)" }}>
            Enter the {OTP_LENGTH}-digit code your admin gave you.
          </p>

          <OtpCodeInput value={otp} onChange={setOtp} length={OTP_LENGTH} />

          {error && <AuthError>{error}</AuthError>}

          <AuthSubmitButton loading={loading} label="Verify" />

          <button
            type="button"
            onClick={backToCredentials}
            className="w-full text-center text-[11px] transition-colors hover:text-white/70"
            style={{ color: "rgba(255,255,255,0.4)" }}
          >
            Back
          </button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell eyebrow="Welcome Back">
      <form onSubmit={handleCredentialsSubmit} className="space-y-3.5">
        <AuthField
          label="EMAIL"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          placeholder="name@company.com"
          autoFocus
        />
        <AuthField
          label="PASSWORD"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          placeholder="Enter your password"
        />

        {error && <AuthError>{error}</AuthError>}

        <AuthSubmitButton loading={loading} label="Sign In" />
      </form>
    </AuthShell>
  );
}
