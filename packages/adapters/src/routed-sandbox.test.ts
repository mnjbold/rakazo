import type { AdapterContext, SandboxProvider } from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import { FakeSandboxProvider } from "./fake-sandbox.js";
import { RoutedSandbox } from "./routed-sandbox.js";

const context = {
  botId: "bot",
  spaceId: "space",
  signal: new AbortController().signal,
} as AdapterContext;

describe("RoutedSandbox", () => {
  it("defaults new computers to Docker", async () => {
    const docker = new FakeSandboxProvider();
    const provision = vi.spyOn(docker, "provision");
    const routed = new RoutedSandbox(new Map([["docker", docker as SandboxProvider]]));
    await routed.provision({ botId: "bot", homePath: "/tmp/home" }, context);
    expect(provision).toHaveBeenCalledOnce();
  });

  it("routes selected computers to Box and drops a mismatched provider ref", async () => {
    const docker = new FakeSandboxProvider();
    const box = new FakeSandboxProvider();
    vi.spyOn(box, "describe").mockReturnValue({ ...box.describe(), id: "box" });
    const provision = vi.spyOn(box, "provision");
    const routed = new RoutedSandbox(
      new Map([
        ["docker", docker],
        ["box", box],
      ]),
    );
    await routed.provision(
      {
        botId: "bot",
        homePath: "/tmp/home",
        providerKind: "docker",
        providerRef: "old",
        desiredProviderKind: "box",
      },
      context,
    );
    expect(provision).toHaveBeenCalledWith(
      expect.objectContaining({ providerRef: undefined, providerKind: undefined }),
      context,
    );
  });

  it("fails closed when a selected provider is unavailable", async () => {
    const routed = new RoutedSandbox(new Map([["docker", new FakeSandboxProvider()]]));
    await expect(
      routed.provision(
        { botId: "bot", homePath: "/tmp/home", desiredProviderKind: "box" },
        context,
      ),
    ).rejects.toThrow(/not configured/);
  });
});
