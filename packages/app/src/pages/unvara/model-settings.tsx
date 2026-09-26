import { For, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useLocalModels } from "@/local-models/context"
import { kvBytes, planFit, type KvType } from "@/local-models/fit"
import type { LocalModel } from "@/local-models/types"
import { Button, formatMemory } from "./hub"

const CONTEXTS = [4096, 8192, 16384, 32768, 65536, 131072, 262144]
const GIB = 1024 ** 3
// Same compute buffer the fit engine budgets for.
const COMPUTE_BUFFER = 0.5 * GIB

type Flash = "auto" | "on" | "off"

/**
 * Per-model settings: context window with its memory cost, KV cache precision, flash attention, placement knobs for
 * experts, and sampling. Everything maps onto llama.cpp preset keys; changes apply from the next reply.
 */
export function ModelSettings(props: { model: LocalModel; onClose: () => void }) {
  const language = useLanguage()
  const local = useLocalModels()
  const overrides = props.model.overrides ?? {}
  const [form, setForm] = createStore({
    context: props.model.context,
    kv: (overrides["cache-type-k"] === "q8_0" ? "q8_0" : "f16") as KvType,
    flash: (["on", "off"].includes(String(overrides["flash-attn"])) ? overrides["flash-attn"] : "auto") as Flash,
    gpuLayers: text(overrides["n-gpu-layers"]),
    cpuMoe: text(overrides["n-cpu-moe"]),
    threads: text(overrides["threads"]),
    mlock: overrides["mlock"] === true,
    mmap: overrides["no-mmap"] !== true,
    temperature: text(props.model.sampling?.temperature),
    topP: text(props.model.sampling?.topP),
    topK: text(props.model.sampling?.topK),
    minP: text(props.model.sampling?.minP),
  })

  const shape = () => props.model.shape
  const contexts = () => CONTEXTS.filter((value) => value <= (shape()?.contextMax ?? props.model.context))
  const memory = () => {
    const model = shape()
    if (!model || !props.model.size) return
    return props.model.size + kvBytes(model, form.context, form.kv) + COMPUTE_BUFFER
  }
  const tier = () => {
    const model = shape()
    const hardware = local.hardware()
    if (!model || !hardware || !props.model.size) return
    return planFit(model, { size: props.model.size }, hardware, {
      targetContext: form.context,
      minContext: form.context,
    })
  }

  const save = async () => {
    const number = (value: string) => (value.trim() === "" ? undefined : Number(value))
    const rest = Object.fromEntries(
      Object.entries(overrides).filter(
        ([key]) =>
          ![
            "cache-type-k",
            "cache-type-v",
            "flash-attn",
            "n-gpu-layers",
            "n-cpu-moe",
            "threads",
            "mlock",
            "no-mmap",
          ].includes(key),
      ),
    )
    const next = {
      ...rest,
      ...(form.kv === "q8_0" ? { "cache-type-k": "q8_0", "cache-type-v": "q8_0" } : {}),
      ...(form.flash !== "auto" ? { "flash-attn": form.flash } : {}),
      ...defined({
        "n-gpu-layers": number(form.gpuLayers),
        "n-cpu-moe": number(form.cpuMoe),
        threads: number(form.threads),
      }),
      ...(form.mlock ? { mlock: true } : {}),
      ...(form.mmap ? {} : { "no-mmap": true }),
    }
    await local.api?.updateModel(props.model.id, {
      context: form.context,
      overrides: Object.keys(next).length ? next : undefined,
      sampling: defined({
        temperature: number(form.temperature),
        topP: number(form.topP),
        topK: number(form.topK),
        minP: number(form.minP),
      }),
    })
    props.onClose()
  }

  return (
    <div class="flex flex-col gap-5 border-t border-v2-border-border-muted p-4 text-[13px]">
      <Field label={language.t("unvara.model.context")} hint={language.t("unvara.model.context.hint")}>
        <div class="flex items-center gap-3">
          <input
            type="range"
            class="flex-1 accent-(--uv-ember)"
            min={0}
            max={Math.max(0, contexts().length - 1)}
            value={Math.max(0, contexts().indexOf(form.context))}
            onInput={(event) => setForm("context", contexts()[Number(event.currentTarget.value)] ?? form.context)}
          />
          <span class="w-12 text-right text-v2-text-text-base">{Math.round(form.context / 1024)}K</span>
        </div>
        <Show when={memory()}>
          {(bytes) => (
            <span class="text-v2-text-text-faint">
              {language.t("unvara.model.memory", { size: formatMemory(language.intl(), bytes()) })}
              <Show when={tier()}>{(fit) => <> · {language.t(`unvara.hub.tier.${fit().tier}`)}</>}</Show>
            </span>
          )}
        </Show>
      </Field>

      <Field label={language.t("unvara.model.kv")}>
        <Segmented
          value={form.kv}
          options={[
            { value: "f16", label: language.t("unvara.model.kv.f16") },
            { value: "q8_0", label: language.t("unvara.model.kv.q8_0") },
          ]}
          onChange={(value) => setForm("kv", value)}
        />
      </Field>

      <Field label={language.t("unvara.model.flash")}>
        <Segmented
          value={form.flash}
          options={[
            { value: "auto", label: language.t("unvara.model.auto") },
            { value: "on", label: language.t("unvara.model.on") },
            { value: "off", label: language.t("unvara.model.off") },
          ]}
          onChange={(value) => setForm("flash", value)}
        />
      </Field>

      <details class="group flex flex-col gap-3">
        <summary class="cursor-pointer text-v2-text-text-muted hover:text-v2-text-text-base">
          {language.t("unvara.model.advanced")}
        </summary>
        <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <NumberField
            label={language.t("unvara.model.gpuLayers")}
            placeholder={language.t("unvara.model.auto")}
            value={form.gpuLayers}
            onInput={(value) => setForm("gpuLayers", value)}
          />
          <Show when={shape()?.paramsActive}>
            <NumberField
              label={language.t("unvara.model.cpuMoe")}
              placeholder={language.t("unvara.model.auto")}
              value={form.cpuMoe}
              onInput={(value) => setForm("cpuMoe", value)}
            />
          </Show>
          <NumberField
            label={language.t("unvara.model.threads")}
            placeholder={language.t("unvara.model.auto")}
            value={form.threads}
            onInput={(value) => setForm("threads", value)}
          />
        </div>
        <label class="mt-3 flex items-center gap-2 text-v2-text-text-muted">
          <input
            type="checkbox"
            class="accent-(--uv-ember)"
            checked={form.mlock}
            onChange={(event) => setForm("mlock", event.currentTarget.checked)}
          />
          {language.t("unvara.model.mlock")}
        </label>
        <label class="mt-2 flex items-center gap-2 text-v2-text-text-muted">
          <input
            type="checkbox"
            class="accent-(--uv-ember)"
            checked={form.mmap}
            onChange={(event) => setForm("mmap", event.currentTarget.checked)}
          />
          {language.t("unvara.model.mmap")}
        </label>
      </details>

      <Field label={language.t("unvara.model.sampling")}>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumberField
            label={language.t("unvara.model.temperature")}
            value={form.temperature}
            step="0.05"
            onInput={(value) => setForm("temperature", value)}
          />
          <NumberField label="Top P" value={form.topP} step="0.05" onInput={(value) => setForm("topP", value)} />
          <NumberField label="Top K" value={form.topK} onInput={(value) => setForm("topK", value)} />
          <NumberField label="Min P" value={form.minP} step="0.01" onInput={(value) => setForm("minP", value)} />
        </div>
      </Field>

      <div class="flex items-center justify-between gap-3">
        <span class="text-v2-text-text-faint">{language.t("unvara.model.applyNote")}</span>
        <div class="flex gap-2">
          <Button onClick={props.onClose}>{language.t("unvara.hub.action.cancel")}</Button>
          <Button primary onClick={save}>
            {language.t("unvara.model.save")}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Field(props: { label: string; hint?: string; children: JSX.Element }) {
  return (
    <div class="flex flex-col gap-2">
      <div class="flex flex-col gap-0.5">
        <span class="text-[13px] font-[500] text-v2-text-text-base">{props.label}</span>
        <Show when={props.hint}>
          <span class="text-v2-text-text-faint">{props.hint}</span>
        </Show>
      </div>
      {props.children}
    </div>
  )
}

function Segmented<T extends string>(props: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div class="flex h-8 self-start rounded-(--uv-radius) bg-v2-background-bg-layer-02 p-0.5">
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            class="h-7 rounded-(--uv-radius-xs) px-3 transition-colors duration-(--uv-dur-fast)"
            classList={{
              "bg-v2-background-bg-base text-v2-text-text-base shadow-[0_0_0_1px_var(--v2-border-border-muted)]":
                props.value === option.value,
              "text-v2-text-text-faint hover:text-v2-text-text-muted": props.value !== option.value,
            }}
            onClick={() => props.onChange(option.value)}
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  )
}

function NumberField(props: {
  label: string
  value: string
  placeholder?: string
  step?: string
  onInput: (value: string) => void
}) {
  return (
    <label class="flex flex-col gap-1 text-v2-text-text-faint">
      {props.label}
      <input
        type="number"
        step={props.step ?? "1"}
        min="0"
        class="h-8 rounded-(--uv-radius) bg-v2-background-bg-layer-01 px-2 text-[13px] text-v2-text-text-base shadow-[0_0_0_1px_var(--v2-border-border-muted)] outline-none focus:shadow-[0_0_0_1px_var(--uv-ember)]"
        placeholder={props.placeholder}
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
      />
    </label>
  )
}

function text(value: unknown) {
  return value === undefined ? "" : String(value)
}

/** Drops unset keys; an object with nothing set becomes undefined. */
function defined<T extends Record<string, number | undefined>>(values: T) {
  const entries = Object.entries(values).filter((entry): entry is [string, number] => entry[1] !== undefined)
  return entries.length ? (Object.fromEntries(entries) as { [K in keyof T]?: number }) : undefined
}
