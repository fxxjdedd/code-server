import { field, Level, logger } from "@coder/logger"
import * as fs from "fs-extra"
import yaml from "js-yaml"
import * as os from "os"
import * as path from "path"
import { Args as VsArgs } from "../../lib/vscode/src/vs/server/ipc"
import { AuthType } from "./http"
import { canConnect, generatePassword, humanPath, paths } from "./util"

export class Optional<T> {
  public constructor(public readonly value?: T) {}
}

export enum LogLevel {
  Trace = "trace",
  Debug = "debug",
  Info = "info",
  Warn = "warn",
  Error = "error",
}

export class OptionalString extends Optional<string> {}

export interface Args extends VsArgs {
  readonly config?: string
  readonly auth?: AuthType
  readonly password?: string
  readonly cert?: OptionalString
  readonly "cert-host"?: string
  readonly "cert-key"?: string
  readonly "disable-telemetry"?: boolean
  readonly help?: boolean
  readonly host?: string
  readonly json?: boolean
  log?: LogLevel
  readonly open?: boolean
  readonly port?: number
  readonly "bind-addr"?: string
  readonly socket?: string
  readonly version?: boolean
  readonly force?: boolean
  readonly "list-extensions"?: boolean
  readonly "install-extension"?: string[]
  readonly "show-versions"?: boolean
  readonly "uninstall-extension"?: string[]
  readonly "proxy-domain"?: string[]
  readonly locale?: string
  readonly _: string[]
  readonly "reuse-window"?: boolean
  readonly "new-window"?: boolean

  readonly link?: OptionalString
}

interface Option<T> {
  type: T
  /**
   * Short flag for the option.
   */
  short?: string
  /**
   * Whether the option is a path and should be resolved.
   */
  path?: boolean
  /**
   * Description of the option. Leave blank to hide the option.
   */
  description?: string

  /**
   * If marked as beta, the option is not printed unless $CS_BETA is set.
   */
  beta?: boolean
}

type OptionType<T> = T extends boolean
  ? "boolean"
  : T extends OptionalString
  ? typeof OptionalString
  : T extends LogLevel
  ? typeof LogLevel
  : T extends AuthType
  ? typeof AuthType
  : T extends number
  ? "number"
  : T extends string
  ? "string"
  : T extends string[]
  ? "string[]"
  : "unknown"

type Options<T> = {
  [P in keyof T]: Option<OptionType<T[P]>>
}

