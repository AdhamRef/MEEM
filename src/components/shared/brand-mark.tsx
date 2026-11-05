import Image from "next/image";

/** One `sizes` everywhere, so every use shares a single cached file and the loader never waits for it. */
export function BrandMark({ className }: { className?: string }) {
  return <Image src="/logo.png" alt="" width={1090} height={1088} sizes="96px" loading="eager" aria-hidden className={className} draggable={false} />;
}
