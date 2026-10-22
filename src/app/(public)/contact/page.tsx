import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/primitives";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = { title: "Contact" };

export default function Contact() {
  return (
    <div className="mx-auto max-w-xl px-5 py-14">
      <PageHeader eyebrow="Contact" title="Say" accent="hello.">Questions about your account, a charity, or how the draw works? Send us a note.</PageHeader>
      <ContactForm />
    </div>
  );
}
