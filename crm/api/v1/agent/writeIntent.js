const WRITE_REQUEST = /\b(?:update|set|change|move|roll|put|edit|mark)\b[\s\S]{0,140}\b(?:all|every|each|deal(?:s)?|preset(?:s)?|date(?:s)?)\b/i;
const EXPLICIT_REVERT = /\b(?:revert|restore)\b[\s\S]{0,140}\b(?:all|every|each|deal(?:s)?|preset(?:s)?|date(?:s)?)\b[\s\S]{0,80}\bto\b\s+\S/i;
const CONFIRMATION = /^(?:yes|yeah|yep|yup|ok|okay|confirm|confirmed|go ahead|do it|please do)\b/i;

function isWriteRequest(text) {
  const value = String(text ?? '');
  return WRITE_REQUEST.test(value) || EXPLICIT_REVERT.test(value);
}

function shouldRouteWriteToBulk(name, history = []) {
  if (!['total_master_sheet', 'undo_master_sheet_change'].includes(name)) return false;
  const userMessages = history
    .filter((item) => item?.role === 'user')
    .map((item) => String(item.content ?? ''));
  const current = userMessages.at(-1) ?? '';
  if (isWriteRequest(current)) return true;
  if (!CONFIRMATION.test(current)) return false;
  return isWriteRequest(userMessages.at(-2) ?? '');
}

module.exports = { isWriteRequest, shouldRouteWriteToBulk };
