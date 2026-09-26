/**
 * Which quant of each catalog model suits this PC, and the three "For you" picks. Pure; the Hub recomputes it
 * whenever the hardware or catalog changes.
 */
import type { Catalog, CatalogModel, CatalogQuant } from "./catalog"
import { planFit, score, type Fit, type HardwareProfile, type Tier } from "./fit"
import { quantLevel } from "./quant"

/** Models are fitted for agent use (tools + a long prompt); chat needs less, so one context serves both. */
export const AGENT_CONTEXT = 32768

const TIER_RANK: Record<Tier, number> = { ideal: 0, good: 1, slow: 2, extreme: 3, "wont-run": 4 }
// Below this a model is too slow to recommend, however smart it is.
const MIN_USABLE_SPEED = 5

export type QuantFit = { quant: CatalogQuant; fit: Fit; score: number }
export type ModelFit = { model: CatalogModel; best: QuantFit; quants: QuantFit[] }
export type Picks = { fast?: ModelFit; balanced?: ModelFit; quality?: ModelFit }

export function recommend(catalog: Catalog, hardware: HardwareProfile) {
  const fits = catalog.models.map((model) => fitModel(model, hardware))
  return { fits, picks: pick(fits) }
}

export function fitModel(model: CatalogModel, hardware: HardwareProfile): ModelFit {
  const quants = model.quants.map((quant) => {
    const fit = planFit(model.shape, { size: quant.size, mmprojSize: model.mmproj?.size }, hardware, {
      targetContext: AGENT_CONTEXT,
    })
    return {
      quant,
      fit,
      score: score(fit, { paramsActiveB: effectiveParams(model) / 1e9, quant: quant.quant }, AGENT_CONTEXT),
    }
  })
  return { model, quants, best: bestQuant(model, quants) }
}

export function tierRank(tier: Tier) {
  return TIER_RANK[tier]
}

/** Tools plus room for the agent prompt; 16–32k gets the trimmed local toolset later, below that it's chat only. */
export function agentReady(model: CatalogModel, fit: Fit) {
  // A tools-capable chat template isn't enough: small models loop on malformed calls. The curated `agent` tag
  // marks models whose tool calling was checked.
  return (
    model.tags.includes("agent") && model.capabilities.tools && fit.context >= AGENT_CONTEXT && fit.tier !== "wont-run"
  )
}

/**
 * The best tier wins. If the model runs ideally anyway, spare memory goes to quality (up to 6-bit);
 * otherwise stay on the recommended ~4-bit quant, since bigger only gets slower.
 */
function bestQuant(model: CatalogModel, quants: QuantFit[]) {
  const top = Math.min(...quants.map((item) => TIER_RANK[item.fit.tier]))
  const candidates = quants.filter((item) => TIER_RANK[item.fit.tier] === top)
  const sensible = candidates.filter((item) => quantLevel(item.quant.quant) >= 3 && quantLevel(item.quant.quant) <= 6)
  const pool = sensible.length ? sensible : candidates
  const largest = pool.toSorted((a, b) => b.quant.size - a.quant.size)[0]
  if (top === TIER_RANK.ideal) return largest
  return pool.find((item) => item.quant.quant === model.recommendedQuant) ?? largest
}

/**
 * Fast: the quickest capable model. Balanced: the best overall score. Max quality: the smartest model that
 * still answers at a usable speed. Uncensored models come first in every slot; each model is picked once.
 */
function pick(fits: ModelFit[]): Picks {
  // Without a GPU nothing is better than "slow", so there the usable ones are those fast enough to chat with.
  const good = fits.filter((item) => TIER_RANK[item.best.fit.tier] <= TIER_RANK.good)
  const runs = good.length ? good : fits.filter((item) => usable(item) && item.best.fit.tier === "slow")
  const capable = runs.filter((item) => effectiveParams(item.model) >= 3e9)
  const fast = first(
    (capable.length ? capable : runs).toSorted((a, b) => b.best.fit.tokensPerSecond - a.best.fit.tokensPerSecond),
  )
  const balanced = first(runs.filter((item) => distinct(item, [fast])).toSorted((a, b) => b.best.score - a.best.score))
  const smartest = fits
    .filter((item) => distinct(item, [fast, balanced]) && usable(item))
    .toSorted((a, b) => effectiveParams(b.model) - effectiveParams(a.model))
  const quality = first(smartest.filter((item) => TIER_RANK[item.best.fit.tier] <= TIER_RANK.good)) ?? first(smartest)
  return { fast, balanced, quality }
}

/** Not already picked, and not the official twin of a picked uncensored model (same base). */
function distinct(item: ModelFit, picked: (ModelFit | undefined)[]) {
  return !picked.some(
    (other) => other && (other === item || (other.model.base && other.model.base === item.model.base)),
  )
}

function usable(item: ModelFit) {
  return TIER_RANK[item.best.fit.tier] <= TIER_RANK.slow && item.best.fit.tokensPerSecond >= MIN_USABLE_SPEED
}

function first(sorted: ModelFit[]) {
  return sorted.find((item) => item.model.uncensored) ?? sorted[0]
}

/** MoE models are roughly as capable as a dense model of sqrt(total × active) parameters. */
export function effectiveParams(model: CatalogModel) {
  return model.paramsActive ? Math.sqrt(model.paramsTotal * model.paramsActive) : model.paramsTotal
}
