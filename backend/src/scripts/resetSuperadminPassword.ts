import type { ReadStream, WriteStream } from "node:tty";
import { HttpError } from "../utils/http";
import {
  EmergencySuperadminResetError,
  findEmergencySuperadminTarget,
  resetEmergencySuperadminPassword
} from "../services/emergencySuperadminPasswordResetService";
import { prisma } from "../db/prisma";

type CliDependencies = {
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
  errorOutput?: NodeJS.WriteStream;
  isInteractive?: boolean;
  readHidden?: (prompt: string) => Promise<string>;
};

export async function runResetSuperadminPasswordCli(argv: string[], dependencies: CliDependencies = {}) {
  const input = dependencies.input ?? process.stdin;
  const output = dependencies.output ?? process.stdout;
  const errorOutput = dependencies.errorOutput ?? process.stderr;
  const interactive = dependencies.isInteractive ?? Boolean(input.isTTY && output.isTTY);

  try {
    const targetUserId = parseArguments(argv);
    if (!interactive) {
      throw new EmergencySuperadminResetError(
        "interactive_terminal_required",
        "Для безопасного ввода пароля требуется интерактивный TTY."
      );
    }

    const target = await findEmergencySuperadminTarget(targetUserId);
    output.write("Active superadmin account verified.\n");
    const readHidden = dependencies.readHidden ?? ((prompt) => readHiddenValue(input as ReadStream, output as WriteStream, prompt));
    const password = await readHidden("Новый временный пароль: ");
    const confirmation = await readHidden("Повторите временный пароль: ");
    if (password !== confirmation) {
      throw new EmergencySuperadminResetError("password_confirmation_mismatch", "Пароли не совпадают. Сброс не выполнен.");
    }

    const result = await resetEmergencySuperadminPassword(target.id, password);
    output.write(`Superadmin password credential reset completed. Temporary password expires at ${result.temporaryPasswordExpiresAt.toISOString()}.\n`);
    return 0;
  } catch (error) {
    if (error instanceof EmergencySuperadminResetError || error instanceof HttpError) {
      errorOutput.write(`Reset refused: ${error.message}\n`);
    } else {
      errorOutput.write("Reset failed due to an unexpected operational error. No credential was changed unless the transaction completed.\n");
    }
    return 1;
  }
}

function parseArguments(argv: string[]) {
  let targetUserId: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--user-id") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new EmergencySuperadminResetError("invalid_arguments", "Для --user-id требуется значение.");
      targetUserId = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--user-id=")) {
      targetUserId = argument.slice("--user-id=".length);
      if (!targetUserId) throw new EmergencySuperadminResetError("invalid_arguments", "Для --user-id требуется значение.");
      continue;
    }
    throw new EmergencySuperadminResetError(
      "invalid_arguments",
      "Допустим только необязательный параметр --user-id <id>. Пароль вводится исключительно интерактивно."
    );
  }
  return targetUserId;
}

async function readHiddenValue(input: ReadStream, output: WriteStream, prompt: string): Promise<string> {
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    throw new EmergencySuperadminResetError("interactive_terminal_required", "Для безопасного ввода пароля требуется интерактивный TTY.");
  }
  output.write(prompt);
  const previousRawMode = input.isRaw;
  input.setRawMode(true);
  input.resume();

  return new Promise<string>((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      input.off("data", onData);
      input.setRawMode(Boolean(previousRawMode));
      input.pause();
      output.write("\n");
    };
    const onData = (chunk: Buffer | string) => {
      const text = chunk.toString("utf8");
      for (const character of text) {
        if (character === "\u0003") {
          cleanup();
          reject(new EmergencySuperadminResetError("cancelled", "Операция отменена."));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (value.length >= 128) {
          cleanup();
          reject(new EmergencySuperadminResetError("password_too_long", "Пароль превышает допустимую длину."));
          return;
        }
        if (character >= " ") value += character;
      }
    };
    input.on("data", onData);
  });
}

if (require.main === module) {
  void runResetSuperadminPasswordCli(process.argv.slice(2))
    .then(async (exitCode) => {
      await prisma.$disconnect();
      process.exitCode = exitCode;
    })
    .catch(async () => {
      await prisma.$disconnect();
      process.stderr.write("Reset failed due to an unexpected operational error.\n");
      process.exitCode = 1;
    });
}
