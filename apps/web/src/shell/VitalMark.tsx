import type { SVGProps } from 'react';

/** Canonical pulse/check mark (spec §5). currentColor so rail/auth can tint from tokens. */
export function VitalMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <path
        d="M21.5 6.48A11 11 0 1 1 6.48 10.5"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 16.5L13 22.5L18.5 10.5L21.5 15.5L26 8"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
