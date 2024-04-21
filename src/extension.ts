import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { workspace } from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from "vscode-languageclient/node";

const enum EsolangCommands {
  RestartServer = "esolang.restartServer",
}

let client: LanguageClient | undefined;
let configureLang: vscode.Disposable | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const onEnterRules = [...continueTypingCommentsOnNewline()];

  configureLang = vscode.languages.setLanguageConfiguration("esolang", {
    onEnterRules,
  });

  const restartCommand = vscode.commands.registerCommand(
    EsolangCommands.RestartServer,
    async () => {
      if (!client) {
        vscode.window.showErrorMessage("esolang client not found");
        return;
      }

      try {
        if (client.isRunning()) {
          await client.restart();

          vscode.window.showInformationMessage("esolang server restarted.");
        } else {
          await client.start();
        }
      } catch (err) {
        client.error("Restarting client failed", err, "force");
      }
    },
  );

  context.subscriptions.push(restartCommand);

  client = await createLanguageClient();
  // Start the client. This will also launch the server
  client?.start();
}

// this method is called when your extension is deactivated
export function deactivate(): Thenable<void> | undefined {
  configureLang?.dispose();

  return client?.stop();
}

async function createLanguageClient(): Promise<LanguageClient | undefined> {
  const command = await getEsolangCommandPath();
  if (!command) {
    const message = `Could not resolve esolang executable. Please ensure it is available
    on the PATH used by VS Code or set an explicit "esolang.path" setting to a valid esolang executable.`;

    vscode.window.showErrorMessage(message);
    return;
  }

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "esolang" }],
    synchronize: {
      fileEvents: [
        // workspace.createFileSystemWatcher('**/gleam.toml'),
        // workspace.createFileSystemWatcher('**/manifest.toml'),
      ],
    },
  };

  const serverOptions: ServerOptions = {
    command,
    args: ["lsp"],
    options: {
      env: Object.assign(process.env, {
        ESOLANG_LOG: "info",
        ESOLANG_LOG_NOCOLOUR: "1",
      }),
    },
  };

  return new LanguageClient(
    "esolang_language_server",
    "esolang Language Server",
    serverOptions,
    clientOptions,
  );
}

/**
 * Returns the `OnEnterRule`s needed to configure typing comments on a newline.
 *
 * This makes it so when you press `Enter` while in a comment it will continue
 * the comment onto the next line.
 */
function continueTypingCommentsOnNewline(): vscode.OnEnterRule[] {
  const indentAction = vscode.IndentAction.None;

  return [
    {
      // Module doc single-line comment
      // e.g. ////|
      beforeText: /^\s*\/{4}.*$/,
      action: { indentAction, appendText: "//// " },
    },
    {
      // Doc single-line comment
      // e.g. ///|
      beforeText: /^\s*\/{3}.*$/,
      action: { indentAction, appendText: "/// " },
    },
  ];
}

/** Returns the absolute path to a gleam command. */
export async function getEsolangCommandPath(): Promise<string | undefined> {
  const command = getWorkspaceConfigEsolangExePath();
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!command || !workspaceFolders) {
    return command ?? "esolang";
  } else if (!path.isAbsolute(command)) {
    // if sent a relative path, iterate over workspace folders to try and resolve.
    for (const workspace of workspaceFolders) {
      const commandPath = path.resolve(workspace.uri.fsPath, command);
      if (await fileExists(commandPath)) {
        return commandPath;
      }
    }
    return undefined;
  }
  return command;
}

const EXTENSION_NS = "esolang";

function getWorkspaceConfigEsolangExePath(): string | undefined {
  const exePath = vscode.workspace.getConfiguration(EXTENSION_NS).get("path");
  // it is possible for the path to be blank. In that case, return undefined
  if (typeof exePath !== "string" || !exePath || exePath.trim().length === 0) {
    return undefined;
  } else {
    return exePath;
  }
}

function fileExists(executableFilePath: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    fs.stat(executableFilePath, (err, stat) => {
      resolve(err == null && stat.isFile());
    });
  }).catch(() => {
    // ignore all errors
    return false;
  });
}