const options: Options<Required<Args>> = {
  auth: { type: AuthType, description: "The type of authentication to use." },
  password: {
    type: "string",
    description: "The password for password authentication (can only be passed in via $PASSWORD or the config file).",
  },
  cert: {
    type: OptionalString,
    path: true,
    description: "Path to certificate. A self signed certificate is generated if none is provided.",
  },
  "cert-host": {
    type: "string",
    description: "Hostname to use when generating a self signed certificate.",
  },
  "cert-key": { type: "string", path: true, description: "Path to certificate key when using non-generated cert." },
  "disable-telemetry": { type: "boolean", description: "Disable telemetry." },
  help: { type: "boolean", short: "h", description: "Show this output." },
  json: { type: "boolean" },
  open: { type: "boolean", description: "Open in browser on startup. Does not work remotely." },

  "bind-addr": {
    type: "string",
    description: "Address to bind to in host:port. You can also use $PORT to override the port.",
  },

  config: {
    type: "string",
    description: "Path to yaml config file. Every flag maps directly to a key in the config file.",
  },

  // These two have been deprecated by bindAddr.
  host: { type: "string", description: "" },
  port: { type: "number", description: "" },

  socket: { type: "string", path: true, description: "Path to a socket (bind-addr will be ignored)." },
  version: { type: "boolean", short: "v", description: "Display version information." },
  _: { type: "string[]" },

  "user-data-dir": { type: "string", path: true, description: "Path to the user data directory." },
  "extensions-dir": { type: "string", path: true, description: "Path to the extensions directory." },
  "builtin-extensions-dir": { type: "string", path: true },
  "extra-extensions-dir": { type: "string[]", path: true },
  "extra-builtin-extensions-dir": { type: "string[]", path: true },
  "list-extensions": { type: "boolean", description: "List installed VS Code extensions." },
  force: { type: "boolean", description: "Avoid prompts when installing VS Code extensions." },
  "install-extension": {
    type: "string[]",
    description:
      "Install or update a VS Code extension by id or vsix. The identifier of an extension is `${publisher}.${name}`.\n" +
      "To install a specific version provide `@${version}`. For example: 'vscode.csharp@1.2.3'.",
  },
  "enable-proposed-api": {
    type: "string[]",
    description:
      "Enable proposed API features for extensions. Can receive one or more extension IDs to enable individually.",
  },
  "uninstall-extension": { type: "string[]", description: "Uninstall a VS Code extension by id." },
  "show-versions": { type: "boolean", description: "Show VS Code extension versions." },
  "proxy-domain": { type: "string[]", description: "Domain used for proxying ports." },

  "new-window": {
    type: "boolean",
    short: "n",
    description: "Force to open a new window.",
  },
  "reuse-window": {
    type: "boolean",
    short: "r",
    description: "Force to open a file or folder in an already opened window.",
  },

  locale: { type: "string" },
  log: { type: LogLevel },
  verbose: { type: "boolean", short: "vvv", description: "Enable verbose logging." },

  link: {
    type: OptionalString,
    description: `
      Securely bind code-server via Coder Cloud with the passed name. You'll get a URL like
      https://myname.coder-cloud.com at which you can easily access your code-server instance.
      Authorization is done via GitHub.
      This is presently beta and requires being accepted for testing.
      See https://github.com/cdr/code-server/discussions/2137
    `,
    beta: true,
  },
}

export const optionDescriptions = (): string[] => {
  const entries = Object.entries(options).filter(([, v]) => !!v.description)
  const widths = entries.reduce(
    (prev, [k, v]) => ({
      long: k.length > prev.long ? k.length : prev.long,
      short: v.short && v.short.length > prev.short ? v.short.length : prev.short,
    }),
    { short: 0, long: 0 },
  )
  return entries
    .filter(([, v]) => {
      // If CS_BETA is set, we show beta options but if not, then we do not want
      // to show beta options.
      return process.env.CS_BETA || !v.beta
    })
    .map(([k, v]) => {
      const help = `${" ".repeat(widths.short - (v.short ? v.short.length : 0))}${
        v.short ? `-${v.short}` : " "
      } --${k} `
      return (
        help +
        v.description
          ?.trim()
          .split(/\n/)
          .map((line, i) => {
            line = line.trim()
            if (i === 0) {
              return " ".repeat(widths.long - k.length) + line
            }
            return " ".repeat(widths.long + widths.short + 6) + line
          })
          .join("\n") +
        (typeof v.type === "object" ? ` [${Object.values(v.type).join(", ")}]` : "")
      )
    })
}

