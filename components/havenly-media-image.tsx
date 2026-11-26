"use client";

import { massageWellnessBlur } from "@/lib/massage-wellness-blur";
import Image, { type ImageProps } from "next/image";

type HavenlyMediaImageProps = Omit<
  ImageProps,
  "src" | "placeholder" | "blurDataURL"
> & {
  src: string;
};

/**
 * Local next/image wrapper with catalog blur placeholders to avoid white flashes.
 * Callers control priority / sizes / fill; lazy remains the default.
 */
export default function HavenlyMediaImage({
  src,
  alt,
  className,
  ...rest
}: HavenlyMediaImageProps) {
  const blur = massageWellnessBlur(src);

  return (
    <Image
      src={src}
      alt={alt}
      className={className}
      {...(blur
        ? { placeholder: "blur" as const, blurDataURL: blur }
        : {})}
      {...rest}
    />
  );
}
