import type {
  AdapterContext,
  CommandRequest,
  ComputerActionRequest,
  ComputerInput,
  ComputerRef,
  ControlLeaseRef,
  PortableFile,
  SandboxProvider,
  ScreenRequest,
} from "@rakazo/adapter-kit";

const ROUTABLE = new Set(["docker", "box"]);

/**
 * Routes each persisted computer to its selected provider. Docker is always the default.
 * Box is deliberately limited to dedicated (Private) computers by the caller policy.
 */
export class RoutedSandbox implements SandboxProvider {
  readonly pageBrowser: SandboxProvider["pageBrowser"];

  constructor(
    private readonly providers: Map<string, SandboxProvider>,
    private readonly defaultKind = "docker",
  ) {
    if (!providers.has(defaultKind))
      throw new Error(`Missing default sandbox provider ${defaultKind}`);
    this.pageBrowser = async (computer, request, context) => {
      const provider = this.forComputer(computer);
      return provider.pageBrowser
        ? provider.pageBrowser(computer, request, context)
        : {
            ok: false,
            uncertain: false,
            fallback: "computer_act",
            error: "Page browser is unavailable on this computer.",
          };
    };
  }

  describe() {
    return this.required(this.defaultKind).describe();
  }

  private required(kind: string) {
    const provider = this.providers.get(kind);
    if (!provider) throw new Error(`Sandbox provider ${kind} is not configured`);
    return provider;
  }

  private forComputer(computer: ComputerRef) {
    return this.required(computer.kind);
  }

  async provision(request: Parameters<SandboxProvider["provision"]>[0], context: AdapterContext) {
    const desired = request.desiredProviderKind ?? request.providerKind ?? this.defaultKind;
    if (!ROUTABLE.has(desired))
      throw new Error(`Sandbox provider ${desired} cannot be selected per computer`);
    const provider = this.required(desired);
    return provider.provision(
      {
        ...request,
        providerRef: request.providerKind === desired ? request.providerRef : undefined,
        providerKind: request.providerKind === desired ? request.providerKind : undefined,
      },
      context,
    );
  }

  prepare(c: ComputerRef, x: AdapterContext) {
    return this.forComputer(c).prepare(c, x);
  }
  execute(c: ComputerRef, r: CommandRequest, x: AdapterContext) {
    return this.forComputer(c).execute(c, r, x);
  }
  connectScreen(c: ComputerRef, r: ScreenRequest, x: AdapterContext) {
    return this.forComputer(c).connectScreen(c, r, x);
  }
  setScreenControl(c: ComputerRef, i: boolean, x: AdapterContext, t?: string) {
    return this.forComputer(c).setScreenControl?.(c, i, x, t) ?? Promise.resolve();
  }
  sendInput(c: ComputerRef, i: ComputerInput, l: ControlLeaseRef, x: AdapterContext) {
    return this.forComputer(c).sendInput(c, i, l, x);
  }
  observe(c: ComputerRef, x: AdapterContext) {
    return this.forComputer(c).observe(c, x);
  }
  act(c: ComputerRef, r: ComputerActionRequest, x: AdapterContext) {
    return this.forComputer(c).act(c, r, x);
  }
  listFiles(c: ComputerRef, p: string, x: AdapterContext) {
    return this.forComputer(c).listFiles(c, p, x);
  }
  readFile(c: ComputerRef, p: string, x: AdapterContext, o?: { maxBytes?: number }) {
    return this.forComputer(c).readFile(c, p, x, o);
  }
  writeFile(c: ComputerRef, f: PortableFile, x: AdapterContext) {
    return this.forComputer(c).writeFile(c, f, x);
  }
  exportWorkspace(c: ComputerRef, x: AdapterContext) {
    return this.forComputer(c).exportWorkspace(c, x);
  }
  importWorkspace(c: ComputerRef, f: AsyncIterable<PortableFile>, x: AdapterContext) {
    return this.forComputer(c).importWorkspace(c, f, x);
  }
  snapshot(c: ComputerRef, x: AdapterContext) {
    return this.forComputer(c).snapshot(c, x);
  }
  keepAlive(c: ComputerRef) {
    return this.forComputer(c).keepAlive?.(c) ?? Promise.resolve();
  }
  releaseScreen(c: ComputerRef, x: AdapterContext) {
    return this.forComputer(c).releaseScreen?.(c, x) ?? Promise.resolve();
  }
  stop(c: ComputerRef, x: AdapterContext) {
    return this.forComputer(c).stop(c, x);
  }
  destroy(c: ComputerRef, x: AdapterContext) {
    return this.forComputer(c).destroy(c, x);
  }
}
