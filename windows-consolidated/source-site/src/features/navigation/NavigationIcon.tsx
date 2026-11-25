import type { ReactNode, SVGProps } from 'react'

import type { NavigationIconName } from './types'

type IconProps = SVGProps<SVGSVGElement> & {
  name: NavigationIconName
}

const paths: Record<NavigationIconName, ReactNode> = {
  inbox: (
    <>
      <path d="M4 5.5h16v11.25a2.25 2.25 0 0 1-2.25 2.25H6.25A2.25 2.25 0 0 1 4 16.75V5.5Z" />
      <path d="M4 13h4l1.5 2h5L16 13h4" />
    </>
  ),
  today: (
    <>
      <rect x="4" y="5.5" width="16" height="14" rx="2" />
      <path d="M7.5 3.75v3.5M16.5 3.75v3.5M4 9.5h16M8 13h3M13 13h3M8 16h3" />
    </>
  ),
  upcoming: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  layers: (
    <>
      <path d="m12 4 8 4-8 4-8-4 8-4Z" />
      <path d="m4 12 8 4 8-4M4 16l8 4 8-4" />
    </>
  ),
  search: (
    <>
      <circle cx="10.75" cy="10.75" r="5.75" />
      <path d="m15 15 4.5 4.5" />
    </>
  ),
  command: (
    <>
      <circle cx="8" cy="8" r="2.5" />
      <circle cx="16" cy="16" r="2.5" />
      <path d="m10 10 4 4M8 13.5V16a2.5 2.5 0 0 1-5 0v-1.5M16 10V8a2.5 2.5 0 0 1 5 0v1.5" />
    </>
  ),
  folder: (
    <>
      <path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h4l2 2h6a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5v-9Z" />
      <path d="M3.75 10h16.5" />
    </>
  ),
  tag: (
    <>
      <path d="m4.5 5.5 7.75-.75L19.25 11.75a2.5 2.5 0 0 1 0 3.5l-3.5 3.5a2.5 2.5 0 0 1-3.5 0L5.25 11.75 4.5 5.5Z" />
      <circle cx="8.25" cy="8.75" r="1" />
    </>
  ),
  filter: (
    <>
      <path d="M4 6h16M7 12h10M10 18h4" />
      <circle cx="8" cy="6" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="14" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="11" cy="18" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  star: (
    <path d="m12 3.75 2.55 5.16 5.7.83-4.12 4.02.97 5.68L12 16.76l-5.1 2.68.97-5.68-4.12-4.02 5.7-.83L12 3.75Z" />
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  spark: (
    <>
      <path d="m12 3 1.35 5.65L19 10l-5.65 1.35L12 17l-1.35-5.65L5 10l5.65-1.35L12 3Z" />
      <path d="m18 16 .55 2.45L21 19l-2.45.55L18 22l-.55-2.45L15 19l2.45-.55L18 16Z" />
    </>
  ),
}

export function NavigationIcon({ name, width = 18, height = 18, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={width}
      height={height}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {paths[name]}
    </svg>
  )
}
