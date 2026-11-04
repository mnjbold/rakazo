import type { MessageBlock } from "@rakazo/contracts";

/** Undo empties the checklist as well as marking it, so older clients hide it too. */
export function isRetiredImportSetup(block: MessageBlock): boolean {
  return block.kind === "import_setup" && (block.undone === true || block.items.length === 0);
}

export function isToolActivityBlock(block: MessageBlock): boolean {
  return block.kind === "steps" || (block.kind === "progress" && block.activity === true);
}

const COMPUTER_TOOL = /^(?:browser|computer)_/;

/**
 * True while a message's live tool status shows the bot driving its browser or desktop. Lets the
 * UI surface the screen only then, instead of flashing it for every reply.
 */
export function isUsingComputer(blocks: readonly MessageBlock[]): boolean {
  return blocks.some(
    (block) =>
      block.kind === "progress" &&
      block.activity === true &&
      (block.pendingToolNames ?? []).some((name) => COMPUTER_TOOL.test(name)),
  );
}
