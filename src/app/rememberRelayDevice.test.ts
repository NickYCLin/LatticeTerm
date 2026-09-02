import { describe, expect, it } from "vitest";
import { rememberRelayDevice } from "./rememberRelayDevice";
import {
  createConnectionProfile,
  type ConnectionProfile,
} from "../domain/connection";

function savedDevice(
  deviceId: string,
  relayAddress: string,
  name = "Workshop",
): ConnectionProfile {
  return createConnectionProfile(
    {
      name,
      protocol: "lattice",
      hostname: "",
      username: "",
      port: 0,
      deviceId,
      relayAddress,
    },
    `id-${deviceId}`,
  );
}

describe("rememberRelayDevice", () => {
  it("saves a device dialed for the first time", () => {
    const memory = rememberRelayDevice([], {
      deviceId: "018536454",
      relayAddress: "wss://relay.example.com",
      agentName: "Workshop desktop",
    });

    expect(memory).toEqual({
      action: "add",
      draft: expect.objectContaining({
        name: "Workshop desktop",
        protocol: "lattice",
        deviceId: "018536454",
        relayAddress: "wss://relay.example.com",
      }),
    });
  });

  it("names an unnamed device by the digits its owner reads out", () => {
    const memory = rememberRelayDevice([], {
      deviceId: "018536454",
      relayAddress: "wss://relay.example.com",
      agentName: "   ",
    });

    expect(memory?.draft.name).toBe("018 536 454");
  });

  it("writes nothing when the same device is dialed again", () => {
    const saved = savedDevice("018536454", "wss://relay.example.com");

    expect(
      rememberRelayDevice([saved], {
        deviceId: "018536454",
        relayAddress: "  wss://relay.example.com  ",
        agentName: "Workshop desktop",
      }),
    ).toBeNull();
  });

  it("follows a device to a new relay without duplicating it", () => {
    const saved = savedDevice("018536454", "wss://old.example.com");

    const memory = rememberRelayDevice([saved], {
      deviceId: "018536454",
      relayAddress: "wss://new.example.com",
    });

    expect(memory?.action).toBe("update");
    expect(memory && "id" in memory && memory.id).toBe(saved.id);
    expect(memory?.draft.relayAddress).toBe("wss://new.example.com");
    // A quick tunnel hands out a new address on every restart, and the name
    // the user chose must survive that.
    expect(memory?.draft.name).toBe("Workshop");
  });

  it("keeps the name the user gave over the one the Agent reports", () => {
    const saved = savedDevice("018536454", "wss://old.example.com", "工作室");

    const memory = rememberRelayDevice([saved], {
      deviceId: "018536454",
      relayAddress: "wss://new.example.com",
      agentName: "hostname-from-the-far-side",
    });

    expect(memory?.draft.name).toBe("工作室");
  });

  it("treats a different device as a separate entry", () => {
    const saved = savedDevice("018536454", "wss://relay.example.com");

    const memory = rememberRelayDevice([saved], {
      deviceId: "309759966",
      relayAddress: "wss://relay.example.com",
    });

    expect(memory?.action).toBe("add");
  });

  it("ignores direct entries that happen to share the protocol", () => {
    const direct = createConnectionProfile({
      name: "Lab box",
      protocol: "lattice",
      hostname: "10.0.0.5",
      username: "",
      port: 44900,
    });

    const memory = rememberRelayDevice([direct], {
      deviceId: "018536454",
      relayAddress: "wss://relay.example.com",
    });

    expect(memory?.action).toBe("add");
  });
});
