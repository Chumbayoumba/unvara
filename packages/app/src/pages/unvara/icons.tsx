import type { JSX } from "solid-js"

// Unvara shell icons: 20px grid, 1.5px strokes, round caps — see design/GUIDEBOOK.md#icons.
type IconProps = { class?: string; size?: number }

function Svg(props: IconProps & { children: JSX.Element }) {
  return (
    <svg
      width={props.size ?? 20}
      height={props.size ?? 20}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class}
      aria-hidden="true"
    >
      {props.children}
    </svg>
  )
}

export const UvIcon = {
  NewChat: (props: IconProps) => (
    <Svg {...props}>
      <circle cx="10" cy="10" r="7.25" />
      <path d="M10 6.75v6.5M6.75 10h6.5" />
    </Svg>
  ),
  Search: (props: IconProps) => (
    <Svg {...props}>
      <circle cx="9" cy="9" r="5.25" />
      <path d="m13 13 3.5 3.5" />
    </Svg>
  ),
  Models: (props: IconProps) => (
    <Svg {...props}>
      <path d="M10 2.75 16.25 6.25v7.5L10 17.25 3.75 13.75v-7.5L10 2.75Z" />
      <path d="M3.75 6.25 10 9.75l6.25-3.5M10 9.75v7.5" />
    </Svg>
  ),
  Customize: (props: IconProps) => (
    <Svg {...props}>
      <path d="M4 6h7M15 6h1M4 14h1M9 14h7" />
      <circle cx="13" cy="6" r="2" />
      <circle cx="7" cy="14" r="2" />
    </Svg>
  ),
  Folder: (props: IconProps) => (
    <Svg {...props}>
      <path d="M3.25 5.75c0-.83.67-1.5 1.5-1.5h3.1c.4 0 .78.16 1.06.44l1.15 1.15c.28.28.66.44 1.06.44h4.13c.83 0 1.5.67 1.5 1.5v6.47c0 .83-.67 1.5-1.5 1.5H4.75c-.83 0-1.5-.67-1.5-1.5V5.75Z" />
    </Svg>
  ),
  FolderPlus: (props: IconProps) => (
    <Svg {...props}>
      <path d="M16.75 10V7.78c0-.83-.67-1.5-1.5-1.5h-4.13c-.4 0-.78-.16-1.06-.44L8.91 4.69a1.5 1.5 0 0 0-1.06-.44h-3.1c-.83 0-1.5.67-1.5 1.5v8.5c0 .83.67 1.5 1.5 1.5H10" />
      <path d="M15 12.5v4M13 14.5h4" />
    </Svg>
  ),
  Sidebar: (props: IconProps) => (
    <Svg {...props}>
      <rect x="3" y="3.75" width="14" height="12.5" rx="2.25" />
      <path d="M8 3.75v12.5" />
    </Svg>
  ),
  ChevronLeft: (props: IconProps) => (
    <Svg {...props}>
      <path d="m12 5-5 5 5 5" />
    </Svg>
  ),
  ChevronRight: (props: IconProps) => (
    <Svg {...props}>
      <path d="m8 5 5 5-5 5" />
    </Svg>
  ),
  ChevronDown: (props: IconProps) => (
    <Svg {...props}>
      <path d="m6 8 4 4 4-4" />
    </Svg>
  ),
  Plus: (props: IconProps) => (
    <Svg {...props}>
      <path d="M10 4.75v10.5M4.75 10h10.5" />
    </Svg>
  ),
  Settings: (props: IconProps) => (
    <Svg {...props}>
      <path d="M8.6 3.3a1.5 1.5 0 0 1 2.8 0l.2.5a1.5 1.5 0 0 0 1.9.8l.5-.2a1.5 1.5 0 0 1 2 2l-.2.5a1.5 1.5 0 0 0 .8 1.9l.5.2a1.5 1.5 0 0 1 0 2.8l-.5.2a1.5 1.5 0 0 0-.8 1.9l.2.5a1.5 1.5 0 0 1-2 2l-.5-.2a1.5 1.5 0 0 0-1.9.8l-.2.5a1.5 1.5 0 0 1-2.8 0l-.2-.5a1.5 1.5 0 0 0-1.9-.8l-.5.2a1.5 1.5 0 0 1-2-2l.2-.5a1.5 1.5 0 0 0-.8-1.9l-.5-.2a1.5 1.5 0 0 1 0-2.8l.5-.2a1.5 1.5 0 0 0 .8-1.9l-.2-.5a1.5 1.5 0 0 1 2-2l.5.2a1.5 1.5 0 0 0 1.9-.8l.2-.5Z" />
      <circle cx="10" cy="10" r="2.25" />
    </Svg>
  ),
  Chip: (props: IconProps) => (
    <Svg {...props}>
      <rect x="5" y="5" width="10" height="10" rx="2" />
      <path d="M8 2.75v2.25M12 2.75v2.25M8 15v2.25M12 15v2.25M2.75 8h2.25M2.75 12h2.25M15 8h2.25M15 12h2.25" />
      <rect x="8" y="8" width="4" height="4" rx=".75" />
    </Svg>
  ),
  Dot: (props: IconProps) => (
    <svg width={props.size ?? 20} height={props.size ?? 20} viewBox="0 0 20 20" class={props.class} aria-hidden="true">
      <circle cx="10" cy="10" r="2.5" fill="currentColor" />
    </svg>
  ),
}
