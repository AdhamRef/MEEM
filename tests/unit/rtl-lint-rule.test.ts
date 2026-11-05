import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

let eslint: ESLint;

async function restrictedMessages(className: string): Promise<number> {
  const code = `export const Sample = () => <div className="${className}" />;\n`;
  const [result] = await eslint.lintText(code, { filePath: "src/components/sample.tsx" });
  return result!.messages.filter((message) => message.ruleId === "no-restricted-syntax").length;
}

beforeAll(() => {
  eslint = new ESLint();
});

describe("physical direction class lint rule", () => {
  it.each([
    "ml-2",
    "mr-4",
    "-ml-1",
    "pl-2",
    "pr-3",
    "left-0",
    "right-4",
    "text-left",
    "text-right",
    "border-l",
    "border-r-2",
    "rounded-l-lg",
    "rounded-tr-md",
    "float-left",
    "hover:ml-2",
    "md:pr-4",
    "flex ml-2 gap-1",
    "slide-in-from-left-2",
  ])("rejects %s", async (className) => {
    expect(await restrictedMessages(className)).toBe(1);
  }, 60_000);

  it.each([
    "ms-2",
    "me-4",
    "ps-2",
    "pe-3",
    "start-0",
    "end-4",
    "text-start",
    "text-end",
    "border-s",
    "border-e-2",
    "rounded-s-lg",
    "rounded-lg",
    "border-t",
    "md:ms-4",
    "inset-x-0",
    "text-lg",
    "slide-in-from-end-2",
  ])("allows %s", async (className) => {
    expect(await restrictedMessages(className)).toBe(0);
  }, 60_000);

  it("also checks template literals", async () => {
    const code = "export const Sample = ({ a }: { a: string }) => <div className={`ml-2 ${a}`} />;\n";
    const [result] = await eslint.lintText(code, { filePath: "src/components/sample.tsx" });
    expect(result!.messages.some((message) => message.ruleId === "no-restricted-syntax")).toBe(true);
  }, 60_000);
});
