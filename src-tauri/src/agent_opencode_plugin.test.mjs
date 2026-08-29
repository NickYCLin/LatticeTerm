import { afterEach, describe, expect, it, vi } from "vitest"
import { LatticeTermStatus } from "./agent_opencode_plugin.js"

const originalReporter = process.env.LATTICETERM_AGENT_REPORTER

async function setup() {
  const unref = vi.fn()
  const spawn = vi.fn(() => ({ unref }))
  vi.stubGlobal("Bun", { spawn })
  process.env.LATTICETERM_AGENT_REPORTER = "/opt/Lattice Term/lattice-term"
  const hooks = await LatticeTermStatus()
  const states = () => spawn.mock.calls.map((call) => call[0][2])
  const event = (type, properties) => hooks.event({ event: { type, properties } })
  return { hooks, event, spawn, states, unref }
}

afterEach(() => {
  vi.unstubAllGlobals()
  if (originalReporter === undefined) delete process.env.LATTICETERM_AGENT_REPORTER
  else process.env.LATTICETERM_AGENT_REPORTER = originalReporter
})

describe("OpenCode lifecycle plugin", () => {
  it("reports a root turn as working and then done", async () => {
    const { hooks, event, spawn, states, unref } = await setup()

    await hooks["chat.message"]({ sessionID: "root" })
    await event("session.status", { sessionID: "root", status: { type: "busy" } })
    await event("session.status", { sessionID: "root", status: { type: "idle" } })

    expect(states()).toEqual(["working", "done"])
    expect(spawn.mock.calls[0][0]).toEqual([
      "/opt/Lattice Term/lattice-term",
      "agent-report",
      "working",
    ])
    expect(unref).toHaveBeenCalledTimes(2)
  })

  it("does not treat a child agent becoming idle as root completion", async () => {
    const { hooks, event, states } = await setup()

    await hooks["chat.message"]({ sessionID: "root" })
    await event("session.created", { info: { id: "child", parentID: "root" } })
    await hooks["chat.message"]({ sessionID: "child" })
    await event("session.status", { sessionID: "child", status: { type: "busy" } })
    await event("session.status", { sessionID: "child", status: { type: "idle" } })
    expect(states()).toEqual(["working"])

    await event("session.status", { sessionID: "root", status: { type: "idle" } })
    expect(states()).toEqual(["working", "done"])
  })

  it("keeps attention ahead of busy events until a child permission is answered", async () => {
    const { hooks, event, states } = await setup()

    await hooks["chat.message"]({ sessionID: "root" })
    await event("session.created", { info: { id: "child", parentID: "root" } })
    await event("permission.asked", { id: "request-1", sessionID: "child" })
    await event("session.status", { sessionID: "root", status: { type: "busy" } })
    expect(states()).toEqual(["working", "needs-attention"])

    await event("permission.replied", { requestID: "request-1", sessionID: "child" })
    expect(states()).toEqual(["working", "needs-attention", "working"])
  })

  it("does not overwrite an error with a later idle event", async () => {
    const { hooks, event, states } = await setup()

    await hooks["chat.message"]({ sessionID: "root" })
    await event("session.error", { sessionID: "root", error: { name: "APIError" } })
    await event("session.status", { sessionID: "root", status: { type: "idle" } })
    expect(states()).toEqual(["working", "needs-attention"])

    await hooks["chat.message"]({ sessionID: "root" })
    expect(states()).toEqual(["working", "needs-attention", "working"])
  })

  it("waits for every concurrently active root session", async () => {
    const { hooks, event, states } = await setup()

    await hooks["chat.message"]({ sessionID: "root-a" })
    await hooks["chat.message"]({ sessionID: "root-b" })
    await event("session.status", { sessionID: "root-a", status: { type: "idle" } })
    expect(states()).toEqual(["working"])
    await event("session.status", { sessionID: "root-b", status: { type: "idle" } })
    expect(states()).toEqual(["working", "done"])
  })
})
