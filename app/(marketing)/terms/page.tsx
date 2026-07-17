import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc } from "@/components/LegalDoc";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms of Service for Clipper (streamclipper.stream).",
  alternates: { canonical: "https://streamclipper.stream/terms" },
};

export default function TermsPage() {
  return (
    <LegalDoc title="Terms of Service" updated="July 17, 2026">
      <p>
        These Terms of Service (“Terms”) govern your use of Clipper at{" "}
        <a href="https://streamclipper.stream">streamclipper.stream</a>{" "}
        (the “Service”), operated by Stream Clipper (“we”, “us”, or “our”). By
        creating an account or using the Service, you agree to these Terms.
      </p>

      <h2>1. What Clipper does</h2>
      <p>
        Clipper helps creators turn livestreams and VODs into searchable
        timelines, clips, captions, and exports. You may optionally connect
        third-party accounts (such as YouTube, TikTok, X, Facebook, or
        Instagram) to publish clips you create.
      </p>

      <h2>2. Accounts</h2>
      <ul>
        <li>You must provide accurate account information and keep it current.</li>
        <li>
          You are responsible for activity under your account and for keeping
          login credentials secure.
        </li>
        <li>
          You must be at least 13 years old (or the minimum age required in your
          country) to use the Service.
        </li>
      </ul>

      <h2>3. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the Service for illegal, harmful, or abusive content or activity</li>
        <li>
          Upload or publish content you do not have rights to use or distribute
        </li>
        <li>
          Attempt to disrupt, reverse engineer, or abuse the Service or related
          APIs
        </li>
        <li>
          Circumvent plan limits, access controls, or third-party platform rules
        </li>
      </ul>

      <h2>4. Your content</h2>
      <p>
        You retain ownership of content you upload or create with Clipper. You
        grant us a limited license to host, process, transcode, and display that
        content solely to operate the Service for you (including transcription,
        thumbnails, previews, and exports you request).
      </p>
      <p>
        When you publish to a third-party platform, that platform’s terms also
        apply. You are responsible for captions, titles, privacy settings, and
        compliance with each platform’s policies.
      </p>

      <h2>5. Third-party services</h2>
      <p>
        The Service integrates with providers such as OpenAI/OpenRouter,
        Stripe, PostHog, and social platforms. Their availability and policies
        are outside our control. Connecting an account authorizes us to act on
        your behalf only as needed for features you use (for example, uploading
        a clip you choose to publish).
      </p>

      <h2>6. Plans, billing, and beta access</h2>
      <p>
        Paid plans, trials, and invite-only Creator Beta access are subject to
        the pricing and limits shown in the product. Fees are non-refundable
        except where required by law. We may change plans or limits with notice
        where practical.
      </p>

      <h2>7. Disclaimers</h2>
      <p>
        The Service is provided “as is.” We do not guarantee uninterrupted
        availability, perfect transcriptions, or that exports or publishes will
        succeed on third-party platforms. To the fullest extent permitted by
        law, we disclaim warranties of merchantability, fitness for a particular
        purpose, and non-infringement.
      </p>

      <h2>8. Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, we are not liable for indirect,
        incidental, special, consequential, or lost-profit damages, or for loss
        of data, content, or business opportunities arising from your use of
        the Service. Our total liability for any claim relating to the Service
        is limited to the greater of (a) amounts you paid us in the 3 months
        before the claim or (b) $50 USD.
      </p>

      <h2>9. Termination</h2>
      <p>
        You may stop using the Service at any time. We may suspend or terminate
        access if you violate these Terms or if we discontinue the Service. Upon
        termination, your right to use Clipper ends; provisions that should
        survive (including ownership, disclaimers, and liability limits) will
        survive.
      </p>

      <h2>10. Changes</h2>
      <p>
        We may update these Terms. Material changes will be reflected by
        updating the “Last updated” date on this page. Continued use after
        changes means you accept the updated Terms.
      </p>

      <h2>11. Contact</h2>
      <p>
        Questions about these Terms:{" "}
        <a href="mailto:streamclipperadmin@proton.me">
          streamclipperadmin@proton.me
        </a>
        . See also our{" "}
        <Link href="/privacy">Privacy Policy</Link>.
      </p>
    </LegalDoc>
  );
}
