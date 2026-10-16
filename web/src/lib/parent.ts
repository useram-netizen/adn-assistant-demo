/** Messages the widget sends to embed.js on the host page. */
export type ParentMessage = { type: 'adn:resize'; height: number } | { type: 'adn:close' };

export function postToParent(message: ParentMessage): void {
  if (window.parent === window) return;
  // The target is "*" because the host page can be any allowed site. These messages carry
  // nothing private (a height or a close request); embed.js checks that they come from us.
  window.parent.postMessage(message, '*');
}
