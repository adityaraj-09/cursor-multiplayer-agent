/**
 * Filter terminal noise that pollutes shared Cursor Agent sessions.
 *
 * xterm.js answers Device Attribute / cursor-position queries via onData.
 * Those replies must not be forwarded to the PTY — but real input
 * (arrows, PageUp/Down, mouse wheel, typed text) must pass through.
 */

/** DA / CPR / focus replies xterm emits — never forward these to the PTY. */
export function isTerminalAutoReply(data: string): boolean {
  if (!data) return true;

  // Primary / secondary DA: ESC [ ? … c  |  ESC [ > … c  |  ESC [ … c
  if (/^\x1b\[\??[\d;]*c$/.test(data)) return true;
  if (/^\x1b\[>[\d;]*c$/.test(data)) return true;

  // Cursor Position Report: ESC [ row ; col R
  if (/^\x1b\[\d+;\d+R$/.test(data)) return true;

  // Device Status Report reply
  if (/^\x1b\[\d*n$/.test(data)) return true;

  // Focus in / out
  if (data === "\x1b[I" || data === "\x1b[O") return true;

  // Bare non-printable controls (keep TAB/LF/CR — those are real input)
  if (/^[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f]+$/.test(data)) return true;

  return false;
}

/** SGR / legacy mouse reports (including wheel buttons 64/65). */
export function isMouseSequence(data: string): boolean {
  return (
    /^\x1b\[<[\d;]*[Mm]$/.test(data) ||
    /^\x1b\[M.{3}$/.test(data)
  );
}

/** Visible DA/DA2 garbage that already leaked into scrollback. */
const VISIBLE_DA_GARBAGE =
  /(?:\x1b)?(?:\[>?[\d;]*c|\[\?[\d;]*c|\[>[\d;]+c)+/g;

/** OSC / CSI fragments that sometimes render literally. */
const LITERAL_CSI_NOISE = /(?:direct)?(?:\[>?[\d;]*c)+/gi;

/** Strip leaked DA gibberish from output shown in the browser. */
export function sanitizeTerminalOutput(data: string): string {
  return data
    .replace(VISIBLE_DA_GARBAGE, "")
    .replace(LITERAL_CSI_NOISE, "")
    .replace(/(?:\[>?[\d;]*c){2,}/g, "");
}
