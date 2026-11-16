"""Staging/pre-SMS provider adapters for testing before real SMS/Email gateways are wired."""
import re

E164_PATTERN = re.compile(r"^\+91[6-9]\d{9}$")


class StagingSimulatedOTPProvider:
    """Accepts any valid +91 mobile and any non-empty OTP code when explicitly configured."""

    def send_code(self, mobile_e164):
        return bool(E164_PATTERN.fullmatch(str(mobile_e164 or "").strip()))

    def verify_code(self, mobile_e164, code):
        return bool(
            E164_PATTERN.fullmatch(str(mobile_e164 or "").strip())
            and str(code or "").strip()
        )


class StagingSimulatedEmailProvider:
    """Accepts any email verification code when explicitly configured."""

    def send_code(self, email):
        return bool(str(email or "").strip() and "@" in str(email))

    def verify_code(self, email, code):
        return bool(
            str(email or "").strip()
            and "@" in str(email)
            and str(code or "").strip()
        )