export const parse = (
  argv: string[],
  opts?: {
    configFile: string
  },
): Args => {
  const error = (msg: string): Error => {
    if (opts?.configFile) {
      msg = `error reading ${opts.configFile}: ${msg}`
    }
    return new Error(msg)
  }

  const args: Args = { _: [] }
  let ended = false

  for (let i = 0; i < argv.length; ++i) {
    const arg = argv[i]

    // -- signals the end of option parsing.
    if (!ended && arg === "--") {
      ended = true
      continue
    }

    // Options start with a dash and require a value if non-boolean.
    if (!ended && arg.startsWith("-")) {
      let key: keyof Args | undefined
      let value: string | undefined
      if (arg.startsWith("--")) {
        const split = arg.replace(/^--/, "").split("=", 2)
        key = split[0] as keyof Args
        value = split[1]
      } else {
        const short = arg.replace(/^-/, "")
        const pair = Object.entries(options).find(([, v]) => v.short === short)
        if (pair) {
          key = pair[0] as keyof Args
        }
      }

      if (!key || !options[key]) {
        throw error(`Unknown option ${arg}`)
      }

      if (key === "password" && !opts?.configFile) {
        throw new Error("--password can only be set in the config file or passed in via $PASSWORD")
      }

      const option = options[key]
      if (option.type === "boolean") {
        ;(args[key] as boolean) = true
        continue
      }

      // Might already have a value if it was the --long=value format.
      if (typeof value === "undefined") {
        // A value is only valid if it doesn't look like an option.
        value = argv[i + 1] && !argv[i + 1].startsWith("-") ? argv[++i] : undefined
      }

      if (!value && option.type === OptionalString) {
        ;(args[key] as OptionalString) = new OptionalString(value)
        continue
      } else if (!value) {
        throw error(`--${key} requires a value`)
      }

      if (option.type === OptionalString && value === "false") {
        continue
      }

      if (option.path) {
        value = path.resolve(value)
      }

      switch (option.type) {
        case "string":
          ;(args[key] as string) = value
          break
        case "string[]":
          if (!args[key]) {
            ;(args[key] as string[]) = []
          }
          ;(args[key] as string[]).push(value)
          break
        case "number":
          ;(args[key] as number) = parseInt(value, 10)
          if (isNaN(args[key] as number)) {
            throw error(`--${key} must be a number`)
          }
          break
        case OptionalString:
          ;(args[key] as OptionalString) = new OptionalString(value)
          break
        default: {
          if (!Object.values(option.type).includes(value)) {
            throw error(`--${key} valid values: [${Object.values(option.type).join(", ")}]`)
          }
          ;(args[key] as string) = value
          break
        }
      }

      continue
    }

    // Everything else goes into _.
    args._.push(arg)
  }

  logger.debug("parsed command line", field("args", args))

  return args
}

export async function setDefaults(args: Args): Promise<Args> {
  args = { ...args }

  if (!args["user-data-dir"]) {
    await copyOldMacOSDataDir()
    args["user-data-dir"] = paths.data
  }

  if (!args["extensions-dir"]) {
    args["extensions-dir"] = path.join(args["user-data-dir"], "extensions")
  }

  // --verbose takes priority over --log and --log takes priority over the
  // environment variable.
  if (args.verbose) {
    args.log = LogLevel.Trace
  } else if (
    !args.log &&
    process.env.LOG_LEVEL &&
    Object.values(LogLevel).includes(process.env.LOG_LEVEL as LogLevel)
  ) {
    args.log = process.env.LOG_LEVEL as LogLevel
  }

  // Sync --log, --verbose, the environment variable, and logger level.
  if (args.log) {
    process.env.LOG_LEVEL = args.log
  }
  switch (args.log) {
    case LogLevel.Trace:
      logger.level = Level.Trace
      args.verbose = true
      break
    case LogLevel.Debug:
      logger.level = Level.Debug
      args.verbose = false
      break
    case LogLevel.Info:
      logger.level = Level.Info
      args.verbose = false
      break
    case LogLevel.Warn:
      logger.level = Level.Warning
      args.verbose = false
      break
    case LogLevel.Error:
      logger.level = Level.Error
      args.verbose = false
      break
  }

  return args
}

async function defaultConfigFile(): Promise<string> {
  return `bind-addr: 127.0.0.1:8080
auth: password
password: ${await generatePassword()}
cert: false
`
}

/**
 * Reads the code-server yaml config file and returns it as Args.
 *
 * @param configPath Read the config from configPath instead of $CODE_SERVER_CONFIG or the default.
 */
