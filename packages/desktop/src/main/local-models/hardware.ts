import { execFile } from "node:child_process"
import { join } from "node:path"
import type { EngineDevice, GpuInfo } from "@opencode-ai/app/local-models/types"

const GIB = 1024 ** 3

// Registry VRAM is exact for every vendor; Win32_VideoController.AdapterRAM is a uint32 and caps at 4 GB.
const GPU_SCRIPT = `
$items = Get-ChildItem 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}' -ErrorAction SilentlyContinue |
  ForEach-Object { Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue } |
  Where-Object { $_.DriverDesc } |
  ForEach-Object { [pscustomobject]@{ name = $_.DriverDesc; vram = [int64]$_.'HardwareInformation.qwMemorySize'; driver = $_.DriverVersion } }
ConvertTo-Json -Compress -InputObject @($items)
`

export async function detectGpus(): Promise<GpuInfo[]> {
  const [registry, nvidia] = await Promise.all([readRegistryGpus(), readNvidiaSmi()])
  const gpus = registry
    .filter((gpu) => !/parsec|hyper-v|basic display|remote display|virtual/i.test(gpu.name))
    .map((gpu): GpuInfo => {
      const vendor = vendorOf(gpu.name)
      const smi = nvidia.find((item) => item.name === gpu.name)
      return {
        name: gpu.name,
        vendor,
        vram: gpu.vram,
        driver: smi?.driver ?? gpu.driver,
        computeCap: smi?.computeCap,
        vramFree: smi?.free,
        // iGPUs report a small dedicated carve-out and borrow system RAM.
        integrated: vendor !== "nvidia" && gpu.vram < 2 * GIB,
      }
    })
  return gpus.toSorted((a, b) => Number(a.integrated) - Number(b.integrated) || b.vram - a.vram)
}

/** The GPU models should run on: the discrete card with the most VRAM, if any. */
export function primaryGpu(gpus: GpuInfo[]) {
  return gpus.find((gpu) => !gpu.integrated && gpu.vram >= 2 * GIB)
}

/** Parses `llama-server --list-devices`, e.g. `Vulkan0: NVIDIA GeForce RTX 3070 Ti (8017 MiB, 7249 MiB free)`. */
export async function listEngineDevices(binary: string): Promise<EngineDevice[]> {
  const output = await run(binary, ["--list-devices"])
  return [...output.matchAll(/^\s*(\S+): (.+) \((\d+) MiB, (\d+) MiB free\)\s*$/gm)].map((match) => ({
    id: match[1],
    name: match[2],
    total: Number(match[3]) * 1024 * 1024,
    free: Number(match[4]) * 1024 * 1024,
  }))
}

/** Pins llama.cpp to the primary GPU so it never splits a model across a discrete card and an iGPU. */
export function pickDevice(devices: EngineDevice[], gpu: GpuInfo | undefined) {
  if (!gpu) return undefined
  return devices.find((device) => device.name === gpu.name) ?? devices.find((device) => gpu.name.includes(device.name))
}

async function readRegistryGpus() {
  const output = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", GPU_SCRIPT]).catch(() => "[]")
  const parsed: { name: string; vram: number | null; driver?: string }[] = JSON.parse(output.trim() || "[]")
  return parsed.map((gpu) => ({ name: gpu.name.trim(), vram: gpu.vram ?? 0, driver: gpu.driver }))
}

async function readNvidiaSmi() {
  const binary = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "nvidia-smi.exe")
  const output = await run(binary, [
    "--query-gpu=name,memory.total,memory.free,driver_version,compute_cap",
    "--format=csv,noheader,nounits",
  ]).catch(() => "")
  return output
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const [name, total, free, driver, cap] = line.split(",").map((part) => part.trim())
      return {
        name,
        total: Number(total) * 1024 * 1024,
        free: Number(free) * 1024 * 1024,
        driver,
        computeCap: Number(cap),
      }
    })
}

function vendorOf(name: string): GpuInfo["vendor"] {
  if (/nvidia|geforce|quadro|rtx|gtx/i.test(name)) return "nvidia"
  if (/amd|radeon/i.test(name)) return "amd"
  if (/intel|arc|iris|uhd/i.test(name)) return "intel"
  return "other"
}

function run(binary: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile(binary, args, { windowsHide: true, timeout: 20_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && !stdout) return reject(error)
      resolve(`${stdout}\n${stderr}`)
    })
  })
}
