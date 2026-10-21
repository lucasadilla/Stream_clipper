import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc } from "@/components/LegalDoc";

export const metadata: Metadata = {
  title: "Data deletion instructions",
  description: "Disconnect a social account or request deletion of your Clipper data.",
  alternates: { canonical: "https://streamclipper.stream/data-deletion" },
};

export default function DataDeletionPage() {
  return (
    <LegalDoc title="Data deletion instructions" updated="October 21, 2026">
      <h2>Disconnect a social account</h2>
      <p>
        Sign in to Clipper, open <Link href="/settings/connected-accounts">Connected accounts</Link>,
        and choose Disconnect beside the account. This removes the stored connection tokens
        and prevents new publishing attempts through that connection. An upload
        already in progress may still finish.
      </p>
      <p>
        You can also remove Clipper from the connected apps or business integrations
        settings of the social platform. Disconnecting does not delete posts already
        published on that platform; manage those posts on the platform itself.
      </p>
      <h2>Request deletion of your Clipper data</h2>
      <p>
        Email <a href="mailto:streamclipperadmin@proton.me?subject=Clipper%20data%20deletion%20request">streamclipperadmin@proton.me</a>{" "}
        from the email address associated with your Clipper account. Include
        “Clipper data deletion request” in the subject and specify whether you
        want a particular social connection or all account data deleted. If the
        request concerns Facebook or Instagram, include the Page name or
        Instagram username so we can identify the relevant connection.
      </p>
      <p>
        Do not send passwords, access tokens, or identity documents. If you no
        longer have access to your account email, tell us so we can arrange
        another way to verify the request.
      </p>
      <p>
        Our <Link href="/privacy">Privacy Policy</Link> explains data retention,
        including the limits that apply to backups, logs, and records retained
        for legal obligations.
      </p>
    </LegalDoc>
  );
}
