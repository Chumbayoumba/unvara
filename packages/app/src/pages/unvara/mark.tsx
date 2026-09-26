// The Unvara mark: an open ring with a spark leaving through the gap — "nothing held back".
export function UnvaraMark(props: { size?: number; class?: string }) {
  return (
    <svg
      width={props.size ?? 24}
      height={props.size ?? 24}
      viewBox="0 0 24 24"
      fill="none"
      class={props.class}
      style={{ color: "var(--uv-ember)" }}
      aria-hidden="true"
    >
      <path d="M15.38 5.25A8 8 0 1 1 8.62 5.25" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" />
      <circle cx="12" cy="3.6" r="1.7" fill="currentColor" />
    </svg>
  )
}

export function UnvaraWordmark(props: { class?: string }) {
  return (
    <span class={`inline-flex items-center gap-2 ${props.class ?? ""}`}>
      <UnvaraMark size={20} />
      <span class="font-(family-name:--font-family-serif) text-[17px] font-[500] tracking-[-0.01em] text-v2-text-text-base">
        Unvara
      </span>
    </span>
  )
}
