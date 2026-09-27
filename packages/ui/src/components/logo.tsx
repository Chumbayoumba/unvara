import { type ComponentProps } from "solid-js"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        data-slot="logo-logo-mark-o"
        d="M15.38 5.25A8 8 0 1 1 8.62 5.25"
        stroke="var(--uv-ember, #e2a04f)"
        stroke-width="2.25"
        stroke-linecap="round"
      />
      <circle cx="12" cy="3.6" r="1.7" fill="var(--uv-ember, #e2a04f)" />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  // Unvara mark: open ember ring with a spark in the gap (see design/GUIDEBOOK.md).
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M15.38 5.25A8 8 0 1 1 8.62 5.25"
        stroke="var(--uv-ember, #e2a04f)"
        stroke-width="2.25"
        stroke-linecap="round"
      />
      <circle cx="12" cy="3.6" r="1.7" fill="var(--uv-ember, #e2a04f)" />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  // Unvara wordmark: the ember mark followed by the name in the display serif.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 234 42"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g transform="translate(22 0) scale(1.75)">
        <path
          d="M15.38 5.25A8 8 0 1 1 8.62 5.25"
          stroke="var(--uv-ember, #e2a04f)"
          stroke-width="2.25"
          stroke-linecap="round"
        />
        <circle cx="12" cy="3.6" r="1.7" fill="var(--uv-ember, #e2a04f)" />
      </g>
      <text
        x="76"
        y="33"
        fill="var(--icon-strong-base)"
        font-size="34"
        font-weight="500"
        style={{ "font-family": "var(--font-family-serif), Georgia, serif", "letter-spacing": "-0.01em" }}
      >
        Unvara
      </text>
    </svg>
  )
}
