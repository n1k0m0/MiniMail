export class MailOperationError extends Error {}

export function requireMailResult(result, message) {
  if (result === false) throw new MailOperationError(message);
  return result;
}
