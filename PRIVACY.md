# Privacy

Unvara runs AI models on your computer. Your chats, files and settings stay on it. There is no account, no telemetry,
no analytics and no crash reporting to any server. The Unvara developers receive no data from the app.

## When Unvara uses the network

Unvara connects to other systems only in these cases:

| What | Where | When |
|---|---|---|
| Models you download | Hugging Face, or the mirror you pick in *Customize → Local AI* | When you start a download |
| Hugging Face search | Hugging Face | While the Hugging Face tab is open |
| The AI engine for your graphics card (CUDA builds of llama.cpp) | GitHub releases of llama.cpp | Once, when your hardware needs it |
| Runtimes for connectors (Bun, uv) and the file-search tool (ripgrep) | Their official GitHub releases | The first time a connector or search needs them |
| The model catalog | This repository, via jsDelivr or GitHub. The file is signed and checked before use | At startup |
| App updates | GitHub Releases of this repository | At startup and periodically |
| Connectors | Whatever service a connector you add talks to (for example web search) | When the agent uses that connector |
| Cloud models | The provider you connect (Anthropic, OpenAI, Google, OpenCode Zen and others) | Only if you connect one; your messages then go to that provider |
| Images in answers | The address of an image a model puts in its answer | When the chat shows that image |

These requests carry only what they need (for example the name of the file to download). They do not include your
chats, your files or anything that identifies you beyond what any web request reveals, such as your IP address.

## Stored on your computer

- Chats and settings: `%APPDATA%\ai.unvara.desktop`
- Engine, runtimes and caches: `%LOCALAPPDATA%\ai.unvara.desktop`
- Models: the models folder you choose (by default `<drive>:\Unvara\models`)
- Logs: `%APPDATA%\ai.unvara.desktop\logs`. They never leave your PC unless you export them yourself with
  *Help → Export Logs…*

Uninstalling Unvara removes the app. Delete the folders above to remove your data and models too.

## Contact

Questions about privacy: [open an issue](https://github.com/Chumbayoumba/unvara/issues).
