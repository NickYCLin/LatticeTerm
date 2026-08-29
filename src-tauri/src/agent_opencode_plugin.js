function spawnReporter(state) {
  const reporter = process.env.LATTICETERM_AGENT_REPORTER
  if (!reporter) return false
  try {
    const child = Bun.spawn([reporter, "agent-report", state], {
      env: process.env,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    })
    child.unref?.()
    return true
  } catch {
    return false
  }
}

export const LatticeTermStatus = async () => {
  const roots = new Set()
  const descendants = new Set()
  const parents = new Map()
  const active = new Set()
  const errors = new Set()
  const pending = new Map()
  let lastState

  const tracked = (sessionID) => roots.has(sessionID) || descendants.has(sessionID)

  const refreshDescendants = () => {
    let changed = true
    while (changed) {
      changed = false
      for (const [sessionID, parentID] of parents) {
        if (!tracked(parentID) || descendants.has(sessionID)) continue
        descendants.add(sessionID)
        roots.delete(sessionID)
        active.delete(sessionID)
        errors.delete(sessionID)
        changed = true
      }
    }
  }

  const publish = () => {
    const needsAttention =
      [...errors].some((sessionID) => roots.has(sessionID)) ||
      [...pending.values()].some(tracked)
    const state = needsAttention
      ? "needs-attention"
      : active.size > 0
        ? "working"
        : roots.size > 0
          ? "done"
          : undefined
    if (!state || state === lastState) return
    if (spawnReporter(state)) lastState = state
  }

  const learnSession = (info) => {
    if (!info?.id || !info.parentID) return
    parents.set(info.id, info.parentID)
    refreshDescendants()
  }

  const settleRequest = (requestID) => {
    if (!requestID) return
    for (const key of [...pending.keys()]) {
      if (key.endsWith(`:${requestID}`)) pending.delete(key)
    }
  }

  const removeSession = (sessionID) => {
    if (!sessionID) return
    const removed = new Set([sessionID])
    let changed = true
    while (changed) {
      changed = false
      for (const [childID, parentID] of parents) {
        if (!removed.has(parentID) || removed.has(childID)) continue
        removed.add(childID)
        changed = true
      }
    }
    for (const id of removed) {
      roots.delete(id)
      descendants.delete(id)
      active.delete(id)
      errors.delete(id)
      parents.delete(id)
    }
    for (const [key, id] of pending) {
      if (removed.has(id)) pending.delete(key)
    }
  }

  return {
    "chat.message": async ({ sessionID }) => {
      if (!sessionID || parents.has(sessionID)) return
      roots.add(sessionID)
      active.add(sessionID)
      errors.delete(sessionID)
      refreshDescendants()
      publish()
    },
    event: async ({ event }) => {
      const properties = event?.properties ?? {}
      if (event?.type === "session.created" || event?.type === "session.updated") {
        learnSession(properties.info)
        publish()
        return
      }

      if (event?.type === "session.status") {
        const sessionID = properties.sessionID
        if (!roots.has(sessionID)) return
        if (properties.status?.type === "busy" || properties.status?.type === "retry") {
          active.add(sessionID)
        } else if (properties.status?.type === "idle") {
          active.delete(sessionID)
        }
        publish()
        return
      }

      if (event?.type === "session.idle") {
        if (!roots.has(properties.sessionID)) return
        active.delete(properties.sessionID)
        publish()
        return
      }

      if (event?.type === "session.error") {
        if (!roots.has(properties.sessionID)) return
        active.delete(properties.sessionID)
        errors.add(properties.sessionID)
        publish()
        return
      }

      if (event?.type === "session.deleted") {
        removeSession(properties.info?.id ?? properties.sessionID)
        publish()
        return
      }

      if (
        event?.type === "permission.asked" ||
        event?.type === "permission.v2.asked" ||
        event?.type === "permission.updated" ||
        event?.type === "question.asked" ||
        event?.type === "question.v2.asked"
      ) {
        if (!tracked(properties.sessionID)) return
        const requestID = properties.id ?? properties.permissionID ?? event.id
        pending.set(`${event.type}:${requestID}`, properties.sessionID)
        publish()
        return
      }

      if (
        event?.type === "permission.replied" ||
        event?.type === "permission.v2.replied" ||
        event?.type === "question.replied" ||
        event?.type === "question.v2.replied" ||
        event?.type === "question.rejected" ||
        event?.type === "question.v2.rejected"
      ) {
        settleRequest(properties.requestID ?? properties.permissionID ?? properties.id)
        publish()
      }
    },
  }
}