export async function readConfigFile(configPath?: string): Promise<Args> {
  if (!configPath) {
    configPath = process.env.CODE_SERVER_CONFIG
    if (!configPath) {
      configPath = path.join(paths.config, "config.yaml")
    }
  }

  if (!(await fs.pathExists(configPath))) {
    await fs.outputFile(configPath, await defaultConfigFile())
    logger.info(`Wrote default config file to ${humanPath(configPath)}`)
  }

  const configFile = await fs.readFile(configPath)
  const config = yaml.safeLoad(configFile.toString(), {
    filename: configPath,
  })
  if (!config || typeof config === "string") {
    throw new Error(`invalid config: ${config}`)
  }

  // We convert the config file into a set of flags.
  // This is a temporary measure until we add a proper CLI library.
  const configFileArgv = Object.entries(config).map(([optName, opt]) => {
    if (opt === true) {
      return `--${optName}`
    }
    return `--${optName}=${opt}`
  })
  const args = parse(configFileArgv, {
    configFile: configPath,
  })
  return {
    ...args,
    config: configPath,
  }
}

function parseBindAddr(bindAddr: string): [string, number] {
  const u = new URL(`http://${bindAddr}`)
  // With the http scheme 80 will be dropped so assume it's 80 if missing. This
  // means --bind-addr <addr> without a port will default to 80 as well and not
  // the code-server default.
  return [u.hostname, u.port ? parseInt(u.port, 10) : 80]
}

interface Addr {
  host: string
  port: number
}

function bindAddrFromArgs(addr: Addr, args: Args): Addr {
  addr = { ...addr }
  if (args["bind-addr"]) {
    ;[addr.host, addr.port] = parseBindAddr(args["bind-addr"])
  }
  if (args.host) {
    addr.host = args.host
  }

  if (process.env.PORT) {
    addr.port = parseInt(process.env.PORT, 10)
  }
  if (args.port !== undefined) {
    addr.port = args.port
  }
  return addr
}

export function bindAddrFromAllSources(cliArgs: Args, configArgs: Args): [string, number] {
  let addr: Addr = {
    host: "localhost",
    port: 8080,
  }

  addr = bindAddrFromArgs(addr, configArgs)
  addr = bindAddrFromArgs(addr, cliArgs)

  return [addr.host, addr.port]
}

async function copyOldMacOSDataDir(): Promise<void> {
  if (os.platform() !== "darwin") {
    return
  }
  if (await fs.pathExists(paths.data)) {
    return
  }

  // If the old data directory exists, we copy it in.
  const oldDataDir = path.join(os.homedir(), "Library/Application Support", "code-server")
  if (await fs.pathExists(oldDataDir)) {
    await fs.copy(oldDataDir, paths.data)
  }
}

export const shouldRunVsCodeCli = (args: Args): boolean => {
  return !!args["list-extensions"] || !!args["install-extension"] || !!args["uninstall-extension"]
}

/**
 * Determine if it looks like the user is trying to open a file or folder in an
 * existing instance. The arguments here should be the arguments the user
 * explicitly passed on the command line, not defaults or the configuration.
 */
export const shouldOpenInExistingInstance = async (args: Args): Promise<string | undefined> => {
  // Always use the existing instance if we're running from VS Code's terminal.
  if (process.env.VSCODE_IPC_HOOK_CLI) {
    return process.env.VSCODE_IPC_HOOK_CLI
  }

  const readSocketPath = async (): Promise<string | undefined> => {
    try {
      return await fs.readFile(path.join(os.tmpdir(), "vscode-ipc"), "utf8")
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error
      }
    }
    return undefined
  }

  // If these flags are set then assume the user is trying to open in an
  // existing instance since these flags have no effect otherwise.
  const openInFlagCount = ["reuse-window", "new-window"].reduce((prev, cur) => {
    return args[cur as keyof Args] ? prev + 1 : prev
  }, 0)
  if (openInFlagCount > 0) {
    return readSocketPath()
  }

  // It's possible the user is trying to spawn another instance of code-server.
  // Check if any unrelated flags are set (check against one because `_` always
  // exists), that a file or directory was passed, and that the socket is
  // active.
  if (Object.keys(args).length === 1 && args._.length > 0) {
    const socketPath = await readSocketPath()
    if (socketPath && (await canConnect(socketPath))) {
      return socketPath
    }
  }

  return undefined
}
