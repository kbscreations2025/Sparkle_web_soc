"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthShell, AuthField, AuthError, AuthSubmitButton } from "@/components/auth/AuthShell";
import { OtpCodeInput } from "@/components/auth/OtpCodeInput";
import { useAuth } from "@/lib/auth-context";
import { login, verifyOtp, type ApiResult, type ApiUser } from "@/lib/api";

const OTP_LENGTH = 6;

export default function LoginPage() {
  const router = useRouter();
  const { setUser } = useAuth();
  const [step, setStep] = useState<"credentials" | "otp">("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Runs an auth call and hands the result to `onResult`, centralizing the
  // loading/error/network-failure handling shared by both steps.
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
    router.push("/");
  }

  function handleCredentialsSubmit(e: FormEvent) {
    e.preventDefault();
    submitStep(
      () => login(email, password),
      (result) => {
        if (result.status === "otp_required") setStep("otp");
        else if (result.status === "success") enterApp(result.user);
        else setError(result.message || "Invalid email or password");
      }
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
      (result) => {
        if (result.status === "success") enterApp(result.user);
        else setError(result.message || "Invalid or expired OTP");
      }
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
            onClick={() => {
              setStep("credentials");
              setOtp("");
              setError("");
            }}
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
