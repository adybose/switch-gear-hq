import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="space-y-3 py-12 text-center">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="text-neutral-600">That tee, collection or page doesn&apos;t exist.</p>
      <Link href="/" className="inline-block font-medium underline">
        Back to the shop
      </Link>
    </div>
  );
}
