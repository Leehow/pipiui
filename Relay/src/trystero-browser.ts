import { joinRoom } from "@trystero-p2p/ws-relay";

type Boot = {
  roomID: string;
  password: string;
  signalURL: string;
};
type JSONValue = null | string | number | boolean | JSONValue[] | {
  [key: string]: JSONValue;
};
type CommandBody = { [key: string]: JSONValue };
type CommandResponse = { status: number; body: JSONValue };

declare global {
  interface Window { __PIPI_TRYSTERO_BOOT__?: Boot }
}

const boot = window.__PIPI_TRYSTERO_BOOT__;
if (!boot || !/^[0-9a-f]{64}$/.test(boot.password)) {
  throw new Error("一次性链接无效");
}
delete window.__PIPI_TRYSTERO_BOOT__;

const byID = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const status = byID<HTMLParagraphElement>("status");
const transport = byID<HTMLParagraphElement>("transport");
const projects = byID<HTMLSelectElement>("projects");
const sessions = byID<HTMLSelectElement>("sessions");
const transcript = byID<HTMLElement>("transcript");
const prompt = byID<HTMLTextAreaElement>("prompt");
let activePeer: string | null = null;
let sessionID: string | null = null;
let revision: string | number | null = null;
let pollGeneration = 0;
let revoked = false;

function setStatus(message: string, error = false) {
  status.textContent = message;
  status.className = error ? "error" : "muted";
}

const room = joinRoom({
  appId: "pipiui-remote-v1",
  password: boot.password,
  relayConfig: { urls: [boot.signalURL] },
  ...(["127.0.0.1", "localhost"].includes(new URL(boot.signalURL).hostname)
    ? { _test_only_mdnsHostFallbackToLoopback: true } : {}),
}, boot.roomID, {
  handshakeTimeoutMs: 8_000,
  onPeerHandshake: async (_peerID, send, receive) => {
    await send({ v: 1, role: "browser" });
    const remote = await receive();
    const value = remote.data as { v?: unknown; role?: unknown };
    if (value?.v !== 1 || value?.role !== "host") {
      throw new Error("拒绝非 PipiUI host peer");
    }
  },
  onJoinError: ({ error }) => setStatus(`连接失败：${error}`, true),
});
const action = room.makeAction<
  { command: string; body: CommandBody },
  CommandResponse
>("pipiui-command-v1", { kind: "request" });

async function command(name: string, body: CommandBody) {
  if (revoked || !activePeer) throw new Error("Mac 尚未连接");
  const result = await action.request(
    { command: name, body },
    { target: activePeer, timeoutMs: 15_000 },
  );
  if (!Number.isInteger(result.status) || result.status < 100 || result.status > 599) {
    throw new Error("Mac 返回了无效响应");
  }
  if (result.status === 304) return null;
  if (result.status < 200 || result.status >= 300) {
    const bodyValue = result.body as { error?: unknown } | null;
    throw new Error(typeof bodyValue?.error === "string"
      ? bodyValue.error : `命令失败 (${result.status})`);
  }
  return result.body as any;
}

async function loadIndex() {
  const value = await command("index", {});
  projects.textContent = "";
  for (const item of value?.projects ?? []) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.name;
    projects.append(option);
  }
  sessions.textContent = "";
  for (const item of value?.sessions ?? []) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.title;
    sessions.append(option);
  }
}

async function poll(generation: number) {
  while (sessionID && generation === pollGeneration && activePeer && !revoked) {
    try {
      const value = await command("snapshot", {
        sessionID,
        ...(revision === null ? {} : { sinceRevision: revision }),
      });
      if (value) {
        revision = value.revision;
        transcript.textContent = "";
        for (const message of value.snapshot?.messages ?? []) {
          const node = document.createElement("div");
          node.className = "msg";
          node.textContent = message.kind === "thinking" ? "[thinking]"
            : message.kind === "tool"
              ? `[tool] ${message.toolName || ""} ${message.toolSummary || ""}`
              : message.text;
          transcript.append(node);
        }
      }
    } catch (error) {
      setStatus(String((error as Error).message || error), true);
    }
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
}

room.onPeerJoin = (peerID) => {
  if (activePeer && activePeer !== peerID) return;
  activePeer = peerID;
  transport.textContent = "Trystero P2P DataChannel 已连接";
  setStatus("Mac 已连接；此链接已经使用，不能再连接第二个浏览器。");
  void loadIndex().catch((error) => setStatus(error.message, true));
};
room.onPeerLeave = (peerID) => {
  if (activePeer !== peerID) return;
  activePeer = null;
  pollGeneration += 1;
  transport.textContent = "DataChannel 已断开";
  setStatus("一次性连接已断开；请在 Mac 上生成新链接。", true);
};

byID<HTMLButtonElement>("refresh").onclick = () =>
  void loadIndex().catch((error) => setStatus(error.message, true));
byID<HTMLButtonElement>("open").onclick = () => {
  const selected = sessions.value;
  if (!selected) return;
  void (async () => {
    await command("session.open", { sessionID: selected });
    sessionID = selected;
    revision = null;
    pollGeneration += 1;
    void poll(pollGeneration);
  })().catch((error) => setStatus(error.message, true));
};
byID<HTMLButtonElement>("create").onclick = () => {
  const projectID = projects.value;
  if (!projectID) return;
  void (async () => {
    const value = await command("session.create", { projectID });
    sessionID = value.sessionID;
    revision = null;
    await loadIndex();
    pollGeneration += 1;
    void poll(pollGeneration);
  })().catch((error) => setStatus(error.message, true));
};
byID<HTMLButtonElement>("send").onclick = () => {
  if (!sessionID || !prompt.value) return;
  const text = prompt.value;
  void command("prompt.send", {
    sessionID,
    text,
    commandID: crypto.randomUUID(),
  }).then(() => { prompt.value = ""; })
    .catch((error) => setStatus(error.message, true));
};
byID<HTMLButtonElement>("stop").onclick = () => {
  if (sessionID) void command("generation.stop", { sessionID })
    .catch((error) => setStatus(error.message, true));
};
byID<HTMLButtonElement>("revoke").onclick = () => {
  revoked = true;
  activePeer = null;
  pollGeneration += 1;
  void room.leave();
  transport.textContent = "已断开";
  setStatus("此一次性链接已作废。");
};
