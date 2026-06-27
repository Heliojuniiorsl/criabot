import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";

export function LegalPage({
  title,
  description,
  sections,
}: {
  title: string;
  description: string;
  sections: Array<{ title: string; text: string }>;
}) {
  return (
    <main className="noise min-h-screen px-5 py-10 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-sm font-extrabold text-[#aaa6b4] hover:text-white"
        >
          <ArrowLeft size={16} />
          Voltar ao CriaBot
        </Link>
        <div className="glass rounded-3xl p-6 sm:p-10">
          <div className="mb-6 grid size-12 place-items-center rounded-2xl bg-[#c8ff4d]/10 text-[#c8ff4d]">
            <ShieldCheck size={23} />
          </div>
          <h1 className="text-3xl font-black tracking-[-.05em] sm:text-4xl">
            {title}
          </h1>
          <p className="mt-4 text-sm leading-7 text-[#918d9a]">{description}</p>
          <div className="mt-9 space-y-7">
            {sections.map((section) => (
              <section key={section.title}>
                <h2 className="text-base font-black">{section.title}</h2>
                <p className="mt-2 text-sm leading-7 text-[#918d9a]">
                  {section.text}
                </p>
              </section>
            ))}
          </div>
          <p className="mt-10 border-t border-white/[.07] pt-5 text-xs text-[#6f6b78]">
            Última atualização: 22 de junho de 2026.
          </p>
        </div>
      </div>
    </main>
  );
}
