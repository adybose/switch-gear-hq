import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { POLICIES } from './policies';

export function generateStaticParams() {
  return Object.keys(POLICIES).map((slug) => ({ slug }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return { title: POLICIES[slug]?.title ?? 'Policy' };
}

export default async function PolicyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const policy = POLICIES[slug];
  if (!policy) notFound();

  return (
    <article className="max-w-2xl space-y-6">
      <h1 className="text-3xl font-bold">{policy.title}</h1>
      {policy.sections.map((section) => (
        <section key={section.heading} className="space-y-2">
          <h2 className="text-lg font-semibold">{section.heading}</h2>
          {section.body.map((paragraph) => (
            <p key={paragraph} className="text-neutral-700">
              {paragraph}
            </p>
          ))}
        </section>
      ))}
    </article>
  );
}
