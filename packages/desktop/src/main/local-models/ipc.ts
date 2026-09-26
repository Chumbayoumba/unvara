import { app, ipcMain } from "electron"
import type { LocalModelsSettings } from "@opencode-ai/app/local-models/types"
import type { LocalModelsController } from "./controller"

/** IPC for the local AI stack; mirrors wsl/ipc.ts (one state subscription per renderer). */
export function registerLocalModelsIpcHandlers(controller: LocalModelsController) {
  const subscriptions = new Map<number, () => void>()
  const unsubscribe = (id: number) => {
    subscriptions.get(id)?.()
    subscriptions.delete(id)
  }

  app.once("will-quit", () => {
    subscriptions.forEach((off) => off())
    subscriptions.clear()
  })

  ipcMain.handle("local-models-subscribe", (event) => {
    const id = event.sender.id
    if (subscriptions.has(id)) return
    subscriptions.set(
      id,
      controller.subscribe((state) => {
        if (event.sender.isDestroyed()) return unsubscribe(id)
        event.sender.send("local-models-event", state)
      }),
    )
    event.sender.once("destroyed", () => unsubscribe(id))
  })
  ipcMain.handle("local-models-unsubscribe", (event) => unsubscribe(event.sender.id))
  ipcMain.handle("local-models-get-state", () => controller.getState())
  ipcMain.handle("local-models-scan-hardware", () => controller.scanHardware())
  ipcMain.handle("local-models-catalog", () => controller.getCatalog())
  ipcMain.handle("local-models-download", (_, catalogId: string, quant: string) =>
    controller.download(catalogId, quant),
  )
  ipcMain.handle("local-models-download-pause", (_, id: string) => controller.pauseDownload(id))
  ipcMain.handle("local-models-download-resume", (_, id: string) => controller.resumeDownload(id))
  ipcMain.handle("local-models-download-cancel", (_, id: string) => controller.cancelDownload(id))
  ipcMain.handle("local-models-remove", (_, id: string) => controller.removeModel(id))
  ipcMain.handle("local-models-import-sources", () => controller.importSources())
  ipcMain.handle("local-models-import-folder", (_, dir: string) => controller.importFolder(dir))
  ipcMain.handle("local-models-update-settings", (_, patch: Partial<LocalModelsSettings>) =>
    controller.updateSettings(patch),
  )
}
