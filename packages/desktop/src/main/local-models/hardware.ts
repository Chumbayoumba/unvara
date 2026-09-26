import { execFile } from "node:child_process"
import os from "node:os"
import { join } from "node:path"
import { Worker } from "node:worker_threads"
import type { DiskInfo, EngineDevice, GpuInfo, SystemInfo } from "@opencode-ai/app/local-models/types"

const GIB = 1024 ** 3

// Registry VRAM is exact for every vendor; Win32_VideoController.AdapterRAM is a uint32 and caps at 4 GB.
const GPU_SCRIPT = `
$items = Get-ChildItem 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}' -ErrorAction SilentlyContinue |
  ForEach-Object { Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue } |
  Where-Object { $_.DriverDesc } |
  ForEach-Object { [pscustomobject]@{ name = $_.DriverDesc; vram = [int64]$_.'HardwareInformation.qwMemorySize'; driver = $_.DriverVersion } }
ConvertTo-Json -Compress -InputObject @($items)
`

const DISK_SCRIPT = `
$physical = Get-PhysicalDisk -ErrorAction SilentlyContinue
$items = Get-Volume -ErrorAction SilentlyContinue | Where-Object { $_.DriveLetter -and $_.DriveType -eq 'Fixed' } | ForEach-Object {
  $part = Get-Partition -DriveLetter $_.DriveLetter -ErrorAction SilentlyContinue | Select-Object -First 1
  $disk = $physical | Where-Object { $_.DeviceId -eq [string]$part.DiskNumber } | Select-Object -First 1
  [pscustomobject]@{ letter = [string]$_.DriveLetter; free = [int64]$_.SizeRemaining; size = [int64]$_.Size; media = [string]$disk.MediaType; bus = [string]$disk.BusType }
}
ConvertTo-Json -Compress -InputObject @($items)
`

/** Everything the fit engine needs, in one pass (a few hundred ms plus an 80 ms memory benchmark). */
export async function detectSystem(): Promise<SystemInfo> {
  const [gpus, disks, bandwidth] = await Promise.all([detectGpus(), detectDisks(), measureRamBandwidth()])
  const cpus = os.cpus()
  return {
    gpus,
    // On Windows os.freemem() is "available" memory (free + standby), which is what can hold a model.
    ram: { total: os.totalmem(), available: os.freemem(), bandwidth },
    cpu: { name: cpus[0]?.model.trim() ?? "CPU", cores: cpus.length },
    disks,
    os: `${os.type()} ${os.release()}`,
    scannedAt: Date.now(),
  }
}

/** Largest free fixed drive, preferring NVMe/SSD — the default home for models. */
export function bestModelsDrive(disks: DiskInfo[]) {
  const rank = (disk: DiskInfo) => (disk.kind === "hdd" ? 0 : 1)
  return disks.toSorted((a, b) => rank(b) - rank(a) || b.free - a.free)[0]
}

async function detectDisks(): Promise<DiskInfo[]> {
  const output = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", DISK_SCRIPT]).catch(() => "[]")
  const parsed: { letter: string; free: number; size: number; media: string; bus: string }[] = JSON.parse(
    output.trim() || "[]",
  )
  return parsed.map((disk) => ({
    letter: disk.letter,
    free: disk.free,
    size: disk.size,
    kind: /nvme/i.test(disk.bus) ? "nvme" : /ssd/i.test(disk.media) ? "ssd" : /hdd/i.test(disk.media) ? "hdd" : "unknown",
  }))
}

/**
 * memcpy throughput across several threads (a single thread reaches roughly half of dual-channel DDR5).
 * Mirrors llmfit's approach: ≤ 8 threads × 2 × 32 MiB buffers for ~80 ms.
 */
async function measureRamBandwidth() {
  const threads = Math.min(8, Math.max(1, Math.floor(os.cpus().length / 2)))
  const code = `
    const { parentPort } = require("node:worker_threads")
    const size = 32 * 1024 * 1024
    const a = Buffer.alloc(size, 1), b = Buffer.alloc(size)
    a.copy(b)
    const start = performance.now()
    let bytes = 0
    while (performance.now() - start < 80) { a.copy(b); bytes += size * 2 }
    parentPort.postMessage(bytes / ((performance.now() - start) / 1000))
  `
  const rates = await Promise.all(
    Array.from(
      { length: threads },
      () =>
        new Promise<number>((resolve) => {
          const worker = new Worker(code, { eval: true })
          worker.once("message", (rate: number) => resolve(rate))
          worker.once("error", () => resolve(0))
        }),
    ),
  )
  const total = rates.reduce((sum, rate) => sum + rate, 0) / 1e9
  return total > 0 ? Math.round(total) : undefined
}

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
