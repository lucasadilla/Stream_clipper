import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc } from "@/components/LegalDoc";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy Policy for Clipper (streamclipper.stream).",
  alternates: { canonical: "https://streamclipper.stream/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalDoc title="Privacy Policy" updated="July 17, 2026">
      <p>
        This Privacy Policy explains how Stream Clipper (“we”, “us”, or “our”)
        collects, uses, and shares information when you use Clipper at{" "}
        <a href="https://streamclipper.stream">streamclipper.stream</a>{" "}
        (the “Service”).
      </p>

      <h2>1. Information we collect</h2>
      <ul>
        <li>
          <strong>Account data</strong> — email address and profile details from
          sign-in (for example Google / Auth.js).
        </li>
        <li>
          <strong>Billing data</strong> — plan status and payment-related
          identifiers processed by Stripe (we do not store full card numbers).
        </li>
        <li>
          <strong>Content you provide</strong> — stream URLs, session metadata,
          transcripts, captions, thumbnails, clips, and editor preferences.
        </li>
        <li>
          <strong>Connected social accounts</strong> — OAuth tokens and basic
          profile identifiers (for example open_id / channel id) for platforms
          you choose to connect, stored encrypted where applicable.
        </li>
        <li>
          <strong>Usage &amp; diagnostics</strong> — product analytics (e.g.
          PostHog), logs, and technical data such as IP address, browser type,
          and approximate device info needed to operate and secure the Service.
        </li>
      </ul>

      <h2>2. How we use information</h2>
      <ul>
        <li>Provide, maintain, and improve the Service</li>
        <li>
          Transcribe, analyze, render, and export media you request
        </li>
        <li>
          Publish clips to third-party platforms when you explicitly connect an
          account and start a publish action
        </li>
        <li>Process subscriptions, trials, and Creator Beta access</li>
        <li>Prevent abuse, debug issues, and measure product usage</li>
        <li>Communicate about the Service (security, billing, product updates)</li>
      </ul>

      <h2>3. AI and media processing</h2>
      <p>
        To generate transcripts, embeddings, and related features, we may send
        audio segments or text you submit to AI providers (such as OpenRouter or
        OpenAI). Use those providers only as needed for the features you use.
      </p>

      <h2>4. Sharing</h2>
      <p>We share information with:</p>
      <ul>
        <li>
          <strong>Service providers</strong> that help us run Clipper (hosting,
          database, payments, analytics, AI APIs)
        </li>
        <li>
          <strong>Social platforms</strong> you connect, when you authorize
          publishing or account linking
        </li>
        <li>
          <strong>Legal authorities</strong> when required by law or to protect
          rights and safety
        </li>
      </ul>
      <p>We do not sell your personal information.</p>

      <h2>5. Cookies and similar technologies</h2>
      <p>
        We use cookies and similar storage for authentication, preferences, and
        analytics. You can control cookies through your browser settings; some
        features may not work without them.
      </p>

      <h2>6. Retention</h2>
      <p>
        We retain account, session, and media data while your account is active
        and as needed to operate the Service, comply with law, or resolve
        disputes. You may delete sessions or request account deletion; some
        backups or logs may persist for a limited time.
      </p>

      <h2>7. Security</h2>
      <p>
        We use reasonable technical and organizational measures to protect
        information, including encryption of sensitive social tokens where
        implemented. No method of transmission or storage is 100% secure.
      </p>

      <h2>8. Your choices</h2>
      <ul>
        <li>Disconnect social accounts from Settings at any time</li>
        <li>Delete sessions and related local/media data from the product UI</li>
        <li>
          Request access, correction, or deletion of personal data by emailing
          us
        </li>
      </ul>

      <h2>9. Children</h2>
      <p>
        The Service is not directed to children under 13 (or the equivalent
        minimum age in your region). We do not knowingly collect personal
        information from children.
      </p>

      <h2>10. International users</h2>
      <p>
        We may process information in the United States and other countries
        where our providers operate. By using the Service, you understand your
        information may be transferred to those locations.
      </p>

      <h2>11. Changes</h2>
      <p>
        We may update this Policy and will revise the “Last updated” date when
        we do. Continued use after changes means you accept the updated Policy.
      </p>

      <h2>12. Contact</h2>
      <p>
        Privacy questions or requests:{" "}
        <a href="mailto:streamclipperadmin@proton.me">
          streamclipperadmin@proton.me
        </a>
        . See also our{" "}
        <Link href="/terms">Terms of Service</Link>.
      </p>
    </LegalDoc>
  );
}
